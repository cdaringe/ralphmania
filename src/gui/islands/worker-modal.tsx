/**
 * Worker modal island — shows worker log replay, live streaming,
 * and input textarea for sending feedback to the agent.
 * @module
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  getSelectedWorker,
  getWorkerLogBuffer,
  getWorkerLogVersion,
  isWorkerFinished,
  setSelectedWorker,
  subscribe,
} from "./event-store.ts";
import { escHtml } from "../client/html.ts";
import { LogEntry } from "../client/log-entry.tsx";

export default function WorkerModal(): preact.JSX.Element | null {
  const [selected, setLocal] = useState(getSelectedWorker());
  const [workerLogVersion, setWorkerLogVersion] = useState(
    getWorkerLogVersion(),
  );
  const [finished, setFinished] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const [drawerWidth, setDrawerWidth] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
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

  useEffect(
    () =>
      subscribe(() => {
        const w = getSelectedWorker();
        setLocal(w);
        if (w) {
          setFinished(isWorkerFinished(w.scenario));
        }
        setWorkerLogVersion(getWorkerLogVersion());
      }, ["selection", "worker_logs", "graph"]),
    [],
  );

  const events = selected ? getWorkerLogBuffer(selected.scenario) : [];

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [workerLogVersion, selected]);

  if (!selected) return null;

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
            W{selected.workerIndex} → {escHtml(selected.scenario)}
          </h2>
          {finished && <span class="worker-status-badge">inactive</span>}
          <a
            href={`/worker/${selected.workerIndex}?scenario=${
              encodeURIComponent(selected.scenario)
            }`}
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
      </div>
    </div>
  );
}
