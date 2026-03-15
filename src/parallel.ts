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
    ...(targetScenarioOverride !== undefined ? { targetScenarioOverride } : {}),
  });
};

const readProgressContent = async (): Promise<string> => {
  const raw = await Deno.readTextFile("./progress.md").catch(() => "");
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
    signal,
    log,
    plugin,
    level,
    deps: depsOverride,
  }: {
    agent: Agent;
    iterations: number;
    parallelism: number;
    signal: AbortSignal;
    log: Logger;
    plugin: Plugin;
    level: EscalationLevel | undefined;
    deps?: Partial<ParallelDeps>;
  },
): Promise<number> => {
  const deps = { ...defaultDeps, ...depsOverride };

  // Restore loop state from a prior run, if available.
  const checkpoint = await deps.readCheckpoint();
  let iterationsUsed = checkpoint?.iterationsUsed ?? 0;
  let validationFailurePath: string | undefined = checkpoint
    ?.validationFailurePath;
  checkpoint && log({
    tags: ["info", "parallel"],
    message:
      `Resuming from checkpoint: iteration ${iterationsUsed}, validationFailurePath=${
        validationFailurePath ?? "none"
      }`,
  });

  while (iterationsUsed < iterations) {
    if (signal.aborted) {
      log({ tags: ["error"], message: "Exiting due to signal" });
      return 130;
    }

    const content = await deps.readProgress();

    if (isAllVerified(content)) {
      log({
        tags: ["info", "parallel"],
        message: green("All scenarios VERIFIED"),
      });
      break;
    }

    // Compute actionable scenarios: NEEDS_REWORK first, then remaining
    const reworkScenarios = findReworkScenarios(content);
    const allActionable = findActionableScenarios(content);
    const reworkSet = new Set(reworkScenarios);
    const actionableScenarios = [
      ...reworkScenarios,
      ...allActionable.filter((s) => !reworkSet.has(s)),
    ];

    const workerCount = Math.min(parallelism, actionableScenarios.length || 1);

    log({
      tags: ["info", "parallel"],
      message:
        `Round ${iterationsUsed}: launching ${workerCount} worker(s) for scenarios [${
          actionableScenarios.slice(0, workerCount).join(", ")
        }]`,
    });

    // Create worktrees
    const worktreeResults = await Promise.all(
      Array.from(
        { length: workerCount },
        (_, i) =>
          deps.createWorktree({
            scenario: actionableScenarios[i] ?? i,
            workerIndex: i,
            log,
          }),
      ),
    );
    const worktrees = worktreeResults.flatMap((wt, i) =>
      wt.ok ? [wt.value] : (log({
        tags: ["error", "parallel"],
        message: `Failed to create worktree for worker ${i}: ${wt.error}`,
      }),
        [])
    );

    if (worktrees.length === 0) {
      log({
        tags: ["error", "parallel"],
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
            ...(reworkSet.size > 0
              ? { targetScenarioOverride: actionableScenarios[i] }
              : {}),
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
            tags: ["info", "parallel"],
            message: yellow(
              `Worker ${wr.workerIndex} scenario ${
                actionableScenarios[wr.workerIndex]
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
      for (const wr of results) {
        const scenario = actionableScenarios[wr.workerIndex];
        scenario !== undefined &&
          (stillActionable.has(scenario)
            ? log({
              tags: ["info", "parallel"],
              message: yellow(
                `Scenario ${scenario}: still actionable after worker ${wr.workerIndex}`,
              ),
            })
            : log({
              tags: ["info", "parallel"],
              message: green(
                `Scenario ${scenario}: resolved by worker ${wr.workerIndex}`,
              ),
            }));
      }

      // Cleanup all worktrees
      await Promise.all(
        worktrees.map((wt) => deps.cleanupWorktree({ worktree: wt, log })),
      );
    }

    // Run validation on merged main
    log({
      tags: ["info", "parallel"],
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

    // Persist checkpoint so a restart can resume from this point.
    await deps.writeCheckpoint({ iterationsUsed, validationFailurePath });

    // Check if done
    const updatedContent = await deps.readProgress();
    if (isAllVerified(updatedContent)) {
      log({
        tags: ["info", "parallel"],
        message: green("All scenarios VERIFIED"),
      });
      break;
    }
  }

  // Clear checkpoint on clean exit so a fresh run starts from scratch.
  await deps.clearCheckpoint();

  return iterationsUsed;
};
