/**
 * Log panel island — renders streaming log events with ANSI color
 * conversion, debug filtering, auto-scroll, and clear.
 * @module
 */
import { useEffect, useRef, useState } from "preact/hooks";
import {
  clearLogEvents,
  getLogEvents,
  getLogVersion,
  subscribe,
} from "./event-store.ts";
import { LogEntry } from "../client/log-entry.tsx";

export default function LogPanel(): preact.JSX.Element {
  const [version, setVersion] = useState(getLogVersion());
  const [autoScroll, setAutoScroll] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      subscribe(() => {
        setVersion(getLogVersion());
      }, ["logs"]),
    [],
  );

  const events = getLogEvents();

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [version, autoScroll]);

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
        {visible.map((ev) => <LogEntry key={ev.seq} ev={ev} showTags />)}
      </div>
    </>
  );
}
