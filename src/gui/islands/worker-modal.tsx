/**
 * Worker modal island — shows worker log replay, live streaming,
 * and input textarea for sending feedback to the agent.
 *
 * Opens a dedicated SSE connection to /events/worker/:id when the modal is
 * shown and closes it when the modal is dismissed (GUI.g: on-demand tailing).
 * @module
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  getSelectedWorker,
  isWorkerFinished,
  setSelectedWorker,
  subscribe,
} from "./event-store.ts";
import { escHtml } from "../client/html.ts";
import { LogEntry } from "../client/log-entry.tsx";
import type { LogEventLike } from "../client/log-entry.tsx";

type LogEvent = LogEventLike & {
  readonly type: "log";
  readonly workerId?: string;
  readonly seq: number;
};

// deno-lint-ignore no-explicit-any
type GuiEvent = { readonly type: string; [k: string]: any };

const MAX_MODAL_EVENTS = 800;
const TRIMMED_MODAL_EVENTS = 600;
let modalSeq = 0;

export default function WorkerModal(): preact.JSX.Element | null {
  const [selected, setLocal] = useState(getSelectedWorker());
  const [finished, setFinished] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const [drawerWidth, setDrawerWidth] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Local log buffer — populated from the per-worker SSE stream (GUI.g).
  const [events, setEvents] = useState<LogEvent[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (e: MouseEvent): void => {
      const newWidth = globalThis.innerWidth - e.clientX;
      const clamped = Math.max(
        320,
        Math.min(newWidth, globalThis.innerWidth * 0.95),
      );
      setDrawerWidth(clamped);
    };
    const onMouseUp = (): void => setIsDragging(false);
    globalThis.document.addEventListener("mousemove", onMouseMove);
    globalThis.document.addEventListener("mouseup", onMouseUp);
    return () => {
      globalThis.document.removeEventListener("mousemove", onMouseMove);
      globalThis.document.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging]);

  // Keep `selected` in sync with the global event-store selection.
  useEffect(
    () =>
      subscribe(() => {
        const w = getSelectedWorker();
        setLocal(w);
        if (w) {
          setFinished(isWorkerFinished(w.scenario));
        }
        // Clear local log buffer when a new worker is opened.
        if (!w || w.scenario !== getSelectedWorker()?.scenario) {
          setEvents([]);
        }
      }, ["selection", "graph"]),
    [],
  );

  // Open a dedicated SSE stream for the active worker's log (GUI.g).
  // The stream is opened when the modal becomes visible and closed when
  // the modal is dismissed, stopping I/O for idle workers.
  useEffect(() => {
    if (!selected) return;
    const scenario = selected.scenario;
    // Reset the log buffer for the newly selected worker.
    setEvents([]);

    let es: EventSource | undefined;
    let reconnectTimer: number | undefined;

    const connect = (): void => {
      es = new EventSource(
        `/events/worker/${encodeURIComponent(scenario)}`,
      );
      es.onmessage = (e: MessageEvent): void => {
        try {
          const ev: GuiEvent = JSON.parse(e.data);
          if (ev.type === "log") {
            const logEv = {
              ...ev,
              tags: (ev.tags as readonly string[]) ?? [],
              seq: modalSeq++,
            } as LogEvent;
            setEvents((prev) => {
              const next = [...prev, logEv];
              if (next.length > MAX_MODAL_EVENTS) {
                next.splice(0, next.length - TRIMMED_MODAL_EVENTS);
              }
              return next;
            });
          }
        } catch { /* malformed event */ }
      };
      es.onerror = (): void => {
        es?.close();
        reconnectTimer = setTimeout(connect, 3000) as unknown as number;
      };
    };

    connect();
    return (): void => {
      es?.close();
      clearTimeout(reconnectTimer);
    };
  }, [selected?.scenario]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events, selected]);

  if (!selected) return null;

  const isPhase = selected.phase !== undefined;
  const phaseLabel = selected.phase === "merge"
    ? "Merge"
    : selected.phase === "validate"
    ? "Validation"
    : selected.phase === "rectify"
    ? "Rectification"
    : undefined;

  const close = (): void => setSelectedWorker(null);

  const sendInput = (): void => {
    if (finished) return;
    const text = inputRef.current?.value.trim();
    if (!text) return;
    if (inputRef.current) inputRef.current.value = "";
    setSendStatus("sending\u2026");
    fetch(`/input/${encodeURIComponent(selected.scenario)}`, {
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

  return (
    <div
      id="worker-modal"
      class="modal-overlay"
      onClick={(e): void => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay")) {
          close();
        }
      }}
    >
      <div
        class="modal-content"
        ref={contentRef}
        style={drawerWidth ? { width: `${drawerWidth}px` } : undefined}
      >
        <div
          class={`modal-resize-handle${isDragging ? " dragging" : ""}`}
          onMouseDown={onMouseDown}
        />
        <div class="modal-header">
          <h2>
            {phaseLabel
              ? phaseLabel
              : <>W{selected.workerIndex} → {escHtml(selected.scenario)}</>}
          </h2>
          {finished && !isPhase && (
            <span class="worker-status-badge">inactive</span>
          )}
          <a
            href={`/worker/${selected.workerIndex}?scenario=${
              encodeURIComponent(selected.scenario)
            }${selected.phase ? `&phase=${selected.phase}` : ""}`}
            target="_blank"
          >
            pop out
          </a>
          <button type="button" class="modal-close" onClick={close}>
            {"\u2715"}
          </button>
        </div>
        <div class="modal-log" ref={logRef}>
          {events.map((ev) => <LogEntry key={ev.seq} ev={ev} />)}
        </div>
        {!isPhase && (
          <div class="modal-input">
            <textarea
              ref={inputRef}
              placeholder={finished
                ? "Worker has finished"
                : "Send input to agent (Enter to send)"}
              disabled={finished}
              onKeyDown={(e): void => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendInput();
                }
              }}
            />
            <button type="button" onClick={sendInput} disabled={finished}>
              Send
            </button>
            <span class="send-status">{sendStatus}</span>
          </div>
        )}
      </div>
    </div>
  );
}
