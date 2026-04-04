/**
 * Logger wrapper that also emits log events to a GuiEventBus,
 * enabling the GUI to display live log output and orchestrator state.
 *
 * @module
 */
import type { Logger } from "../types.ts";
import type { GuiEventBus } from "./events.ts";
import { writeWorkerLine } from "./log-dir.ts";
import { MERGE_LOG_ID, VALIDATE_LOG_ID } from "./log-dir.ts";

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

/** Matches "Running validation on merged result..." */
const VALIDATE_START_RE = /^Running validation on merged result/;

/** Matches "Validation passed (iteration N)" or "Validation failed (iteration N)" */
const VALIDATE_DONE_RE = /^Validation (passed|failed) \(iteration (\d+)\)/;

/** Matches "Validation TIMEOUT (iteration N)" or "Validation crashed (iteration N)" */
const VALIDATE_ERROR_RE = /^Validation (?:TIMEOUT|crashed) \(iteration (\d+)\)/;

/** Tags that indicate merge-phase log output. */
const MERGE_TAGS = new Set(["worktree", "reconcile"]);

/** Tags that indicate validation-phase log output. */
const VALIDATE_TAGS = new Set(["validate"]);

export type GuiLoggerOptions = {
  /** When true (default), mirror merge/validation log messages to dedicated log files. */
  readonly writePhaseLog?: boolean;
};

/**
 * Returns a Logger that calls `base` for normal output and additionally:
 * - emits a `log` GuiEvent for every message
 * - emits a `state` GuiEvent when the message matches an orchestrator
 *   state-transition (`from → to` with the "transition" tag)
 * - emits `worker_active` GuiEvents when workers are launched
 * - emits `worker_done` GuiEvents when workers complete
 */
export const createGuiLogger =
  (base: Logger, bus: GuiEventBus, options?: GuiLoggerOptions): Logger =>
  (opts): void => {
    const doWritePhaseLog = options?.writePhaseLog ?? true;
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
    // Emit validate_start when validation begins.
    if (VALIDATE_START_RE.test(opts.message)) {
      bus.emit({ type: "validate_start", iterationNum: -1, ts });
    }
    // Emit validate_done when validation completes.
    const valDoneM = opts.message.match(VALIDATE_DONE_RE);
    if (valDoneM) {
      bus.emit({
        type: "validate_done",
        iterationNum: parseInt(valDoneM[2], 10),
        outcome: valDoneM[1] as "passed" | "failed",
        ts,
      });
    }
    const valErrM = opts.message.match(VALIDATE_ERROR_RE);
    if (valErrM) {
      bus.emit({
        type: "validate_done",
        iterationNum: parseInt(valErrM[1], 10),
        outcome: "failed",
        ts,
      });
    }
    if (doWritePhaseLog) {
      // Mirror merge-phase log lines to the dedicated merge log stream.
      const isMergeMessage = mergeStartM || mergeDoneM ||
        (opts.tags as string[]).some((t) => MERGE_TAGS.has(t)) ||
        /reconciliation|entering agent/.test(opts.message);
      if (isMergeMessage) {
        writeWorkerLine(MERGE_LOG_ID, {
          type: "log",
          level: opts.tags[0],
          tags: opts.tags,
          message: opts.message,
          ts,
          workerId: MERGE_LOG_ID,
        });
      }
      // Mirror validation-phase log lines to the dedicated validate log stream.
      if (
        (opts.tags as string[]).some((t) => VALIDATE_TAGS.has(t)) ||
        VALIDATE_START_RE.test(opts.message) || valDoneM || valErrM
      ) {
        writeWorkerLine(VALIDATE_LOG_ID, {
          type: "log",
          level: opts.tags[0],
          tags: opts.tags,
          message: opts.message,
          ts,
          workerId: VALIDATE_LOG_ID,
        });
      }
    }
  };
