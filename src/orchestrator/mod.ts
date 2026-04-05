import type { EscalationLevel, Logger, ModelLadder } from "../types.ts";
import type { AgentInputBus } from "../gui/input-bus.ts";
import { runIteration as runIterationImpl } from "../runner.ts";
import { runValidation as runValidationImpl } from "../validation.ts";
import {
  cleanupWorktree as cleanupWorktreeImpl,
  createWorktree as createWorktreeImpl,
  hasNewCommits as hasNewCommitsImpl,
  mergeWorktree as mergeWorktreeImpl,
  resetWorkingTree as resetWorkingTreeImpl,
} from "../git/worktree.ts";
import { reconcileMerge as reconcileMergeImpl } from "../git/reconcile.ts";
import {
  readEscalationState as readEscalationStateImpl,
  writeEscalationState as writeEscalationStateImpl,
} from "./escalation.ts";
import type { Plugin } from "../plugin.ts";
import {
  clearLoopCheckpoint,
  readLoopCheckpoint,
  writeLoopCheckpoint,
} from "../state.ts";
import type { MachineContext } from "../machines/state-machine.ts";
import type { MachineDeps } from "../ports/types.ts";
import { isTerminal, transition } from "../machines/state-machine.ts";
import type { OrchestratorState } from "../machines/state-machine.ts";
export type { WorkerResult } from "../machines/state-machine.ts";
import {
  clusterScenarios as clusterScenariosImpl,
  selectBatchFromClusters as selectBatchFromClustersImpl,
} from "./cluster.ts";

/** Dependencies injectable for testing. Alias for MachineDeps. */
export type ParallelDeps = MachineDeps;

/* c8 ignore start -- default I/O wiring for real subprocess deps */
const readProgressContent = async (
  progressFile = "./progress.md",
): Promise<string> => {
  const raw = await Deno.readTextFile(progressFile).catch(() => "");
  return raw.split("END_DEMO")[1] ?? "";
};

const readSpecContent = async (
  specFile = "./specification.md",
): Promise<string> => {
  const raw = await Deno.readTextFile(specFile).catch(() => "");
  return raw.split("END_DEMO")[1] ?? raw;
};

/**
 * Default fast-call implementation for scenario clustering. Uses pi-mono's
 * completion API with the coder model from the ladder.
 */
const makeRunFastCall = (
  ladder: ModelLadder,
): (prompt: string) => Promise<string> =>
async (prompt: string): Promise<string> => {
  const { complete } = await import("@mariozechner/pi-ai");
  const { resolveModel } = await import("../resolve-model.ts");
  const model = await resolveModel(ladder.coder.provider, ladder.coder.model);
  const result = await complete(model, {
    messages: [{
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    }],
  });
  // Extract text content from the AssistantMessage response.
  return result.content
    // deno-lint-ignore no-explicit-any
    .filter((c: any) => c.type === "text")
    // deno-lint-ignore no-explicit-any
    .map((c: any) => c.text as string)
    .join("");
};

const makeDefaultSelectScenarioBatch = (
  ladder: ModelLadder,
): MachineDeps["selectScenarioBatch"] =>
async ({
  scenarioIds,
  specFile,
  parallelism,
  log,
}: {
  scenarioIds: readonly string[];
  specFile: string | undefined;
  parallelism: number;
  log: Logger;
}): Promise<readonly string[]> => {
  if (parallelism <= 1 || scenarioIds.length <= 1) {
    return scenarioIds.slice(0, Math.max(1, parallelism));
  }

  const specContent = await Deno.readTextFile(specFile ?? "specification.md")
    .catch(() => "");

  const clusters = await clusterScenariosImpl({
    scenarioIds: [...scenarioIds],
    specContent,
    log,
    deps: { runFastCall: makeRunFastCall(ladder) },
  });

  return selectBatchFromClustersImpl(clusters, scenarioIds, parallelism);
};

const makeDefaultDeps = (ladder: ModelLadder): ParallelDeps => ({
  readProgress: readProgressContent,
  readSpec: readSpecContent,
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
  selectScenarioBatch: makeDefaultSelectScenarioBatch(ladder),
});
/* c8 ignore stop */

export const runParallelLoop = async (
  {
    ladder,
    iterations,
    parallelism,
    expectedScenarioIds,
    signal,
    log,
    plugin,
    level,
    specFile,
    progressFile,
    agentInputBus,
    deps: depsOverride,
  }: {
    ladder: ModelLadder;
    iterations: number;
    parallelism: number;
    expectedScenarioIds: readonly string[];
    signal: AbortSignal;
    log: Logger;
    plugin: Plugin;
    level: EscalationLevel | undefined;
    specFile?: string;
    progressFile?: string;
    /** When provided, routes GUI text input to active agent sessions. */
    agentInputBus?: AgentInputBus;
    deps?: Partial<ParallelDeps>;
  },
): Promise<number> => {
  const defaultDeps = makeDefaultDeps(ladder);
  const deps: ParallelDeps = {
    ...defaultDeps,
    readProgress: () => readProgressContent(progressFile),
    readSpec: () => readSpecContent(specFile),
    runIteration: (opts) => runIterationImpl({ ...opts, agentInputBus }),
    ...depsOverride,
  };

  const ctx: MachineContext = {
    ladder,
    iterations,
    parallelism,
    expectedScenarioIds,
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
