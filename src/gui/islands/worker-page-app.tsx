/**
 * Self-contained island for the per-worker detail page (/worker/:id).
 *
 * Opens its own SSE connection (this is a separate browser tab) and
 * filters events by workerId (scenario from the ?scenario= query param).
 *
 * @module
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { LogEntry, type LogEventLike } from "../client/log-entry.tsx";

type LogEvent = LogEventLike & {
  readonly type: "log";
  readonly workerId?: string;
};

// deno-lint-ignore no-explicit-any
type GuiEvent = { readonly type: string; [k: string]: any };

const MAX_EVENTS = 800;
const TRIMMED_EVENTS = 600;
let localSeq = 0;

export default function WorkerPageApp(): preact.JSX.Element {
  const parts = globalThis.location?.pathname.split("/") ?? [];
  const workerIndex = parseInt(parts[parts.length - 1], 10);
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  const workerId = params.get("scenario") ?? "\u2014";
  const phase = params.get("phase") as "merge" | "validate" | "rectify" | null;
  const phaseLabel = phase === "merge"
    ? "Merge"
    : phase === "validate"
    ? "Validation"
    : phase === "rectify"
    ? "Rectification"
    : undefined;

  const [events, setEvents] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [workerState, setWorkerState] = useState("waiting");
  const [showDebug, setShowDebug] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [sendStatus, setSendStatus] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // deno-lint-ignore no-undef
    document.title = phaseLabel
      ? `ralphmania \u00b7 ${phaseLabel}`
      : `ralphmania \u00b7 W${workerIndex} \u00b7 ${workerId}`;
    let es: EventSource;
    let timer: number | undefined;

    const connect = (): void => {
      // Connect to the worker-specific SSE stream (GUI.g: on-demand tailing).
      es = new EventSource(`/events/worker/${encodeURIComponent(workerId)}`);
      es.onopen = (): void => {
        setConnected(true);
        setWorkerState("running");
      };
      es.onmessage = (e: MessageEvent): void => {
        try {
          const ev: GuiEvent = JSON.parse(e.data);
          if (ev.type === "log") {
            // Stream is already scoped to this worker — no filter needed.
            const logEv = {
              ...ev,
              tags: (ev.tags as readonly string[]) ?? [],
              seq: localSeq++,
            } as LogEvent;
            setEvents((prev) => {
              const next = [...prev, logEv];
              if (next.length > MAX_EVENTS) {
                next.splice(0, next.length - TRIMMED_EVENTS);
              }
              return next;
            });
          } else if (
            ev.type === "worker_active" && ev.workerIndex === workerIndex
          ) {
            setWorkerState("running");
          } else if (
            ev.type === "worker_done" && ev.workerIndex === workerIndex
          ) {
            setWorkerState("done");
          }
        } catch { /* malformed event */ }
      };
      es.onerror = (): void => {
        setConnected(false);
        es.close();
        timer = setTimeout(connect, 3000) as unknown as number;
      };
    };
    connect();
    return (): void => {
      es?.close();
      clearTimeout(timer);
    };
  }, [workerId, workerIndex]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const isRunning = workerState === "running";
  const visible = showDebug
    ? events
    : events.filter((e) => e.level !== "debug");

  const sendInput = (): void => {
    const text = inputRef.current?.value.trim();
    if (!text || !isRunning) return;
    if (inputRef.current) inputRef.current.value = "";
    setSendStatus("sending\u2026");
    fetch(`/input/${encodeURIComponent(workerId)}`, {
      method: "POST",
      body: text,
      headers: { "Content-Type": "text/plain" },
    })
      .then(async (r) => {
        const json = await r.json().catch(() => ({ ok: r.ok }));
        setSendStatus(
          json.ok ? "queued" : `failed: ${json.error ?? "unknown"}`,
        );
        setTimeout(() => setSendStatus(""), json.ok ? 2000 : 5000);
      })
      .catch(() => {
        setSendStatus("network error");
        setTimeout(() => setSendStatus(""), 5000);
      });
  };

  const badgeClass = connected ? "badge" : "badge off";
  const badgeText = connected ? "connected" : "disconnected";

  return (
    <>
      <header>
        <h1>ralphmania</h1>
        <a class="back" href="/">← overview</a>
        <span style="font-size:13px;color:var(--muted)">
          {phaseLabel ?? `W${workerIndex} · ${workerId}`}
        </span>
        <span
          class={`info-val state-${workerState}`}
          style="font-size:12px;margin-left:8px"
        >
          {workerState}
        </span>
        <span class={badgeClass}>{badgeText}</span>
      </header>
      <main>
        <section style="display:flex;flex-direction:column;overflow:hidden">
          <div id="log-bar">
            <label>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e): void =>
                  setAutoScroll((e.target as HTMLInputElement).checked)}
              />{" "}
              auto-scroll
            </label>
            <label>
              <input
                type="checkbox"
                checked={showDebug}
                onChange={(e): void =>
                  setShowDebug((e.target as HTMLInputElement).checked)}
              />{" "}
              debug
            </label>
            <button type="button" onClick={(): void => setEvents([])}>
              clear
            </button>
          </div>
          <div id="log" ref={logRef}>
            {visible.map((ev) => <LogEntry key={ev.seq} ev={ev} />)}
          </div>
          {!phase && (
            <div id="input-bar">
              <textarea
                ref={inputRef}
                placeholder="Send input to agent (Enter to send, Shift+Enter for newline)"
                disabled={!isRunning}
                onKeyDown={(e): void => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendInput();
                  }
                }}
              />
              <button
                type="button"
                id="send-btn"
                disabled={!isRunning}
                onClick={sendInput}
              >
                Send
              </button>
              <span id="send-status">{sendStatus}</span>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
