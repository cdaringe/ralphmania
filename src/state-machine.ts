/**
 * Orchestrator state machine. Each state is an immutable tagged object
 * carrying the data needed for the next transition. The main loop
 * repeatedly calls {@link transition} until a terminal state is reached.
 *
 * @module
 */

import type {
  Agent,
  EscalationLevel,
  EscalationState,
  IterationResult,
  Logger,
  LoopCheckpoint,
  Result,
  ValidationResult,
} from "./types.ts";
import type { WorktreeInfo } from "./worktree.ts";
import type { Plugin } from "./plugin.ts";
import {
  findActionableScenarios,
  findReworkScenarios,
  isAllVerified,
  parseProgressRows,
  updateEscalationState,
  validateProgressStatuses,
} from "./model.ts";
import { dim, green, yellow } from "./colors.ts";

// ---------------------------------------------------------------------------
// Dependencies (same as ParallelDeps, re-exported for convenience)
// ---------------------------------------------------------------------------

/** Dependencies injectable for testing. */
export type MachineDeps = {
  readonly readProgress: () => Promise<string>;
  readonly createWorktree: (
    opts: { scenario: number; workerIndex: number; log: Logger },
  ) => Promise<Result<WorktreeInfo, string>>;
  readonly runIteration: (
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
  readonly runValidation: (
    opts: { iterationNum: number; log: Logger; cwd?: string },
  ) => Promise<ValidationResult>;
  readonly hasNewCommits: (
    opts: { worktree: WorktreeInfo; log: Logger },
  ) => Promise<boolean>;
  readonly mergeWorktree: (
    opts: { worktree: WorktreeInfo; log: Logger },
  ) => Promise<"merged" | "conflict">;
  readonly cleanupWorktree: (
    opts: { worktree: WorktreeInfo; log: Logger },
  ) => Promise<Result<void, string>>;
  readonly resetWorkingTree: (
    opts: { log: Logger },
  ) => Promise<Result<void, string>>;
  readonly reconcileMerge: (
    opts: {
      worktree: WorktreeInfo;
      agent: Agent;
      signal: AbortSignal;
      log: Logger;
    },
  ) => Promise<void>;
  readonly readCheckpoint: () => Promise<LoopCheckpoint | undefined>;
  readonly writeCheckpoint: (checkpoint: LoopCheckpoint) => Promise<void>;
  readonly clearCheckpoint: () => Promise<void>;
  readonly readEscalationState: (log: Logger) => Promise<EscalationState>;
  readonly writeEscalationState: (
    state: EscalationState,
    log: Logger,
  ) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Context — immutable config threaded through every transition
// ---------------------------------------------------------------------------

export type MachineContext = {
  readonly agent: Agent;
  readonly iterations: number;
  readonly parallelism: number;
  readonly expectedScenarioCount: number;
  readonly signal: AbortSignal;
  readonly log: Logger;
  readonly plugin: Plugin;
  readonly level: EscalationLevel | undefined;
  readonly specFile: string | undefined;
  readonly progressFile: string | undefined;
  readonly deps: MachineDeps;
};

// ---------------------------------------------------------------------------
// Worker result (carried through running_workers → validating)
// ---------------------------------------------------------------------------

export type WorkerResult = {
  readonly workerIndex: number;
  readonly iterationResult: IterationResult;
  readonly worktree: WorktreeInfo;
};

// ---------------------------------------------------------------------------
// State discriminated union — every variant is deeply readonly
// ---------------------------------------------------------------------------

export type InitState = Readonly<{ tag: "init" }>;

export type ReadingProgressState = Readonly<{
  tag: "reading_progress";
  iterationsUsed: number;
  validationFailurePath: string | undefined;
}>;

export type FindingActionableState = Readonly<{
  tag: "finding_actionable";
  iterationsUsed: number;
  validationFailurePath: string | undefined;
  progressContent: string;
}>;

export type RunningWorkersState = Readonly<{
  tag: "running_workers";
  iterationsUsed: number;
  validationFailurePath: string | undefined;
  uniqueActionable: readonly number[];
  escalation: Readonly<EscalationState>;
}>;

export type ValidatingState = Readonly<{
  tag: "validating";
  iterationsUsed: number;
  validationFailurePath: string | undefined;
}>;

export type CheckingDonenessState = Readonly<{
  tag: "checking_doneness";
  iterationsUsed: number;
  validationFailurePath: string | undefined;
}>;

export type DoneState = Readonly<{ tag: "done"; iterationsUsed: number }>;

export type AbortedState = Readonly<{ tag: "aborted" }>;

export type OrchestratorState =
  | InitState
  | ReadingProgressState
  | FindingActionableState
  | RunningWorkersState
  | ValidatingState
  | CheckingDonenessState
  | DoneState
  | AbortedState;

/** Returns `true` for terminal states that end the loop. */
export const isTerminal = (
  s: OrchestratorState,
): s is DoneState | AbortedState => s.tag === "done" || s.tag === "aborted";

// ---------------------------------------------------------------------------
// Per-state transition functions with narrow return types
// ---------------------------------------------------------------------------

const prefixLog = (log: Logger, workerIndex: number): Logger => (opts) =>
  log({ ...opts, message: `[W${workerIndex}] ${opts.message}` });

export const transitionInit = async (
  ctx: MachineContext,
): Promise<ReadingProgressState | ValidatingState> => {
  const checkpoint = await ctx.deps.readCheckpoint();
  const iterationsUsed = checkpoint?.iterationsUsed ?? 0;
  const validationFailurePath = checkpoint?.validationFailurePath;

  if (checkpoint) {
    ctx.log({
      tags: ["info", "orchestrator"],
      message:
        `Resuming from checkpoint: iteration ${iterationsUsed}, step=${checkpoint.step}, validationFailurePath=${
          validationFailurePath ?? "none"
        }`,
    });
  }

  if (checkpoint?.step === "validate") {
    return { tag: "validating", iterationsUsed, validationFailurePath };
  }
  return { tag: "reading_progress", iterationsUsed, validationFailurePath };
};

export const transitionReadingProgress = async (
  state: ReadingProgressState,
  ctx: MachineContext,
): Promise<FindingActionableState | DoneState | AbortedState> => {
  if (ctx.signal.aborted) {
    ctx.log({ tags: ["error"], message: "Exiting due to signal" });
    return { tag: "aborted" };
  }

  if (state.iterationsUsed >= ctx.iterations) {
    return { tag: "done", iterationsUsed: state.iterationsUsed };
  }

  const content = await ctx.deps.readProgress();
  let validationFailurePath = state.validationFailurePath;

  const invalidStatuses = validateProgressStatuses(content);
  if (invalidStatuses.length > 0) {
    for (const { scenario, status } of invalidStatuses) {
      ctx.log({
        tags: ["error", "orchestrator"],
        message:
          `Scenario ${scenario} has invalid status "${status}". Valid statuses: WIP, WORK_COMPLETE, VERIFIED, NEEDS_REWORK, OBSOLETE`,
      });
    }
    validationFailurePath = undefined;
  }

  if (isAllVerified(content, ctx.expectedScenarioCount)) {
    ctx.log({
      tags: ["info", "orchestrator"],
      message: green("All scenarios VERIFIED"),
    });
    return { tag: "done", iterationsUsed: state.iterationsUsed };
  }

  return {
    tag: "finding_actionable",
    iterationsUsed: state.iterationsUsed,
    validationFailurePath,
    progressContent: content,
  };
};

export const transitionFindingActionable = async (
  state: FindingActionableState,
  ctx: MachineContext,
): Promise<RunningWorkersState | DoneState> => {
  const content = state.progressContent;
  const reworkScenarios = [...new Set(findReworkScenarios(content))];
  const allActionable = findActionableScenarios(content);
  const reworkSet = new Set(reworkScenarios);
  const merged = [
    ...reworkScenarios,
    ...allActionable.filter((s) => !reworkSet.has(s)),
  ];
  const seen = new Set<number>();
  const uniqueActionable = merged.filter((s) =>
    seen.has(s) ? false : (seen.add(s), true)
  );

  if (uniqueActionable.length === 0) {
    const presentIds = new Set(
      parseProgressRows(content).map((r) => r.scenario),
    );
    const missingIds: number[] = [];
    for (let i = 1; i <= ctx.expectedScenarioCount; i++) {
      if (!presentIds.has(i)) missingIds.push(i);
    }
    if (missingIds.length > 0) {
      ctx.log({
        tags: ["error", "orchestrator"],
        message:
          `progress.md is missing scenario(s) [${missingIds.join(", ")}] that the spec expects — scenarios are missing from progress.md`,
      });
    }
    ctx.log({
      tags: ["info", "orchestrator"],
      message: green("No actionable scenarios remain — exiting loop"),
    });
    return { tag: "done", iterationsUsed: state.iterationsUsed };
  }

  const currentEscalation = await ctx.deps.readEscalationState(ctx.log);
  const newEscalation = updateEscalationState({
    current: currentEscalation,
    reworkScenarios,
  });
  await ctx.deps.writeEscalationState(newEscalation, ctx.log);

  return {
    tag: "running_workers",
    iterationsUsed: state.iterationsUsed,
    validationFailurePath: state.validationFailurePath,
    uniqueActionable,
    escalation: newEscalation,
  };
};

export const transitionRunningWorkers = async (
  state: RunningWorkersState,
  ctx: MachineContext,
): Promise<ValidatingState | ReadingProgressState> => {
  const { uniqueActionable, escalation, iterationsUsed } = state;

  await ctx.deps.writeCheckpoint({
    iterationsUsed,
    step: "agent",
    validationFailurePath: state.validationFailurePath,
  });

  const workerCount = Math.min(ctx.parallelism, uniqueActionable.length);
  ctx.log({
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
        ctx.deps.createWorktree({
          scenario: uniqueActionable[i] ?? i,
          workerIndex: i,
          log: ctx.log,
        }),
    ),
  );
  const worktrees = worktreeResults.flatMap((wt, i) =>
    wt.ok ? [wt.value] : (ctx.log({
      tags: ["error", "orchestrator"],
      message: `Failed to create worktree for worker ${i}: ${wt.error}`,
    }),
      [])
  );

  if (worktrees.length === 0) {
    ctx.log({
      tags: ["error", "orchestrator"],
      message: "No worktrees created, skipping round",
    });
    // Skip validation — go back to reading progress for the next round.
    return {
      tag: "reading_progress",
      iterationsUsed: iterationsUsed + 1,
      validationFailurePath: state.validationFailurePath,
    };
  }

  // Run workers in parallel — each targets a distinct scenario
  let results: readonly WorkerResult[] = [];
  try {
    results = await Promise.all(
      worktrees.map((wt, i) => {
        const scenario = uniqueActionable[i];
        const scenarioEscalation = scenario !== undefined
          ? escalation[String(scenario)] ?? 0
          : 0;
        const effectiveLevel = Math.max(
          ctx.level ?? 0,
          scenarioEscalation,
        ) as EscalationLevel;
        const wLog = prefixLog(ctx.log, i);
        return ctx.deps.runIteration({
          iterationNum: iterationsUsed,
          agent: ctx.agent,
          signal: ctx.signal,
          log: wLog,
          validationFailurePath: state.validationFailurePath,
          plugin: ctx.plugin,
          level: effectiveLevel,
          cwd: wt.path,
          specFile: ctx.specFile,
          progressFile: ctx.progressFile,
          ...(scenario !== undefined
            ? { targetScenarioOverride: scenario }
            : {}),
        }).then((iterationResult): WorkerResult => ({
          workerIndex: i,
          iterationResult,
          worktree: wt,
        }));
      }),
    );
  } finally {
    // Discard uncommitted changes before merging
    await ctx.deps.resetWorkingTree({ log: ctx.log });

    // Sequential merge — retry with -X theirs, then reconcile via agent
    for (const wr of results) {
      const has = await ctx.deps.hasNewCommits({
        worktree: wr.worktree,
        log: ctx.log,
      });
      if (
        has &&
        await ctx.deps.mergeWorktree({
            worktree: wr.worktree,
            log: ctx.log,
          }) === "conflict"
      ) {
        ctx.log({
          tags: ["info", "orchestrator"],
          message: yellow(
            `Worker ${wr.workerIndex} scenario ${
              uniqueActionable[wr.workerIndex]
            }: entering agent reconciliation`,
          ),
        });
        await ctx.deps.reconcileMerge({
          worktree: wr.worktree,
          agent: ctx.agent,
          signal: ctx.signal,
          log: ctx.log,
        });
      }
    }

    // Detect: did each worker's scenario actually land?
    const postMerge = await ctx.deps.readProgress();
    const stillActionable = new Set(findActionableScenarios(postMerge));
    results.forEach((wr) => {
      const scenario = uniqueActionable[wr.workerIndex];
      if (scenario !== undefined) {
        if (stillActionable.has(scenario)) {
          ctx.log({
            tags: ["info", "orchestrator"],
            message: yellow(
              `Scenario ${scenario}: still actionable after worker ${wr.workerIndex}`,
            ),
          });
        } else {
          ctx.log({
            tags: ["info", "orchestrator"],
            message: green(
              `Scenario ${scenario}: resolved by worker ${wr.workerIndex}`,
            ),
          });
        }
      }
    });

    // Cleanup all worktrees
    await Promise.all(
      worktrees.map((wt) =>
        ctx.deps.cleanupWorktree({ worktree: wt, log: ctx.log })
      ),
    );
  }

  return {
    tag: "validating",
    iterationsUsed,
    validationFailurePath: state.validationFailurePath,
  };
};

export const transitionValidating = async (
  state: ValidatingState,
  ctx: MachineContext,
): Promise<CheckingDonenessState> => {
  await ctx.deps.writeCheckpoint({
    iterationsUsed: state.iterationsUsed,
    step: "validate",
    validationFailurePath: state.validationFailurePath,
  });

  ctx.log({
    tags: ["info", "orchestrator"],
    message: dim("Running validation on merged result..."),
  });

  const rawValidation = await ctx.deps.runValidation({
    iterationNum: state.iterationsUsed,
    log: ctx.log,
  });
  const validation = ctx.plugin.onValidationComplete
    ? await ctx.plugin.onValidationComplete({
      result: rawValidation,
      ctx: {
        agent: ctx.agent,
        log: ctx.log,
        iterationNum: state.iterationsUsed,
      },
    })
    : rawValidation;

  const validationFailurePath = validation.status === "failed"
    ? validation.outputPath
    : undefined;

  const iterationsUsed = state.iterationsUsed + 1;

  await ctx.deps.writeCheckpoint({
    iterationsUsed,
    step: "done",
    validationFailurePath,
  });

  return { tag: "checking_doneness", iterationsUsed, validationFailurePath };
};

export const transitionCheckingDoneness = async (
  state: CheckingDonenessState,
  ctx: MachineContext,
): Promise<ReadingProgressState | DoneState> => {
  const content = await ctx.deps.readProgress();
  if (isAllVerified(content, ctx.expectedScenarioCount)) {
    ctx.log({
      tags: ["info", "orchestrator"],
      message: green("All scenarios VERIFIED"),
    });
    return { tag: "done", iterationsUsed: state.iterationsUsed };
  }
  return {
    tag: "reading_progress",
    iterationsUsed: state.iterationsUsed,
    validationFailurePath: state.validationFailurePath,
  };
};

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

/** Advance the state machine by one step. */
export const transition = async (
  state: OrchestratorState,
  ctx: MachineContext,
): Promise<OrchestratorState> => {
  const from = state.tag;
  let next: OrchestratorState;
  switch (state.tag) {
    case "init":
      next = await transitionInit(ctx);
      break;
    case "reading_progress":
      next = await transitionReadingProgress(state, ctx);
      break;
    case "finding_actionable":
      next = await transitionFindingActionable(state, ctx);
      break;
    case "running_workers":
      next = await transitionRunningWorkers(state, ctx);
      break;
    case "validating":
      next = await transitionValidating(state, ctx);
      break;
    case "checking_doneness":
      next = await transitionCheckingDoneness(state, ctx);
      break;
    case "done":
    case "aborted":
      return state;
  }
  ctx.log({
    tags: ["debug", "orchestrator", "transition"],
    message: `${from} → ${next.tag}`,
  });
  return next;
};
