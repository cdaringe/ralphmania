/**
 * Worker state machine.
 *
 * Models one agent iteration as a linear pipeline with plugin hooks at
 * each boundary. Separates pure logic (model selection, prompt building,
 * session config) from I/O (agent execution), making the pure parts
 * testable without real agent binaries.
 *
 * ```
 * resolving_model -> model_resolved -> prompt_built -> config_built
 *     -> running_agent -> done
 * ```
 *
 * @module
 */

import type {
  AgentSessionConfig,
  EscalationLevel,
  IterationResult,
  Logger,
  ModelLadder,
  ModelSelection,
  ToolMode,
} from "../types.ts";
import type { AgentRunDeps } from "../ports/types.ts";
import type { HookContext, Plugin } from "../plugin.ts";
import { resolveModelSelection } from "../model.ts";
import { buildPrompt, buildSessionConfig } from "../command.ts";
import type { AgentInputBus } from "../gui/input-bus.ts";

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

/**
 * Compute a ModelSelection for a worker assigned to a specific scenario
 * by the orchestrator. Uses the model ladder so rework scenarios correctly
 * escalate to stronger models.
 */
export const resolveWorkerModelSelection = (
  { ladder, level, targetScenario }: {
    ladder: ModelLadder;
    level: EscalationLevel | undefined;
    targetScenario: string;
  },
): ModelSelection => {
  const mode: ToolMode = (level ?? 0) >= 1 ? "escalated" : "coder";
  const config = ladder[mode];
  return {
    provider: config.provider,
    model: config.model,
    mode,
    thinkingLevel: config.thinkingLevel,
    targetScenario,
    actionableScenarios: [targetScenario],
  };
};

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type ResolvingModelState = Readonly<{
  tag: "resolving_model";
  iterationNum: number;
  ladder: ModelLadder;
  level: EscalationLevel | undefined;
  targetScenarioOverride: string | undefined;
  promptOverride: string | undefined;
  validationFailurePath: string | undefined;
  specFile: string | undefined;
  progressFile: string | undefined;
}>;

export type ModelResolvedState = Readonly<{
  tag: "model_resolved";
  iterationNum: number;
  ladder: ModelLadder;
  selection: ModelSelection;
  promptOverride: string | undefined;
  validationFailurePath: string | undefined;
  specFile: string | undefined;
  progressFile: string | undefined;
}>;

export type PromptBuiltState = Readonly<{
  tag: "prompt_built";
  iterationNum: number;
  ladder: ModelLadder;
  selection: ModelSelection;
  prompt: string;
}>;

export type ConfigBuiltState = Readonly<{
  tag: "config_built";
  iterationNum: number;
  ladder: ModelLadder;
  selection: ModelSelection;
  config: AgentSessionConfig;
  prompt: string;
}>;

export type RunningAgentState = Readonly<{
  tag: "running_agent";
  iterationNum: number;
  ladder: ModelLadder;
  selection: ModelSelection;
  config: AgentSessionConfig;
  prompt: string;
}>;

export type DoneState = Readonly<{
  tag: "done";
  result: IterationResult;
}>;

export type WorkerState =
  | ResolvingModelState
  | ModelResolvedState
  | PromptBuiltState
  | ConfigBuiltState
  | RunningAgentState
  | DoneState;

export const isWorkerTerminal = (s: WorkerState): s is DoneState =>
  s.tag === "done";

// ---------------------------------------------------------------------------
// Transition functions -- narrow return types enforce valid edges
// ---------------------------------------------------------------------------

export const transitionResolvingModel = async (
  state: ResolvingModelState,
  plugin: Plugin,
  log: Logger,
): Promise<ModelResolvedState> => {
  const ctx: HookContext = {
    ladder: state.ladder,
    log,
    iterationNum: state.iterationNum,
  };

  const rawSelection: ModelSelection =
    state.targetScenarioOverride !== undefined
      ? resolveWorkerModelSelection({
        ladder: state.ladder,
        level: state.level,
        targetScenario: state.targetScenarioOverride,
      })
      : await resolveModelSelection({
        ladder: state.ladder,
        log,
        minLevel: state.level,
        progressFile: state.progressFile,
      });

  const selection = plugin.onModelSelected
    ? await plugin.onModelSelected({ selection: rawSelection, ctx })
    : rawSelection;

  return {
    tag: "model_resolved",
    iterationNum: state.iterationNum,
    ladder: state.ladder,
    selection,
    promptOverride: state.promptOverride,
    validationFailurePath: state.validationFailurePath,
    specFile: state.specFile,
    progressFile: state.progressFile,
  };
};

export const transitionModelResolved = async (
  state: ModelResolvedState,
  plugin: Plugin,
  log: Logger,
): Promise<PromptBuiltState> => {
  const ctx: HookContext = {
    ladder: state.ladder,
    log,
    iterationNum: state.iterationNum,
  };

  const rawPrompt = state.promptOverride ??
    buildPrompt({
      targetScenario: state.selection.targetScenario,
      validationFailurePath: state.validationFailurePath,
      actionableScenarios: state.selection.actionableScenarios,
      specFile: state.specFile,
      progressFile: state.progressFile,
    });

  const prompt = plugin.onPromptBuilt
    ? await plugin.onPromptBuilt({
      prompt: rawPrompt,
      selection: state.selection,
      ctx,
    })
    : rawPrompt;

  return {
    tag: "prompt_built",
    iterationNum: state.iterationNum,
    ladder: state.ladder,
    selection: state.selection,
    prompt,
  };
};

export const transitionPromptBuilt = async (
  state: PromptBuiltState,
  plugin: Plugin,
  log: Logger,
  cwd: string | undefined,
): Promise<ConfigBuiltState> => {
  const ctx: HookContext = {
    ladder: state.ladder,
    log,
    iterationNum: state.iterationNum,
  };

  const rawConfig = buildSessionConfig({
    selection: state.selection,
    workingDir: cwd ?? ".",
  });

  const config = plugin.onSessionConfigBuilt
    ? await plugin.onSessionConfigBuilt({
      config: rawConfig,
      selection: state.selection,
      ctx,
    })
    : rawConfig;

  return {
    tag: "config_built",
    iterationNum: state.iterationNum,
    ladder: state.ladder,
    selection: state.selection,
    config,
    prompt: state.prompt,
  };
};

export const transitionConfigBuilt = (
  state: ConfigBuiltState,
): RunningAgentState => ({
  tag: "running_agent",
  iterationNum: state.iterationNum,
  ladder: state.ladder,
  selection: state.selection,
  config: state.config,
  prompt: state.prompt,
});

export const transitionRunningAgent = async (
  state: RunningAgentState,
  deps: AgentRunDeps,
  plugin: Plugin,
  log: Logger,
  signal: AbortSignal,
  workerIndex?: number,
  agentInputBus?: AgentInputBus,
): Promise<DoneState> => {
  const ctx: HookContext = {
    ladder: state.ladder,
    log,
    iterationNum: state.iterationNum,
  };

  log({
    tags: ["info", "iteration"],
    message:
      `Starting ${state.iterationNum} (${state.selection.provider}/${state.selection.model}${
        state.selection.thinkingLevel
          ? `, thinking: ${state.selection.thinkingLevel}`
          : ""
      })...`,
  });

  const result = await deps.execute({
    config: state.config,
    prompt: state.prompt,
    selection: state.selection,
    iterationNum: state.iterationNum,
    signal,
    log,
    workerIndex,
    agentInputBus,
  });

  await plugin.onIterationEnd?.({ result, ctx });

  return { tag: "done", result };
};

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

/** Advance the worker state machine by one step. */
export const workerTransition = async (
  state: WorkerState,
  opts: {
    plugin: Plugin;
    log: Logger;
    signal: AbortSignal;
    cwd: string | undefined;
    agentDeps: AgentRunDeps;
    /** Passed to execute so it can build a colored per-line stdio prefix. */
    workerIndex?: number;
    /** When provided, routes GUI text input to the agent session. */
    agentInputBus?: AgentInputBus;
  },
): Promise<WorkerState> => {
  const from = state.tag;
  let next: WorkerState;
  switch (state.tag) {
    case "resolving_model":
      next = await transitionResolvingModel(state, opts.plugin, opts.log);
      break;
    case "model_resolved":
      next = await transitionModelResolved(state, opts.plugin, opts.log);
      break;
    case "prompt_built":
      next = await transitionPromptBuilt(
        state,
        opts.plugin,
        opts.log,
        opts.cwd,
      );
      break;
    case "config_built":
      next = transitionConfigBuilt(state);
      break;
    case "running_agent":
      next = await transitionRunningAgent(
        state,
        opts.agentDeps,
        opts.plugin,
        opts.log,
        opts.signal,
        opts.workerIndex,
        opts.agentInputBus,
      );
      break;
    case "done":
      return state;
  }
  opts.log({
    tags: ["debug", "worker", "transition"],
    message: `${from} → ${next.tag}`,
  });
  return next;
};

// ---------------------------------------------------------------------------
// Convenience: create initial state
// ---------------------------------------------------------------------------

export const initialWorkerState = (
  opts: {
    iterationNum: number;
    ladder: ModelLadder;
    level: EscalationLevel | undefined;
    targetScenarioOverride: string | undefined;
    promptOverride: string | undefined;
    validationFailurePath: string | undefined;
    specFile: string | undefined;
    progressFile: string | undefined;
  },
): ResolvingModelState => ({
  tag: "resolving_model",
  ...opts,
});
