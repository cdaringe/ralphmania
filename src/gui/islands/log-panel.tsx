/**
 * Log panel island — renders streaming log events with ANSI color
 * conversion, debug filtering, auto-scroll, and clear.
 * @module
 */
import { useEffect, useRef, useState } from "preact/hooks";
import {
  clearLogEvents,
  getLogEvents,
  type LogEvent,
  subscribe,
} from "./event-store.ts";
import { ansiToHtml } from "../client/ansi.ts";

const fmt = (ts: number): string => new Date(ts).toTimeString().slice(0, 8);

const TAG_CLS: Record<string, string> = {
  info: "t-info",
  error: "t-error",
  debug: "t-debug",
  orchestrator: "t-orch",
  validate: "t-validate",
  transition: "t-trans",
  user: "t-user",
  input: "t-input",
};

const escHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const LogEntry = ({ ev }: { ev: LogEvent }): preact.JSX.Element => {
  const tagsHtml = ev.tags
    .map((t) => `<span class="${TAG_CLS[t] ?? ""}">${escHtml(t)}</span>`)
    .join('<span style="color:#3f3f46">:</span>');

  return (
    <div class="le">
      <span class="le-ts">{fmt(ev.ts)}</span>
      <span
        class="le-tags"
        dangerouslySetInnerHTML={{ __html: `[${tagsHtml}]` }}
      />
      <span
        class="le-msg"
        dangerouslySetInnerHTML={{ __html: ansiToHtml(ev.message) }}
      />
    </div>
  );
};

export default function LogPanel(): preact.JSX.Element {
  const [events, setEvents] = useState<readonly LogEvent[]>(getLogEvents());
  const [autoScroll, setAutoScroll] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      subscribe(() => {
        setEvents([...getLogEvents()]);
      }),
    [],
  );

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const visible = showDebug
    ? events
    : events.filter((e) => e.level !== "debug");

  return (
    <>
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
        <button
          type="button"
          onClick={(): void => clearLogEvents()}
        >
          clear
        </button>
      </div>
      <div id="log" ref={logRef}>
        {visible.map((ev, i) => <LogEntry key={i} ev={ev} />)}
      </div>
    </>
  );
}
