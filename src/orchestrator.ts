// coverage:ignore — Private helpers require real git worktrees and subprocess execution
import type {
  Agent,
  EscalationLevel,
  IterationResult,
  Logger,
  LoopCheckpoint,
  Result,
  ValidationResult,
} from "./types.ts";
import { runIteration as runIterationImpl } from "./runner.ts";
import { runValidation as runValidationImpl } from "./validation.ts";
import {
  cleanupWorktree as cleanupWorktreeImpl,
  createWorktree as createWorktreeImpl,
  hasNewCommits as hasNewCommitsImpl,
  mergeWorktree as mergeWorktreeImpl,
  resetWorkingTree as resetWorkingTreeImpl,
} from "./worktree.ts";
import type { WorktreeInfo } from "./worktree.ts";
import { reconcileMerge as reconcileMergeImpl } from "./reconcile.ts";
import {
  findActionableScenarios,
  findReworkScenarios,
  isAllVerified,
  parseProgressRows,
  validateProgressStatuses,
} from "./model.ts";
import type { Plugin } from "./plugin.ts";
import { dim, green, yellow } from "./colors.ts";
import {
  clearLoopCheckpoint,
  readLoopCheckpoint,
  writeLoopCheckpoint,
} from "./state.ts";

export type WorkerResult = {
  readonly workerIndex: number;
  readonly iterationResult: IterationResult;
  readonly worktree: WorktreeInfo;
};

/** Dependencies injectable for testing. */
export type ParallelDeps = {
  readProgress: () => Promise<string>;
  createWorktree: (
    opts: { scenario: number; workerIndex: number; log: Logger },
  ) => Promise<Result<WorktreeInfo, string>>;
  runIteration: (
    opts: {
      iterationNum: number;
      agent: Agent;
      signal: AbortSignal;
      log: Logger;
      validationFailurePath: string | undefined;
      plugin: Plugin;
      level: EscalationLevel | undefined;
      cwd?: string;
      targetScenarioOverride?: number;
      specFile?: string;
      progressFile?: string;
    },
  ) => Promise<IterationResult>;
  runValidation: (
    opts: { iterationNum: number; log: Logger; cwd?: string },
  ) => Promise<ValidationResult>;
  hasNewCommits: (
    opts: { worktree: WorktreeInfo; log: Logger },
  ) => Promise<boolean>;
  mergeWorktree: (
    opts: { worktree: WorktreeInfo; log: Logger },
  ) => Promise<"merged" | "conflict">;
  cleanupWorktree: (
    opts: { worktree: WorktreeInfo; log: Logger },
  ) => Promise<Result<void, string>>;
  resetWorkingTree: (
    opts: { log: Logger },
  ) => Promise<Result<void, string>>;
  reconcileMerge: (
    opts: {
      worktree: WorktreeInfo;
      agent: Agent;
      signal: AbortSignal;
      log: Logger;
    },
  ) => Promise<void>;
  readCheckpoint: () => Promise<LoopCheckpoint | undefined>;
  writeCheckpoint: (checkpoint: LoopCheckpoint) => Promise<void>;
  clearCheckpoint: () => Promise<void>;
};

const prefixLog = (
  log: Logger,
  workerIndex: number,
): Logger =>
(opts) =>
  log({
    ...opts,
    message: `[W${workerIndex}] ${opts.message}`,
  });

const runWorker = async (
  {
    agent,
    workerIndex,
    iterationNum,
    signal,
    log,
    plugin,
    level,
    worktreePath,
    validationFailurePath,
    iterate,
    targetScenarioOverride,
    specFile,
    progressFile,
  }: {
    agent: Agent;
    workerIndex: number;
    iterationNum: number;
    signal: AbortSignal;
    log: Logger;
    plugin: Plugin;
    level: EscalationLevel | undefined;
    worktreePath: string;
    validationFailurePath: string | undefined;
    iterate: ParallelDeps["runIteration"];
    targetScenarioOverride?: number;
    specFile?: string;
    progressFile?: string;
  },
): Promise<IterationResult> => {
  const wLog = prefixLog(log, workerIndex);
  return await iterate({
    iterationNum,
    agent,
    signal,
    log: wLog,
    validationFailurePath,
    plugin,
    level,
    cwd: worktreePath,
    specFile,
    progressFile,
    ...(targetScenarioOverride !== undefined ? { targetScenarioOverride } : {}),
  });
};

const readProgressContent = async (
  progressFile = "./progress.md",
): Promise<string> => {
  const raw = await Deno.readTextFile(progressFile).catch(() => "");
  return raw.split("END_DEMO")[1] ?? "";
};

const defaultDeps: ParallelDeps = {
  readProgress: readProgressContent,
  createWorktree: createWorktreeImpl,
  runIteration: runIterationImpl,
  runValidation: runValidationImpl,
  hasNewCommits: hasNewCommitsImpl,
  mergeWorktree: mergeWorktreeImpl,
  cleanupWorktree: cleanupWorktreeImpl,
  resetWorkingTree: resetWorkingTreeImpl,
  reconcileMerge: reconcileMergeImpl,
  readCheckpoint: readLoopCheckpoint,
  writeCheckpoint: writeLoopCheckpoint,
  clearCheckpoint: clearLoopCheckpoint,
};

export const runParallelLoop = async (
  {
    agent,
    iterations,
    parallelism,
    expectedScenarioCount,
    signal,
    log,
    plugin,
    level,
    specFile,
    progressFile,
    deps: depsOverride,
  }: {
    agent: Agent;
    iterations: number;
    parallelism: number;
    expectedScenarioCount: number;
    signal: AbortSignal;
    log: Logger;
    plugin: Plugin;
    level: EscalationLevel | undefined;
    specFile?: string;
    progressFile?: string;
    deps?: Partial<ParallelDeps>;
  },
): Promise<number> => {
  const deps = {
    ...defaultDeps,
    readProgress: () => readProgressContent(progressFile),
    ...depsOverride,
  };

  // Restore loop state from a prior run, if available.
  const checkpoint = await deps.readCheckpoint();
  let iterationsUsed = checkpoint?.iterationsUsed ?? 0;
  let validationFailurePath: string | undefined = checkpoint
    ?.validationFailurePath;
  // When the checkpoint was written before validation, skip agent work on the
  // first resumed iteration and jump straight to validation.
  let skipAgentWork = checkpoint?.step === "validate";
  checkpoint && log({
    tags: ["info", "orchestrator"],
    message:
      `Resuming from checkpoint: iteration ${iterationsUsed}, step=${checkpoint.step}, validationFailurePath=${
        validationFailurePath ?? "none"
      }`,
  });

  while (iterationsUsed < iterations) {
    if (signal.aborted) {
      log({ tags: ["error"], message: "Exiting due to signal" });
      return 130;
    }

    const content = await deps.readProgress();

    // Validate that all scenario statuses are recognized values.
    const invalidStatuses = validateProgressStatuses(content);
    if (invalidStatuses.length > 0) {
      for (const { scenario, status } of invalidStatuses) {
        log({
          tags: ["error", "orchestrator"],
          message:
            `Scenario ${scenario} has invalid status "${status}". Valid statuses: WIP, WORK_COMPLETE, VERIFIED, NEEDS_REWORK, OBSOLETE`,
        });
      }
      // Feed invalid status info as validation failure so the worker corrects it
      validationFailurePath = undefined;
    }

    if (isAllVerified(content, expectedScenarioCount)) {
      log({
        tags: ["info", "orchestrator"],
        message: green("All scenarios VERIFIED"),
      });
      break;
    }

    if (skipAgentWork) {
      log({
        tags: ["info", "orchestrator"],
        message:
          `Resuming iteration ${iterationsUsed} at validate step — skipping agent work`,
      });
      skipAgentWork = false;
    } else {
      // Checkpoint: about to start agent work for this iteration.
      await deps.writeCheckpoint({
        iterationsUsed,
        step: "agent",
        validationFailurePath,
      });

      // Compute actionable scenarios: NEEDS_REWORK first, then remaining.
      // Deduplicate to guarantee each worker targets a distinct scenario.
      const reworkScenarios = [...new Set(findReworkScenarios(content))];
      const allActionable = findActionableScenarios(content);
      const reworkSet = new Set(reworkScenarios);
      const actionableScenarios = [
        ...reworkScenarios,
        ...allActionable.filter((s) => !reworkSet.has(s)),
      ];
      const seen = new Set<number>();
      const uniqueActionable = actionableScenarios.filter((s) =>
        seen.has(s) ? false : (seen.add(s), true)
      );

      if (uniqueActionable.length === 0) {
        const progressRowCount = parseProgressRows(content).length;
        if (progressRowCount < expectedScenarioCount) {
          log({
            tags: ["error", "orchestrator"],
            message:
              `progress.md has ${progressRowCount} rows but spec expects ${expectedScenarioCount} — scenarios are missing from progress.md`,
          });
        }
        log({
          tags: ["info", "orchestrator"],
          message: green(
            "No actionable scenarios remain — exiting loop",
          ),
        });
        break;
      }

      const workerCount = Math.min(parallelism, uniqueActionable.length);

      log({
        tags: ["info", "orchestrator"],
        message:
          `Round ${iterationsUsed}: launching ${workerCount} worker(s) for scenarios [${
            uniqueActionable.slice(0, workerCount).join(", ")
          }]`,
      });

      // Create worktrees
      const worktreeResults = await Promise.all(
        Array.from(
          { length: workerCount },
          (_, i) =>
            deps.createWorktree({
              scenario: uniqueActionable[i] ?? i,
              workerIndex: i,
              log,
            }),
        ),
      );
      const worktrees = worktreeResults.flatMap((wt, i) =>
        wt.ok ? [wt.value] : (log({
          tags: ["error", "orchestrator"],
          message: `Failed to create worktree for worker ${i}: ${wt.error}`,
        }),
          [])
      );

      if (worktrees.length === 0) {
        log({
          tags: ["error", "orchestrator"],
          message: "No worktrees created, skipping round",
        });
        ++iterationsUsed;
        continue;
      }

      // Run workers in parallel — each targets a distinct scenario
      let results: readonly WorkerResult[] = [];
      try {
        results = await Promise.all(
          worktrees.map((wt, i) =>
            runWorker({
              agent,
              workerIndex: i,
              iterationNum: iterationsUsed,
              signal,
              log,
              plugin,
              level,
              worktreePath: wt.path,
              validationFailurePath,
              iterate: deps.runIteration,
              specFile,
              progressFile,
              targetScenarioOverride: uniqueActionable[i],
            }).then((iterationResult): WorkerResult => ({
              workerIndex: i,
              iterationResult,
              worktree: wt,
            }))
          ),
        );
      } finally {
        // Discard uncommitted changes (e.g. from deno fmt) before merging
        await deps.resetWorkingTree({ log });

        // Sequential merge — retry with -X theirs, then reconcile via agent
        for (const wr of results) {
          const has = await deps.hasNewCommits({ worktree: wr.worktree, log });
          has &&
            await deps.mergeWorktree({ worktree: wr.worktree, log }) ===
              "conflict" &&
            (log({
              tags: ["info", "orchestrator"],
              message: yellow(
                `Worker ${wr.workerIndex} scenario ${
                  uniqueActionable[wr.workerIndex]
                }: entering agent reconciliation`,
              ),
            }),
              await deps.reconcileMerge({
                worktree: wr.worktree,
                agent,
                signal,
                log,
              }));
        }

        // Detect: did each worker's scenario actually land?
        const postMerge = await deps.readProgress();
        const stillActionable = new Set(findActionableScenarios(postMerge));
        results.forEach((wr) => {
          const scenario = uniqueActionable[wr.workerIndex];
          scenario !== undefined &&
            (stillActionable.has(scenario)
              ? log({
                tags: ["info", "orchestrator"],
                message: yellow(
                  `Scenario ${scenario}: still actionable after worker ${wr.workerIndex}`,
                ),
              })
              : log({
                tags: ["info", "orchestrator"],
                message: green(
                  `Scenario ${scenario}: resolved by worker ${wr.workerIndex}`,
                ),
              }));
        });

        // Cleanup all worktrees
        await Promise.all(
          worktrees.map((wt) => deps.cleanupWorktree({ worktree: wt, log })),
        );
      }
    }

    // Checkpoint: agent+merge work done, about to validate.  On a subsequent
    // restart with this checkpoint the agent phase will be skipped.
    await deps.writeCheckpoint({
      iterationsUsed,
      step: "validate",
      validationFailurePath,
    });

    // Run validation on merged main
    log({
      tags: ["info", "orchestrator"],
      message: dim("Running validation on merged result..."),
    });
    const validation = await deps.runValidation({
      iterationNum: iterationsUsed,
      log,
    });
    validationFailurePath = validation.status === "failed"
      ? validation.outputPath
      : undefined;

    ++iterationsUsed;

    // Checkpoint: iteration fully complete.  iterationsUsed is already
    // incremented so the next restart begins the following round.
    await deps.writeCheckpoint({
      iterationsUsed,
      step: "done",
      validationFailurePath,
    });

    // Check if done
    const updatedContent = await deps.readProgress();
    if (isAllVerified(updatedContent, expectedScenarioCount)) {
      log({
        tags: ["info", "orchestrator"],
        message: green("All scenarios VERIFIED"),
      });
      break;
    }
  }

  // Clear checkpoint on clean exit so a fresh run starts from scratch.
  await deps.clearCheckpoint();

  return iterationsUsed;
};
