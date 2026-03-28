/**
 * Logger wrapper that also emits log events to a GuiEventBus,
 * enabling the GUI to display live log output and orchestrator state.
 *
 * @module
 */
import type { Logger } from "../types.ts";
import type { GuiEventBus } from "./events.ts";

/** Pattern matching the orchestrator's state-transition log message: "from → to". */
const TRANSITION_RE = /^(\w+) \u2192 (\w+)$/;

/**
 * Matches the worker-launch log line:
 * "Round N: launching M worker(s) for scenarios [s1, s2, ...]"
 */
const WORKER_LAUNCH_RE = /launching \d+ worker\(s\) for scenarios \[([^\]]+)\]/;

/**
 * Matches worker-completion log lines:
 * "Scenario X: resolved by worker N"
 * "Scenario X: still actionable after worker N"
 */
const WORKER_DONE_RE =
  /(?:resolved|still actionable) (?:by|after) worker (\d+)/;

/** Matches "Merging worker N (scenarioId)" */
const MERGE_START_RE = /^Merging worker (\d+) \((.+)\)$/;

/** Matches "Worker N merge: merged|conflict|no-changes" */
const MERGE_DONE_RE = /^Worker (\d+) merge: (merged|conflict|no-changes)$/;

/**
 * Returns a Logger that calls `base` for normal output and additionally:
 * - emits a `log` GuiEvent for every message
 * - emits a `state` GuiEvent when the message matches an orchestrator
 *   state-transition (`from → to` with the "transition" tag)
 * - emits `worker_active` GuiEvents when workers are launched
 * - emits `worker_done` GuiEvents when workers complete
 */
export const createGuiLogger =
  (base: Logger, bus: GuiEventBus): Logger => (opts): void => {
    base(opts);
    const ts = Date.now();
    bus.emit({
      type: "log",
      level: opts.tags[0],
      tags: opts.tags,
      message: opts.message,
      ts,
    });
    // Emit an explicit state event for orchestrator transitions so the GUI
    // state panel updates even when debug logs are hidden.
    if (
      (opts.tags as string[]).includes("transition")
    ) {
      const m = opts.message.match(TRANSITION_RE);
      if (m !== null) {
        bus.emit({ type: "state", from: m[1], to: m[2], ts });
      }
    }
    // Emit worker_active events when workers are launched (one per scenario/index).
    const launchM = opts.message.match(WORKER_LAUNCH_RE);
    if (launchM) {
      const scenarios = launchM[1].split(", ");
      scenarios.forEach((scenario, i) => {
        bus.emit({
          type: "worker_active",
          workerIndex: i,
          scenario: scenario.trim(),
          ts,
        });
      });
    }
    // Emit worker_done event when a worker's scenario resolves or remains actionable.
    const doneM = opts.message.match(WORKER_DONE_RE);
    if (doneM) {
      bus.emit({
        type: "worker_done",
        workerIndex: parseInt(doneM[1], 10),
        ts,
      });
    }
    // Emit merge_start when a worker's worktree merge begins.
    const mergeStartM = opts.message.match(MERGE_START_RE);
    if (mergeStartM) {
      bus.emit({
        type: "merge_start",
        workerIndex: parseInt(mergeStartM[1], 10),
        scenario: mergeStartM[2],
        ts,
      });
    }
    // Emit merge_done when a worker's worktree merge completes.
    const mergeDoneM = opts.message.match(MERGE_DONE_RE);
    if (mergeDoneM) {
      bus.emit({
        type: "merge_done",
        workerIndex: parseInt(mergeDoneM[1], 10),
        outcome: mergeDoneM[2] as "merged" | "conflict" | "no-changes",
        ts,
      });
    }
  };
