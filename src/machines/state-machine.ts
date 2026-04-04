/**
 * Orchestrator state machine. Each state is an immutable tagged object
 * carrying the data needed for the next transition. The main loop
 * repeatedly calls {@link transition} until a terminal state is reached.
 *
 * @module
 */

import type {
  EscalationLevel,
  EscalationState,
  IterationResult,
  Logger,
  ModelLadder,
  RectifyAction,
} from "../types.ts";
import type { WorktreeInfo } from "../git/worktree.ts";
import type { Plugin } from "../plugin.ts";
import type { MachineDeps } from "../ports/types.ts";
import {
  computeEffectiveLevel,
  updateEscalationState,
} from "../orchestrator/escalation.ts";
import {
  findActionableScenarios,
  isAllVerified,
  orderActionableScenarios,
  parseProgressRows,
  validateProgressStatuses,
} from "../orchestrator/progress-queries.ts";
import { parseScenarioIds } from "../progress.ts";
import { dim, green, yellow } from "../colors.ts";
import { difference, xor } from "../set-fns.ts";
import { formatDuration, Status } from "../constants.ts";
import { MERGE_LOG_ID, resetWorkerLog } from "../gui/log-dir.ts";

const buildRectifyPrompt = (validationFailurePath: string): string =>
  `You are the escalated rectification agent operating on the merged main branch.

Your only goal in this pass is to get validation back on track.

Required steps:
1. Read the validation failure output at ${validationFailurePath}.
2. Investigate the current merged code and identify the concrete cause.
3. Make the smallest effective code, test, or configuration changes needed to fix the validation failure.
4. Refrain from unrelated feature work or broad scenario implementation unless it is directly required to restore validation.
5. Keep progress tracking coherent if your fix changes scenario state.

Focus on producing a merged state that will pass the next validation run.

When validation passes, COMMIT.`;

// ---------------------------------------------------------------------------
// Deep completion verification — re-reads spec + progress from disk
// ---------------------------------------------------------------------------

/**
 * Re-parse both spec and progress from disk, detect ID mismatches, and
 * verify every scenario is VERIFIED/OBSOLETE. Returns `true` only when the
 * spec IDs and progress IDs are in perfect agreement and all are done.
 */
const verifyCompletion = async (
  ctx: MachineContext,
  existingProgressContent?: string,
): Promise<{ done: boolean; freshSpecIds: readonly string[] }> => {
  const [specContent, progressContent] = existingProgressContent !== undefined
    ? [await ctx.deps.readSpec(), existingProgressContent]
    : await Promise.all([ctx.deps.readSpec(), ctx.deps.readProgress()]);
  const freshSpecIds = parseScenarioIds(specContent);
  const parsed = parseProgressRows(progressContent);
  if (parsed.isErr()) {
    ctx.log({
      tags: ["error", "orchestrator"],
      message: `deep-verify parse error: ${parsed.error}`,
    });
    return { done: false, freshSpecIds };
  }

  const progressIds = parsed.value.map((r) => r.scenario);
  const mismatch = xor(freshSpecIds, progressIds);
  if (mismatch.size > 0) {
    const parts: string[] = [];
    const inSpecNotProgress = difference(freshSpecIds, progressIds);
    const inProgressNotSpec = difference(progressIds, freshSpecIds);
    if (inSpecNotProgress.size > 0) {
      parts.push(
        `in spec but not progress: [${[...inSpecNotProgress].join(", ")}]`,
      );
    }
    if (inProgressNotSpec.size > 0) {
      parts.push(
        `in progress but not spec: [${[...inProgressNotSpec].join(", ")}]`,
      );
    }
    ctx.log({
      tags: ["error", "orchestrator"],
      message: `scenario id mismatch — ${parts.join("; ")}`,
    });
    return { done: false, freshSpecIds };
  }

  const allVerifiedResult = isAllVerified(progressContent, freshSpecIds);
  return {
    done: allVerifiedResult.isOk() && allVerifiedResult.value,
    freshSpecIds,
  };
};

// ---------------------------------------------------------------------------
// Progress diff tracking — logs status changes between iterations
// ---------------------------------------------------------------------------

let previousStatuses: Map<string, string> = new Map();

/** Reset progress diff state (useful for testing). */
export const resetProgressDiff = (): void => {
  previousStatuses = new Map();
};

const logProgressDiff = (
  rows: { scenario: string; status: string }[],
  log: Logger,
): void => {
  const current = new Map(rows.map((r) => [r.scenario, r.status]));
  if (previousStatuses.size > 0) {
    const changes: string[] = [];
    for (const [id, status] of current) {
      const prev = previousStatuses.get(id);
      if (prev !== undefined && prev !== status) {
        changes.push(`${id}: ${prev} → ${status}`);
      } else if (prev === undefined) {
        changes.push(`${id}: (new) → ${status}`);
      }
    }
    if (changes.length > 0) {
      log({
        tags: ["info", "orchestrator", "progress-diff"],
        message: `Progress changes: ${changes.join(", ")}`,
      });
    }
  }
  previousStatuses = current;
};

// ---------------------------------------------------------------------------
// Context — immutable config threaded through every transition
// ---------------------------------------------------------------------------

export type MachineContext = {
  readonly ladder: ModelLadder;
  readonly iterations: number;
  readonly parallelism: number;
  readonly expectedScenarioIds: readonly string[];
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
  /** Epoch ms when the worker started executing. */
  readonly startedAt: number;
  /** Epoch ms when the worker finished (including validation re-run if any). */
  readonly completedAt: number;
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
  uniqueActionable: readonly string[];
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

export type RectifyingState = Readonly<{
  tag: "rectifying";
  iterationsUsed: number;
  /** Always present — this state is only entered on validation failure. */
  validationFailurePath: string;
}>;

export type ReValidatingState = Readonly<{
  tag: "re_validating";
  iterationsUsed: number;
  validationFailurePath: string;
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
  | RectifyingState
  | ReValidatingState
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
): Promise<ReadingProgressState | ValidatingState | RectifyingState> => {
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
  if (checkpoint?.step === "rectify" && validationFailurePath) {
    return { tag: "rectifying", iterationsUsed, validationFailurePath };
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

  // Log scenario status changes between rounds.
  const diffParsed = parseProgressRows(content);
  if (diffParsed.isOk()) {
    logProgressDiff(diffParsed.value, ctx.log);
  }

  const invalidResult = validateProgressStatuses(content);
  if (invalidResult.isErr()) {
    ctx.log({
      tags: ["error", "orchestrator"],
      message: invalidResult.error,
    });
    validationFailurePath = undefined;
  } else if (invalidResult.value.length > 0) {
    for (const { scenario, status } of invalidResult.value) {
      ctx.log({
        tags: ["error", "orchestrator"],
        message:
          `Scenario ${scenario} has invalid status "${status}". Valid statuses: WIP, WORK_COMPLETE, VERIFIED, NEEDS_REWORK, OBSOLETE`,
      });
    }
    validationFailurePath = undefined;
  }

  if (!validationFailurePath) {
    const { done } = await verifyCompletion(ctx, content);
    if (done) {
      ctx.log({
        tags: ["info", "orchestrator"],
        message: green("All scenarios VERIFIED"),
      });
      return { tag: "done", iterationsUsed: state.iterationsUsed };
    }
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
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) {
    ctx.log({
      tags: ["error", "orchestrator"],
      message: parsed.error,
    });
    return { tag: "done", iterationsUsed: state.iterationsUsed };
  }
  const rows = parsed.value;
  const specIds = ctx.expectedScenarioIds;
  const progressIds = rows.map((r) => r.scenario);
  const mismatch = xor(specIds, progressIds);
  if (mismatch.size > 0) {
    const parts: string[] = [];
    const inSpecNotProgress = difference(specIds, progressIds);
    const inProgressNotSpec = difference(progressIds, specIds);
    if (inSpecNotProgress.size > 0) {
      parts.push(
        `in spec but not progress: [${[...inSpecNotProgress].join(", ")}]`,
      );
    }
    if (inProgressNotSpec.size > 0) {
      parts.push(
        `in progress but not spec: [${[...inProgressNotSpec].join(", ")}]`,
      );
    }
    ctx.log({
      tags: ["error", "orchestrator"],
      message: `scenario id mismatch — ${parts.join("; ")}`,
    });
  }

  const uniqueActionable = orderActionableScenarios(rows, specIds);

  if (uniqueActionable.length === 0 && !state.validationFailurePath) {
    ctx.log({
      tags: ["info", "orchestrator"],
      message: green("No actionable scenarios remain — exiting loop"),
    });
    return { tag: "done", iterationsUsed: state.iterationsUsed };
  }

  // Validation failed but all scenarios appear done — force the first
  // non-OBSOLETE spec scenario back into the actionable set so a worker
  // can address the validation failure.
  if (uniqueActionable.length === 0 && state.validationFailurePath) {
    const obsoleteIds = new Set(
      rows
        .filter((r) => r.status === Status.OBSOLETE)
        .map((r) => r.scenario),
    );
    const forced = specIds.filter((id) => !obsoleteIds.has(id));
    if (forced.length === 0) {
      ctx.log({
        tags: ["error", "orchestrator"],
        message:
          "Validation failed but all spec scenarios are OBSOLETE — cannot recover",
      });
      return { tag: "done", iterationsUsed: state.iterationsUsed };
    }
    ctx.log({
      tags: ["info", "orchestrator"],
      message: yellow(
        `Validation failed but no actionable scenarios — forcing scenarios [${
          forced.join(", ")
        }] back to actionable`,
      ),
    });
    uniqueActionable.push(...forced);
  }

  const currentEscalation = await ctx.deps.readEscalationState(ctx.log);
  const reworkScenarios = rows
    .filter((r) => r.status === Status.NEEDS_REWORK)
    .map((r) => r.scenario);
  const reworkUpdated = updateEscalationState({
    current: currentEscalation,
    reworkScenarios,
  });
  // Preserve escalation from worker validation failures for scenarios
  // that haven't been resolved — only clear resolved (VERIFIED/OBSOLETE).
  const resolvedScenarios = new Set(
    rows
      .filter((r) =>
        r.status === Status.VERIFIED || r.status === Status.OBSOLETE
      )
      .map((r) => r.scenario),
  );
  const newEscalation: EscalationState = {
    ...Object.fromEntries(
      Object.entries(currentEscalation)
        .filter(([k]) => !resolvedScenarios.has(k)),
    ),
    ...reworkUpdated,
  };
  await ctx.deps.writeEscalationState(newEscalation, ctx.log);

  const batchScenarios = await ctx.deps.selectScenarioBatch({
    scenarioIds: uniqueActionable,
    specFile: ctx.specFile,
    parallelism: ctx.parallelism,
    log: ctx.log,
  });

  if (batchScenarios.length < uniqueActionable.length) {
    ctx.log({
      tags: ["info", "orchestrator"],
      message:
        `Conflict-aware dispatch: ${uniqueActionable.length} actionable → ${batchScenarios.length} batch (parallelism=${ctx.parallelism})`,
    });
  }

  return {
    tag: "running_workers",
    iterationsUsed: state.iterationsUsed,
    validationFailurePath: state.validationFailurePath,
    uniqueActionable: batchScenarios,
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
    wt.isOk() ? [wt.value] : (ctx.log({
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
        const effectiveLevel = computeEffectiveLevel(
          scenario,
          escalation,
          ctx.level,
        );
        const wLog = prefixLog(ctx.log, i);
        const startedAt = Date.now();
        return ctx.deps.runIteration({
          iterationNum: iterationsUsed,
          ladder: ctx.ladder,
          signal: ctx.signal,
          log: wLog,
          validationFailurePath: state.validationFailurePath,
          plugin: ctx.plugin,
          level: effectiveLevel,
          cwd: wt.path,
          specFile: ctx.specFile,
          progressFile: ctx.progressFile,
          workerIndex: i,
          ...(scenario !== undefined
            ? { targetScenarioOverride: scenario }
            : {}),
        }).then(async (iterationResult): Promise<WorkerResult> => {
          // Run validation in the worker's worktree before merging
          const validation = await ctx.deps.runValidation({
            iterationNum: iterationsUsed,
            log: wLog,
            cwd: wt.path,
          });
          if (validation.status === "failed") {
            // Persist escalation for the failed scenario so it survives
            // a mid-re-run exit (the user may Ctrl-C during the fix
            // iteration below). Without this write the escalation is lost
            // on resume — the orchestrator would see an empty state file.
            const updatedEscalation = scenario !== undefined
              ? { ...escalation, [scenario]: 1 as EscalationLevel }
              : escalation;
            await ctx.deps.writeEscalationState(updatedEscalation, wLog);
            const escalatedLevel = computeEffectiveLevel(
              scenario,
              updatedEscalation,
              ctx.level,
            );

            wLog({
              tags: ["info", "orchestrator"],
              message: yellow(
                `Worker ${i} validation failed, re-running iteration to fix`,
              ),
            });
            // Re-run iteration with the validation failure so the agent can fix
            await ctx.deps.runIteration({
              iterationNum: iterationsUsed,
              ladder: ctx.ladder,
              signal: ctx.signal,
              log: wLog,
              validationFailurePath: validation.outputPath,
              plugin: ctx.plugin,
              level: escalatedLevel,
              cwd: wt.path,
              specFile: ctx.specFile,
              progressFile: ctx.progressFile,
              workerIndex: i,
              ...(scenario !== undefined
                ? { targetScenarioOverride: scenario }
                : {}),
            });
          }
          return {
            workerIndex: i,
            iterationResult,
            worktree: wt,
            startedAt,
            completedAt: Date.now(),
          };
        });
      }),
    );
  } finally {
    // Discard uncommitted changes before merging
    await ctx.deps.resetWorkingTree({ log: ctx.log });

    // Reset merge log so each round gets a fresh stream.
    await resetWorkerLog(MERGE_LOG_ID).catch(() => {});

    // Sequential merge — retry with -X theirs, then reconcile via agent
    for (const wr of results) {
      const scenario = uniqueActionable[wr.workerIndex] ?? "unknown";
      ctx.log({
        tags: ["info", "orchestrator"],
        message: `Merging worker ${wr.workerIndex} (${scenario})`,
      });
      const has = await ctx.deps.hasNewCommits({
        worktree: wr.worktree,
        log: ctx.log,
      });
      if (!has) {
        ctx.log({
          tags: ["info", "orchestrator"],
          message: `Worker ${wr.workerIndex} merge: no-changes`,
        });
        continue;
      }
      const mergeResult = await ctx.deps.mergeWorktree({
        worktree: wr.worktree,
        log: ctx.log,
      });
      if (mergeResult === "conflict") {
        ctx.log({
          tags: ["info", "orchestrator"],
          message: yellow(
            `Worker ${wr.workerIndex} scenario ${scenario}: entering agent reconciliation`,
          ),
        });
        await ctx.deps.reconcileMerge({
          worktree: wr.worktree,
          ladder: ctx.ladder,
          signal: ctx.signal,
          log: ctx.log,
        });
        ctx.log({
          tags: ["info", "orchestrator"],
          message: `Worker ${wr.workerIndex} merge: conflict`,
        });
      } else {
        ctx.log({
          tags: ["info", "orchestrator"],
          message: `Worker ${wr.workerIndex} merge: merged`,
        });
      }
    }

    // Detect: did each worker's scenario actually land?
    const postMerge = await ctx.deps.readProgress();
    const actionableResult = findActionableScenarios(postMerge);
    const stillActionable = new Set(
      actionableResult.isOk() ? actionableResult.value : [],
    );
    results.forEach((wr) => {
      const scenario = uniqueActionable[wr.workerIndex];
      const elapsed = formatDuration(wr.completedAt - wr.startedAt);
      if (scenario !== undefined) {
        if (stillActionable.has(scenario)) {
          ctx.log({
            tags: ["info", "orchestrator"],
            message: yellow(
              `Scenario ${scenario}: still actionable after worker ${wr.workerIndex} (${elapsed})`,
            ),
          });
        } else {
          ctx.log({
            tags: ["info", "orchestrator"],
            message: green(
              `Scenario ${scenario}: resolved by worker ${wr.workerIndex} (${elapsed})`,
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
        ladder: ctx.ladder,
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
): Promise<ReadingProgressState | RectifyingState | DoneState> => {
  if (!state.validationFailurePath) {
    const { done } = await verifyCompletion(ctx);
    if (done) {
      ctx.log({
        tags: ["info", "orchestrator"],
        message: green("All scenarios VERIFIED"),
      });
      return { tag: "done", iterationsUsed: state.iterationsUsed };
    }
  }

  // Route to rectification when validation failed and iteration budget remains.
  if (
    state.validationFailurePath &&
    state.iterationsUsed < ctx.iterations
  ) {
    return {
      tag: "rectifying",
      iterationsUsed: state.iterationsUsed,
      validationFailurePath: state.validationFailurePath,
    };
  }

  return {
    tag: "reading_progress",
    iterationsUsed: state.iterationsUsed,
    validationFailurePath: state.validationFailurePath,
  };
};

// ---------------------------------------------------------------------------
// Rectification — targeted fix cycle on merged main after validation failure
// ---------------------------------------------------------------------------

export const transitionRectifying = async (
  state: RectifyingState,
  ctx: MachineContext,
): Promise<ReValidatingState | ReadingProgressState | DoneState> => {
  await ctx.deps.writeCheckpoint({
    iterationsUsed: state.iterationsUsed,
    step: "rectify",
    validationFailurePath: state.validationFailurePath,
  });

  ctx.log({
    tags: ["info", "orchestrator"],
    message: yellow(
      `Rectifying validation failures (iteration ${state.iterationsUsed})...`,
    ),
  });

  const hookCtx = {
    ladder: ctx.ladder,
    log: ctx.log,
    iterationNum: state.iterationsUsed,
  };

  const action: RectifyAction = ctx.plugin.onRectify
    ? await ctx.plugin.onRectify({
      validationFailurePath: state.validationFailurePath,
      iterationsUsed: state.iterationsUsed,
      ctx: hookCtx,
    })
    : { action: "agent" };

  if (action.action === "skip") {
    ctx.log({
      tags: ["info", "orchestrator"],
      message: "Plugin skipped rectification — falling back to normal flow",
    });
    return {
      tag: "reading_progress",
      iterationsUsed: state.iterationsUsed,
      validationFailurePath: state.validationFailurePath,
    };
  }

  if (action.action === "abort") {
    ctx.log({
      tags: ["info", "orchestrator"],
      message: `Plugin aborted rectification: ${action.reason}`,
    });
    return { tag: "done", iterationsUsed: state.iterationsUsed };
  }

  // Run the rectification agent on main (no worktree isolation).
  await ctx.deps.runIteration({
    iterationNum: state.iterationsUsed,
    ladder: ctx.ladder,
    signal: ctx.signal,
    log: ctx.log,
    validationFailurePath: state.validationFailurePath,
    plugin: ctx.plugin,
    level: 1,
    promptOverride: action.promptOverride ??
      buildRectifyPrompt(state.validationFailurePath),
    specFile: ctx.specFile,
    progressFile: ctx.progressFile,
  });

  return {
    tag: "re_validating",
    iterationsUsed: state.iterationsUsed,
    validationFailurePath: state.validationFailurePath,
  };
};

export const transitionReValidating = async (
  state: ReValidatingState,
  ctx: MachineContext,
): Promise<CheckingDonenessState | ReadingProgressState> => {
  await ctx.deps.writeCheckpoint({
    iterationsUsed: state.iterationsUsed,
    step: "validate",
    validationFailurePath: state.validationFailurePath,
  });

  ctx.log({
    tags: ["info", "orchestrator"],
    message: dim("Re-validating after rectification..."),
  });

  const rawValidation = await ctx.deps.runValidation({
    iterationNum: state.iterationsUsed,
    log: ctx.log,
  });
  const validation = ctx.plugin.onValidationComplete
    ? await ctx.plugin.onValidationComplete({
      result: rawValidation,
      ctx: {
        ladder: ctx.ladder,
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

  if (validationFailurePath) {
    ctx.log({
      tags: ["info", "orchestrator"],
      message:
        "Rectification validation still failing; resuming normal iteration flow",
    });
    return {
      tag: "reading_progress",
      iterationsUsed,
      validationFailurePath,
    };
  }

  return { tag: "checking_doneness", iterationsUsed, validationFailurePath };
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
    case "rectifying":
      next = await transitionRectifying(state, ctx);
      break;
    case "re_validating":
      next = await transitionReValidating(state, ctx);
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
