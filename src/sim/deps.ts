/**
 * Simulated MachineDeps adapter.
 *
 * Implements every {@link MachineDeps} method using in-memory state and
 * the {@link SimController} configuration. No filesystem, git, or agent
 * subprocess calls are made. The real orchestrator loop runs unmodified.
 *
 * @module
 */

import type { EscalationState, LoopCheckpoint } from "../types.ts";
import type { MachineDeps } from "../ports/types.ts";
import type { WorktreeInfo } from "../git/worktree.ts";
import { ok } from "../types.ts";
import { PROFILE_DELAYS, type SimController } from "./controller.ts";
import {
  generateSimProgress,
  generateSimScenarioIds,
  generateSimSpec,
} from "./fixtures.ts";
import { resetWorkerLog, writeWorkerLine } from "../gui/log-dir.ts";
import type { GuiLogEvent } from "../gui/events.ts";

const delay = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

/** Faux agent output lines emitted during a simulated worker run. */
const FAUX_LINES: readonly string[] = [
  "Reading specification and progress files...",
  "Analyzing scenario requirements...",
  "Planning implementation approach...",
  "Writing code changes...",
  "Running local checks...",
  "Updating progress tracking...",
  "Committing changes...",
];

/** Write a single line to the worker log file (same format as real runner). */
const emitWorkerLine = (workerId: string, message: string): Promise<void> => {
  const event: GuiLogEvent = {
    type: "log",
    level: "info",
    tags: ["info", "agent-stream", workerId],
    message,
    ts: Date.now(),
    workerId,
  };
  return writeWorkerLine(workerId, event);
};

/** Stream faux agent output lines over time for a simulated worker. */
const streamFauxOutput = async (
  workerId: string,
  totalMs: number,
): Promise<void> => {
  const lineDelay = totalMs > 0 ? Math.floor(totalMs / FAUX_LINES.length) : 0;
  for (const line of FAUX_LINES) {
    await emitWorkerLine(workerId, line);
    await delay(lineDelay);
  }
};

/**
 * Create a MachineDeps backed entirely by simulation state.
 *
 * The returned deps read scenario count and outcomes from the controller,
 * track progress/escalation/checkpoints in memory, and emit realistic
 * log messages so the GUI event bus sees authentic-looking activity.
 */
export const createSimDeps = (
  controller: SimController,
): MachineDeps => {
  // In-memory state
  let checkpoint: LoopCheckpoint | undefined;
  let escalation: EscalationState = {};
  const scenarioStatuses = new Map<string, string>();

  // Reset all in-memory state when the controller is reset.
  controller.onReset(() => {
    checkpoint = undefined;
    escalation = {};
    scenarioStatuses.clear();
  });

  /** Lazily initialize scenario statuses when the count changes. */
  const ensureStatuses = (): void => {
    const ids = generateSimScenarioIds(controller.scenarioCount);
    for (const id of ids) {
      if (!scenarioStatuses.has(id)) {
        scenarioStatuses.set(id, "WIP");
      }
    }
    // Remove stale entries if count shrunk
    for (const id of scenarioStatuses.keys()) {
      if (Number(id) > controller.scenarioCount) {
        scenarioStatuses.delete(id);
      }
    }
  };

  return {
    readProgress: () => {
      ensureStatuses();
      return Promise.resolve(generateSimProgress(scenarioStatuses));
    },

    readSpec: () => Promise.resolve(generateSimSpec(controller.scenarioCount)),

    createWorktree: ({ scenario, workerIndex }) => {
      const wt: WorktreeInfo = {
        path: `/tmp/sim-worktree-${workerIndex}`,
        branch: `ralph/sim-${scenario}-${Date.now()}`,
        scenario,
      };
      return Promise.resolve(ok(wt));
    },

    runIteration: async ({ log, workerIndex, targetScenarioOverride }) => {
      const delays = PROFILE_DELAYS[controller.profile];
      const scenario = targetScenarioOverride ?? "unknown";
      const idx = workerIndex ?? 0;

      // Reset and stream faux output to the worker log file.
      await resetWorkerLog(scenario).catch(() => {});
      await emitWorkerLine(
        scenario,
        `[sim] Worker ${idx} starting on scenario ${scenario}`,
      );

      log({
        tags: ["info", "worker"],
        message: `[sim] Worker ${idx} starting on scenario ${scenario}`,
      });

      // Stream faux agent output lines while waiting.
      await streamFauxOutput(scenario, delays.worker);
      await controller.waitForAdvance();

      // Check for configured failure
      if (Math.random() < controller.workerFailureRate) {
        const msg = `[sim] Worker ${idx} timed out on scenario ${scenario}`;
        await emitWorkerLine(scenario, msg);
        log({ tags: ["info", "worker"], message: msg });
        return { status: "timeout" as const };
      }

      const outcome = controller.scenarioOutcomes.get(scenario) ?? "complete";

      switch (outcome) {
        case "complete": {
          ensureStatuses();
          scenarioStatuses.set(scenario, "WORK_COMPLETE");
          const msg =
            `[sim] Worker ${idx} completed scenario ${scenario} -> WORK_COMPLETE`;
          await emitWorkerLine(scenario, msg);
          log({ tags: ["info", "worker"], message: msg });
          return { status: "complete" as const };
        }

        case "needs_rework": {
          ensureStatuses();
          scenarioStatuses.set(scenario, "NEEDS_REWORK");
          const msg =
            `[sim] Worker ${idx} scenario ${scenario} -> NEEDS_REWORK`;
          await emitWorkerLine(scenario, msg);
          log({ tags: ["info", "worker"], message: msg });
          return { status: "complete" as const };
        }

        case "timeout": {
          const msg = `[sim] Worker ${idx} timed out on scenario ${scenario}`;
          await emitWorkerLine(scenario, msg);
          log({ tags: ["info", "worker"], message: msg });
          return { status: "timeout" as const };
        }
      }
    },

    runValidation: async ({ log, iterationNum }) => {
      const delays = PROFILE_DELAYS[controller.profile];
      log({
        tags: ["info", "orchestrator"],
        message: `[sim] Running validation (iteration ${iterationNum})...`,
      });

      await delay(delays.validate);
      await controller.waitForAdvance();

      if (Math.random() < controller.validationFailureRate) {
        log({
          tags: ["info", "orchestrator"],
          message: "[sim] Validation FAILED",
        });
        return {
          status: "failed" as const,
          outputPath: "/tmp/sim-validation-failure.log",
        };
      }

      log({
        tags: ["info", "orchestrator"],
        message: "[sim] Validation PASSED",
      });

      // On pass, promote all WORK_COMPLETE -> VERIFIED
      ensureStatuses();
      for (const [id, status] of scenarioStatuses) {
        if (status === "WORK_COMPLETE") {
          scenarioStatuses.set(id, "VERIFIED");
        }
      }

      return { status: "passed" as const };
    },

    hasNewCommits: () => Promise.resolve(true),

    mergeWorktree: async ({ log, worktree }) => {
      const delays = PROFILE_DELAYS[controller.profile];

      log({
        tags: ["info", "orchestrator"],
        message: `[sim] Merging ${worktree.branch}...`,
      });

      await delay(delays.merge);

      if (Math.random() < controller.mergeConflictRate) {
        log({
          tags: ["info", "orchestrator"],
          message: `[sim] Merge conflict on ${worktree.branch}`,
        });
        return "conflict";
      }

      log({
        tags: ["info", "orchestrator"],
        message: `[sim] Merged ${worktree.branch} cleanly`,
      });
      return "merged";
    },

    cleanupWorktree: () => Promise.resolve(ok(undefined)),

    resetWorkingTree: () => Promise.resolve(ok(undefined)),

    reconcileMerge: async ({ log, worktree }) => {
      const delays = PROFILE_DELAYS[controller.profile];
      log({
        tags: ["info", "orchestrator"],
        message: `[sim] Reconciling merge conflict on ${worktree.branch}...`,
      });
      await delay(delays.merge);
      log({
        tags: ["info", "orchestrator"],
        message: `[sim] Conflict resolved for ${worktree.branch}`,
      });
    },

    readCheckpoint: () => Promise.resolve(checkpoint),

    writeCheckpoint: (cp) => {
      checkpoint = cp;
      return Promise.resolve();
    },

    clearCheckpoint: () => {
      checkpoint = undefined;
      return Promise.resolve();
    },

    readEscalationState: () => Promise.resolve(escalation),

    writeEscalationState: (state) => {
      escalation = state;
      return Promise.resolve();
    },

    selectScenarioBatch: ({ scenarioIds, parallelism }) =>
      Promise.resolve(scenarioIds.slice(0, Math.max(1, parallelism))),
  };
};
