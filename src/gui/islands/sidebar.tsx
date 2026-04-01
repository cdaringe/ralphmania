/**
 * Sidebar island — orchestrator state, progress summary, worker cards.
 * @module
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import {
  getActiveWorkers,
  getConnected,
  getHydrated,
  getIteration,
  getOrchestratorState,
  setSelectedWorker,
  type StatusDiff,
  subscribe,
  type WorkerInfo,
} from "./event-store.ts";
import { escHtml } from "../client/html.ts";

export default function Sidebar(): preact.JSX.Element {
  const [hydrated, setHydrated] = useState(getHydrated());
  const [state, setState] = useState(getOrchestratorState());
  const [iter, setIter] = useState(getIteration());
  const [workers, setWorkers] = useState<ReadonlyMap<number, WorkerInfo>>(
    getActiveWorkers(),
  );
  const [status, setStatus] = useState<StatusDiff | undefined>(undefined);

  useEffect(
    () =>
      subscribe(() => {
        const newState = getOrchestratorState();
        if (newState !== state) fetchStatus();
        const nextHydrated = getHydrated();
        setHydrated(nextHydrated);
        if (!getConnected() || !nextHydrated) setStatus(undefined);
        setState(newState);
        setIter(getIteration());
        setWorkers(new Map(getActiveWorkers()));
      }, ["graph", "hydration", "iteration"]),
    [state],
  );

  const fetchStatus = useCallback((): void => {
    fetch("/api/status").then((r) => r.json()).then((d) => {
      if (!d.error) setStatus(d as StatusDiff);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const total = status ? status.specOnly.length + status.shared.length : 0;
  const verified = status
    ? status.shared.filter((s) => s.status === "VERIFIED").length
    : 0;
  const rework = status
    ? status.shared.filter((s) => s.status === "NEEDS_REWORK").length
    : 0;
  const wip = status
    ? status.shared.filter((s) =>
      s.status === "WIP" || s.status === "WORK_COMPLETE"
    ).length
    : 0;
  const ns = status?.specOnly.length ?? 0;

  const summaryParts = status
    ? [
      `${verified}/${total} verified`,
      ...(rework > 0 ? [`${rework} rework`] : []),
      ...(wip > 0 ? [`${wip} wip`] : []),
      ...(ns > 0 ? [`${ns} not started`] : []),
      ...(status.progressOnly.length > 0
        ? [`${status.progressOnly.length} orphaned`]
        : []),
    ]
    : [];

  return (
    <aside>
      <div>
        <div class="pt">Orchestrator</div>
        <div id="state-val">{hydrated ? state : "loading..."}</div>
      </div>
      <div>
        <div class="pt">
          Progress{" "}
          <a
            href="/status"
            target="_blank"
            style="font-size:9px;color:var(--muted);text-decoration:none;float:right"
          >
            {`[full \u2192]`}
          </a>
        </div>
        <div id="status-summary" style="font-size:11px;color:var(--muted)">
          {!hydrated
            ? "loading..."
            : summaryParts.length > 0
            ? summaryParts.join(" \u00b7 ")
            : "\u2014"}
        </div>
        {hydrated && status && (
          <div id="status-list">
            {status.shared.map((s) => (
              <a
                class="srow srow-link"
                key={s.id}
                href={`/scenario/${encodeURIComponent(s.id)}`}
              >
                <span>{escHtml(s.id)}</span>
                <span
                  class={`s-${s.status.toLowerCase().replace(/_/g, "-")}`}
                >
                  {escHtml(s.status)}
                </span>
              </a>
            ))}
            {status.specOnly.map((id) => (
              <a
                class="srow srow-link"
                key={id}
                href={`/scenario/${encodeURIComponent(id)}`}
              >
                <span>{escHtml(id)}</span>
                <span class="s-not-started">NOT_STARTED</span>
              </a>
            ))}
            {status.progressOnly.map((id) => (
              <div class="srow" key={id}>
                <span>{escHtml(id)}</span>
                <span class="s-orphaned">ORPHANED</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <div class="pt">Workers</div>
        <div id="workers">
          {workers.size === 0
            ? <span style="color:var(--muted);font-size:11px">none</span>
            : (
              [...workers.entries()].map(([idx, info]) => (
                <a
                  class="wcard"
                  key={idx}
                  onClick={(): void =>
                    setSelectedWorker({
                      workerIndex: idx,
                      scenario: info.scenario,
                    })}
                >
                  <span class="wid">W{idx}</span>{" "}
                  <span class="wscen">
                    → {escHtml(info.scenario)}
                  </span>
                </a>
              ))
            )}
        </div>
      </div>
      <div style="font-size:11px;color:var(--muted)">{iter}</div>
    </aside>
  );
}
