/**
 * Worker modal island — shows worker log replay, live streaming,
 * and input textarea for sending feedback to the agent.
 * @module
 */
import { useEffect, useRef, useState } from "preact/hooks";
import {
  getSelectedWorker,
  getWorkerLogBuffer,
  getWorkerLogVersion,
  isWorkerFinished,
  type LogEvent,
  setSelectedWorker,
  subscribe,
} from "./event-store.ts";
import { ansiToHtml } from "../client/ansi.ts";

const fmt = (ts: number): string => new Date(ts).toTimeString().slice(0, 8);

const escHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const messageHtmlCache = new WeakMap<LogEvent, string>();

const getMessageHtml = (ev: LogEvent): string => {
  const cached = messageHtmlCache.get(ev);
  if (cached !== undefined) return cached;
  const html = ansiToHtml(ev.message);
  messageHtmlCache.set(ev, html);
  return html;
};

const LogEntry = ({ ev }: { ev: LogEvent }): preact.JSX.Element => {
  const isUser = ev.tags.includes("user");
  const cls = isUser
    ? "t-user"
    : ev.level === "error"
    ? "t-error"
    : ev.level === "debug"
    ? "t-debug"
    : "t-info";
  return (
    <div class={`le${isUser ? " le-user" : ""}`}>
      <span class="le-ts">{fmt(ev.ts)}</span>
      <span
        class={`le-msg ${cls}`}
        dangerouslySetInnerHTML={{ __html: getMessageHtml(ev) }}
      />
    </div>
  );
};

export default function WorkerModal(): preact.JSX.Element | null {
  const [selected, setLocal] = useState(getSelectedWorker());
  const [workerLogVersion, setWorkerLogVersion] = useState(
    getWorkerLogVersion(),
  );
  const [finished, setFinished] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
      <div class="modal-content">
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
          {events.map((ev, i) => <LogEntry key={i} ev={ev} />)}
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
