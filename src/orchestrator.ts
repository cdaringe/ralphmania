// coverage:ignore — Private helpers require real git worktrees and subprocess execution
import type { EscalationLevel, Logger } from "./types.ts";
import { runIteration as runIterationImpl } from "./runner.ts";
import { runValidation as runValidationImpl } from "./validation.ts";
import {
  cleanupWorktree as cleanupWorktreeImpl,
  createWorktree as createWorktreeImpl,
  hasNewCommits as hasNewCommitsImpl,
  mergeWorktree as mergeWorktreeImpl,
  resetWorkingTree as resetWorkingTreeImpl,
} from "./worktree.ts";
import { reconcileMerge as reconcileMergeImpl } from "./reconcile.ts";
import {
  readEscalationState as readEscalationStateImpl,
  writeEscalationState as writeEscalationStateImpl,
} from "./model.ts";
import type { Plugin } from "./plugin.ts";
import {
  clearLoopCheckpoint,
  readLoopCheckpoint,
  writeLoopCheckpoint,
} from "./state.ts";
import type { MachineContext, MachineDeps } from "./state-machine.ts";
import { isTerminal, transition } from "./state-machine.ts";
import type { OrchestratorState } from "./state-machine.ts";
export type { WorkerResult } from "./state-machine.ts";

/** Dependencies injectable for testing. Alias for {@link MachineDeps}. */
export type ParallelDeps = MachineDeps;

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
  readEscalationState: readEscalationStateImpl,
  writeEscalationState: writeEscalationStateImpl,
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
    agent: string;
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
  const deps: ParallelDeps = {
    ...defaultDeps,
    readProgress: () => readProgressContent(progressFile),
    ...depsOverride,
  };

  const ctx: MachineContext = {
    agent: agent as MachineContext["agent"],
    iterations,
    parallelism,
    expectedScenarioCount,
    signal,
    log,
    plugin,
    level,
    specFile: specFile ?? undefined,
    progressFile: progressFile ?? undefined,
    deps,
  };

  let state: OrchestratorState = { tag: "init" };

  while (!isTerminal(state)) {
    state = await transition(state, ctx);
  }

  await deps.clearCheckpoint();

  return state.tag === "aborted" ? 130 : state.iterationsUsed;
};
