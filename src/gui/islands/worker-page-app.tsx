/**
 * Self-contained island for the per-worker detail page (/worker/:id).
 *
 * Opens its own SSE connection (this is a separate browser tab) and
 * filters events by workerId (scenario from the ?scenario= query param).
 *
 * @module
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { ansiToHtml } from "../client/ansi.ts";

type LogEvent = {
  readonly type: "log";
  readonly level: string;
  readonly message: string;
  readonly ts: number;
  readonly workerId?: string;
};

// deno-lint-ignore no-explicit-any
type GuiEvent = { readonly type: string; [k: string]: any };

const fmt = (ts: number): string => new Date(ts).toTimeString().slice(0, 8);

export default function WorkerPageApp(): preact.JSX.Element {
  const parts = globalThis.location?.pathname.split("/") ?? [];
  const workerIndex = parseInt(parts[parts.length - 1], 10);
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  const workerId = params.get("scenario") ?? "\u2014";

  const [events, setEvents] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [workerState, setWorkerState] = useState("waiting");
  const [showDebug, setShowDebug] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [sendStatus, setSendStatus] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.title = `ralphmania \u00b7 worker ${workerIndex}`;
    let es: EventSource;
    let timer: number | undefined;

    const connect = (): void => {
      es = new EventSource("/events");
      es.onopen = (): void => {
        setConnected(true);
        setWorkerState("running");
      };
      es.onmessage = (e: MessageEvent): void => {
        try {
          const ev: GuiEvent = JSON.parse(e.data);
          if (ev.type === "log") {
            const logEv = ev as LogEvent;
            if (logEv.workerId === workerId) {
              setEvents((prev) => [...prev, logEv]);
            }
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

  const badgeClass = connected
    ? workerState === "done" ? "badge done" : "badge"
    : "badge off";
  const badgeText = connected
    ? workerState === "done" ? "done" : "live"
    : "disconnected";

  return (
    <>
      <header>
        <h1>ralphmania</h1>
        <a class="back" href="/">{"\u2190"} overview</a>
        <span style="font-size:13px;color:var(--muted)">
          worker {workerIndex}
        </span>
        <span class={badgeClass}>{badgeText}</span>
      </header>
      <main>
        <aside>
          <div>
            <div class="pt">Worker</div>
            <div class="info-val neutral">W{workerIndex}</div>
          </div>
          <div>
            <div class="pt">Scenario</div>
            <div class="info-val">{workerId}</div>
          </div>
          <div>
            <div class="pt">State</div>
            <div class={`info-val state-${workerState}`}>{workerState}</div>
          </div>
        </aside>
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
            {visible.map((ev, i) => {
              const cls = ev.level === "error"
                ? "t-error"
                : ev.level === "debug"
                ? "t-debug"
                : "t-info";
              return (
                <div class="le" key={i}>
                  <span class="le-ts">{fmt(ev.ts)}</span>
                  <span
                    class={`le-msg ${cls}`}
                    dangerouslySetInnerHTML={{
                      __html: ansiToHtml(ev.message),
                    }}
                  />
                </div>
              );
            })}
          </div>
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
        </section>
      </main>
    </>
  );
}
