import type {
  Agent,
  EscalationLevel,
  IterationResult,
  Logger,
  Result,
} from "./types.ts";
import { runIteration as runIterationImpl } from "./runner.ts";
import { runValidation as runValidationImpl } from "./validation.ts";
import {
  cleanupWorktree as cleanupWorktreeImpl,
  createWorktree as createWorktreeImpl,
  hasNewCommits as hasNewCommitsImpl,
  mergeWorktree as mergeWorktreeImpl,
} from "./worktree.ts";
import type { WorktreeInfo } from "./worktree.ts";
import { isAllVerified } from "./model.ts";
import type { Plugin } from "./plugin.ts";
import { dim, green, yellow } from "./colors.ts";

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
    },
  ) => Promise<IterationResult>;
  runValidation: (
    opts: { iterationNum: number; log: Logger; cwd?: string },
  ) => Promise<unknown>;
  hasNewCommits: (
    opts: { worktree: WorktreeInfo; log: Logger },
  ) => Promise<boolean>;
  mergeWorktree: (
    opts: { worktree: WorktreeInfo; log: Logger },
  ) => Promise<"merged" | "conflict">;
  cleanupWorktree: (
    opts: { worktree: WorktreeInfo; log: Logger },
  ) => Promise<Result<void, string>>;
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
    iterate,
  }: {
    agent: Agent;
    workerIndex: number;
    iterationNum: number;
    signal: AbortSignal;
    log: Logger;
    plugin: Plugin;
    level: EscalationLevel | undefined;
    worktreePath: string;
    iterate: ParallelDeps["runIteration"];
  },
): Promise<IterationResult> => {
  const wLog = prefixLog(log, workerIndex);
  return await iterate({
    iterationNum,
    agent,
    signal,
    log: wLog,
    validationFailurePath: undefined,
    plugin,
    level,
    cwd: worktreePath,
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
  let iterationsUsed = 0;

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

    log({
      tags: ["info", "parallel"],
      message: `Round ${iterationsUsed}: launching ${parallelism} worker(s)`,
    });

    // Create worktrees
    const worktreeResults = await Promise.all(
      Array.from(
        { length: parallelism },
        (_, i) => deps.createWorktree({ scenario: i, workerIndex: i, log }),
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

    // Run workers in parallel — each agent decides what to work on
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
            iterate: deps.runIteration,
          }).then((iterationResult): WorkerResult => ({
            workerIndex: i,
            iterationResult,
            worktree: wt,
          }))
        ),
      );
    } finally {
      // Sequential merge of worktrees with new commits
      for (const wr of results) {
        const has = await deps.hasNewCommits({ worktree: wr.worktree, log });
        has && await deps.mergeWorktree({ worktree: wr.worktree, log }) ===
            "conflict" &&
          log({
            tags: ["info", "parallel"],
            message: yellow(
              `Worker ${wr.workerIndex} had merge conflict, will retry`,
            ),
          });
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
    await deps.runValidation({ iterationNum: iterationsUsed, log });

    ++iterationsUsed;

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

  return iterationsUsed;
};
