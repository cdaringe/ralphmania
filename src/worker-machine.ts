/**
 * Worker state machine.
 *
 * Models one agent iteration as a linear pipeline with plugin hooks at
 * each boundary. Separates pure logic (model selection, prompt building,
 * command building) from subprocess I/O (agent execution), making the
 * pure parts testable without real agent binaries.
 *
 * ```
 * resolving_model → model_resolved → prompt_built → command_built
 *     → running_agent → done
 * ```
 *
 * @module
 */

import type {
  Agent,
  CommandSpec,
  EscalationLevel,
  IterationResult,
  Logger,
  ModelSelection,
} from "./types.ts";
import type { HookContext, Plugin } from "./plugin.ts";
import { getModel, resolveModelSelection } from "./model.ts";
import { CLAUDE_CODER, CLAUDE_ESCALATED } from "./constants.ts";
import { buildCommandSpec, buildPrompt } from "./command.ts";

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

/**
 * Compute a ModelSelection for a worker assigned to a specific scenario
 * by the orchestrator. Uses the escalation ladder constants rather than
 * hardcoding mode/effort, so rework scenarios correctly escalate to
 * stronger models.
 *
 * The orchestrator pre-computes the effective escalation `level` per
 * scenario (incorporating both CLI --level and per-scenario state from
 * .ralph/escalation.json), so this function just maps level → config.
 */
export const resolveWorkerModelSelection = (
  { agent, level, targetScenario }: {
    agent: Agent;
    level: EscalationLevel | undefined;
    targetScenario: number;
  },
): ModelSelection => {
  if (agent === "claude") {
    const config = (level ?? 0) >= 1 ? CLAUDE_ESCALATED : CLAUDE_CODER;
    return {
      ...config,
      targetScenario,
      actionableScenarios: [targetScenario],
    };
  }
  // Codex: mode derived from escalation level
  const mode = (level ?? 0) >= 1 ? "strong" as const : "general" as const;
  return {
    model: getModel({ agent, mode }),
    mode,
    targetScenario,
    effort: undefined,
    actionableScenarios: [targetScenario],
  };
};

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type ResolvingModelState = Readonly<{
  tag: "resolving_model";
  iterationNum: number;
  agent: Agent;
  level: EscalationLevel | undefined;
  targetScenarioOverride: number | undefined;
  validationFailurePath: string | undefined;
  specFile: string | undefined;
  progressFile: string | undefined;
}>;

export type ModelResolvedState = Readonly<{
  tag: "model_resolved";
  iterationNum: number;
  agent: Agent;
  selection: ModelSelection;
  validationFailurePath: string | undefined;
  specFile: string | undefined;
  progressFile: string | undefined;
}>;

export type PromptBuiltState = Readonly<{
  tag: "prompt_built";
  iterationNum: number;
  agent: Agent;
  selection: ModelSelection;
  prompt: string;
}>;

export type CommandBuiltState = Readonly<{
  tag: "command_built";
  iterationNum: number;
  agent: Agent;
  selection: ModelSelection;
  spec: CommandSpec;
}>;

export type RunningAgentState = Readonly<{
  tag: "running_agent";
  iterationNum: number;
  agent: Agent;
  selection: ModelSelection;
  spec: CommandSpec;
}>;

export type DoneState = Readonly<{
  tag: "done";
  result: IterationResult;
}>;

export type WorkerState =
  | ResolvingModelState
  | ModelResolvedState
  | PromptBuiltState
  | CommandBuiltState
  | RunningAgentState
  | DoneState;

export const isWorkerTerminal = (s: WorkerState): s is DoneState =>
  s.tag === "done";

// ---------------------------------------------------------------------------
// Transition functions — narrow return types enforce valid edges
// ---------------------------------------------------------------------------

export const transitionResolvingModel = async (
  state: ResolvingModelState,
  plugin: Plugin,
  log: Logger,
): Promise<ModelResolvedState> => {
  const ctx: HookContext = {
    agent: state.agent,
    log,
    iterationNum: state.iterationNum,
  };

  const rawSelection: ModelSelection =
    state.targetScenarioOverride !== undefined
      ? resolveWorkerModelSelection({
        agent: state.agent,
        level: state.level,
        targetScenario: state.targetScenarioOverride,
      })
      : await resolveModelSelection({
        agent: state.agent,
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
    agent: state.agent,
    selection,
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
    agent: state.agent,
    log,
    iterationNum: state.iterationNum,
  };

  const rawPrompt = buildPrompt({
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
    agent: state.agent,
    selection: state.selection,
    prompt,
  };
};

export const transitionPromptBuilt = async (
  state: PromptBuiltState,
  plugin: Plugin,
  log: Logger,
): Promise<CommandBuiltState> => {
  const ctx: HookContext = {
    agent: state.agent,
    log,
    iterationNum: state.iterationNum,
  };

  const rawSpec = buildCommandSpec({
    agent: state.agent,
    model: state.selection.model,
    prompt: state.prompt,
  });

  const spec = plugin.onCommandBuilt
    ? await plugin.onCommandBuilt({
      spec: rawSpec,
      selection: state.selection,
      ctx,
    })
    : rawSpec;

  return {
    tag: "command_built",
    iterationNum: state.iterationNum,
    agent: state.agent,
    selection: state.selection,
    spec,
  };
};

/**
 * Dependencies for the agent execution step — the only I/O boundary
 * in the worker pipeline. Injectable for testing.
 */
export type AgentRunDeps = {
  /** Spawn the agent, stream output, return the iteration result. */
  readonly execute: (opts: {
    spec: CommandSpec;
    agent: Agent;
    selection: ModelSelection;
    iterationNum: number;
    signal: AbortSignal;
    log: Logger;
    cwd: string | undefined;
  }) => Promise<IterationResult>;
};

export const transitionCommandBuilt = (
  state: CommandBuiltState,
): RunningAgentState => ({
  tag: "running_agent",
  iterationNum: state.iterationNum,
  agent: state.agent,
  selection: state.selection,
  spec: state.spec,
});

export const transitionRunningAgent = async (
  state: RunningAgentState,
  deps: AgentRunDeps,
  plugin: Plugin,
  log: Logger,
  signal: AbortSignal,
  cwd: string | undefined,
): Promise<DoneState> => {
  const ctx: HookContext = {
    agent: state.agent,
    log,
    iterationNum: state.iterationNum,
  };

  log({
    tags: ["info", "iteration"],
    message: `Starting ${state.iterationNum} (${state.selection.model}${
      state.selection.effort ? `, effort: ${state.selection.effort}` : ""
    })...`,
  });

  const result = await deps.execute({
    spec: state.spec,
    agent: state.agent,
    selection: state.selection,
    iterationNum: state.iterationNum,
    signal,
    log,
    cwd,
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
      next = await transitionPromptBuilt(state, opts.plugin, opts.log);
      break;
    case "command_built":
      next = transitionCommandBuilt(state);
      break;
    case "running_agent":
      next = await transitionRunningAgent(
        state,
        opts.agentDeps,
        opts.plugin,
        opts.log,
        opts.signal,
        opts.cwd,
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
    agent: Agent;
    level: EscalationLevel | undefined;
    targetScenarioOverride: number | undefined;
    validationFailurePath: string | undefined;
    specFile: string | undefined;
    progressFile: string | undefined;
  },
): ResolvingModelState => ({
  tag: "resolving_model",
  ...opts,
});
