import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  initialWorkerState,
  isWorkerTerminal,
  resolveWorkerModelSelection,
  transitionConfigBuilt,
  transitionModelResolved,
  transitionPromptBuilt,
  transitionResolvingModel,
  transitionRunningAgent,
  workerTransition,
} from "../src/machines/worker-machine.ts";
import type {
  ConfigBuiltState,
  ModelResolvedState,
  PromptBuiltState,
  RunningAgentState,
  WorkerState,
} from "../src/machines/worker-machine.ts";
import type { Plugin } from "../src/plugin.ts";
import type { AgentSessionConfig, ModelSelection } from "../src/types.ts";
import { DEFAULT_MODEL_LADDER } from "../src/constants.ts";
import { noopLog } from "./fixtures.ts";

const sel = (overrides: Partial<ModelSelection> = {}): ModelSelection => ({
  provider: "anthropic",
  model: DEFAULT_MODEL_LADDER.coder.model,
  mode: "coder",
  targetScenario: "1",
  thinkingLevel: "high",
  actionableScenarios: ["1"],
  ...overrides,
});

const cfg = (
  overrides: Partial<AgentSessionConfig> = {},
): AgentSessionConfig => ({
  provider: "anthropic",
  model: DEFAULT_MODEL_LADDER.coder.model,
  workingDir: "/tmp",
  thinkingLevel: "high",
  ...overrides,
});

// ---------------------------------------------------------------------------
// resolveWorkerModelSelection
// ---------------------------------------------------------------------------

Deno.test("resolveWorkerModelSelection level 0 -> coder", () => {
  const s = resolveWorkerModelSelection({
    ladder: DEFAULT_MODEL_LADDER,
    level: 0,
    targetScenario: "3",
  });
  assertEquals(s.model, DEFAULT_MODEL_LADDER.coder.model);
  assertEquals(s.mode, "coder");
  assertEquals(s.thinkingLevel, DEFAULT_MODEL_LADDER.coder.thinkingLevel);
  assertEquals(s.targetScenario, "3");
  assertEquals(s.actionableScenarios, ["3"]);
});

Deno.test("resolveWorkerModelSelection level 1 -> escalated", () => {
  const s = resolveWorkerModelSelection({
    ladder: DEFAULT_MODEL_LADDER,
    level: 1,
    targetScenario: "7",
  });
  assertEquals(s.model, DEFAULT_MODEL_LADDER.escalated.model);
  assertEquals(s.mode, "escalated");
  assertEquals(s.thinkingLevel, DEFAULT_MODEL_LADDER.escalated.thinkingLevel);
});

Deno.test("resolveWorkerModelSelection undefined level -> coder", () => {
  const s = resolveWorkerModelSelection({
    ladder: DEFAULT_MODEL_LADDER,
    level: undefined,
    targetScenario: "1",
  });
  assertEquals(s.model, DEFAULT_MODEL_LADDER.coder.model);
});

// ---------------------------------------------------------------------------
// isWorkerTerminal
// ---------------------------------------------------------------------------

Deno.test("isWorkerTerminal returns true for done", () => {
  assertEquals(
    isWorkerTerminal({ tag: "done", result: { status: "complete" } }),
    true,
  );
});

Deno.test("isWorkerTerminal returns false for non-terminal", () => {
  assertEquals(
    isWorkerTerminal({
      tag: "resolving_model",
      iterationNum: 0,
      ladder: DEFAULT_MODEL_LADDER,
      level: undefined,
      targetScenarioOverride: "1",
      promptOverride: undefined,
      validationFailurePath: undefined,
      specFile: undefined,
      progressFile: undefined,
    }),
    false,
  );
});

// ---------------------------------------------------------------------------
// initialWorkerState
// ---------------------------------------------------------------------------

Deno.test("initialWorkerState creates resolving_model state", () => {
  const s = initialWorkerState({
    iterationNum: 5,
    ladder: DEFAULT_MODEL_LADDER,
    level: 1,
    targetScenarioOverride: "3",
    promptOverride: undefined,
    validationFailurePath: "/tmp/fail.log",
    specFile: "spec.md",
    progressFile: "progress.md",
  });
  assertEquals(s.tag, "resolving_model");
  assertEquals(s.iterationNum, 5);
  assertEquals(s.ladder, DEFAULT_MODEL_LADDER);
  assertEquals(s.level, 1);
  assertEquals(s.targetScenarioOverride, "3");
  assertEquals(s.validationFailurePath, "/tmp/fail.log");
});

// ---------------------------------------------------------------------------
// transitionResolvingModel
// ---------------------------------------------------------------------------

Deno.test("transitionResolvingModel with targetScenarioOverride uses resolveWorkerModelSelection", async () => {
  const state = initialWorkerState({
    iterationNum: 0,
    ladder: DEFAULT_MODEL_LADDER,
    level: 1,
    targetScenarioOverride: "5",
    promptOverride: undefined,
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  });

  const next = await transitionResolvingModel(state, {}, noopLog);
  assertEquals(next.tag, "model_resolved");
  assertEquals(next.selection.model, DEFAULT_MODEL_LADDER.escalated.model); // escalated
  assertEquals(next.selection.targetScenario, "5");
});

Deno.test("transitionResolvingModel fires onModelSelected plugin hook", async () => {
  const state = initialWorkerState({
    iterationNum: 0,
    ladder: DEFAULT_MODEL_LADDER,
    level: 0,
    targetScenarioOverride: "1",
    promptOverride: undefined,
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  });

  const plugin: Plugin = {
    onModelSelected: ({ selection }) => ({
      ...selection,
      model: "overridden",
    }),
  };

  const next = await transitionResolvingModel(state, plugin, noopLog);
  assertEquals(next.selection.model, "overridden");
});

// ---------------------------------------------------------------------------
// transitionModelResolved
// ---------------------------------------------------------------------------

Deno.test("transitionModelResolved builds prompt with target scenario", async () => {
  const state: ModelResolvedState = {
    tag: "model_resolved",
    iterationNum: 0,
    ladder: DEFAULT_MODEL_LADDER,
    selection: sel({ targetScenario: "3", actionableScenarios: ["3"] }),
    promptOverride: undefined,
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  };

  const next = await transitionModelResolved(state, {}, noopLog);
  assertEquals(next.tag, "prompt_built");
  assertEquals(next.prompt.includes("scenario 3"), true);
});

Deno.test("transitionModelResolved includes validation failure in prompt", async () => {
  const state: ModelResolvedState = {
    tag: "model_resolved",
    iterationNum: 0,
    ladder: DEFAULT_MODEL_LADDER,
    selection: sel(),
    promptOverride: undefined,
    validationFailurePath: "/tmp/fail.log",
    specFile: undefined,
    progressFile: undefined,
  };

  const next = await transitionModelResolved(state, {}, noopLog);
  assertEquals(next.prompt.includes("VALIDATION FAILED"), true);
  assertEquals(next.prompt.includes("/tmp/fail.log"), true);
});

Deno.test("transitionModelResolved fires onPromptBuilt plugin hook", async () => {
  const state: ModelResolvedState = {
    tag: "model_resolved",
    iterationNum: 0,
    ladder: DEFAULT_MODEL_LADDER,
    selection: sel(),
    promptOverride: undefined,
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  };

  const plugin: Plugin = {
    onPromptBuilt: ({ prompt }) => `CUSTOM: ${prompt}`,
  };

  const next = await transitionModelResolved(state, plugin, noopLog);
  assertEquals(next.prompt.startsWith("CUSTOM:"), true);
});

// ---------------------------------------------------------------------------
// transitionPromptBuilt
// ---------------------------------------------------------------------------

Deno.test("transitionPromptBuilt builds session config", async () => {
  const state: PromptBuiltState = {
    tag: "prompt_built",
    iterationNum: 0,
    ladder: DEFAULT_MODEL_LADDER,
    selection: sel(),
    prompt: "test prompt",
  };

  const next = await transitionPromptBuilt(state, {}, noopLog, "/tmp/work");
  assertEquals(next.tag, "config_built");
  assertEquals(next.config.provider, "anthropic");
  assertEquals(next.config.model, DEFAULT_MODEL_LADDER.coder.model);
  assertEquals(next.config.workingDir, "/tmp/work");
});

Deno.test("transitionPromptBuilt fires onSessionConfigBuilt plugin hook", async () => {
  const state: PromptBuiltState = {
    tag: "prompt_built",
    iterationNum: 0,
    ladder: DEFAULT_MODEL_LADDER,
    selection: sel(),
    prompt: "test prompt",
  };

  const plugin: Plugin = {
    onSessionConfigBuilt: ({ config }) => ({
      ...config,
      provider: "openrouter",
    }),
  };

  const next = await transitionPromptBuilt(state, plugin, noopLog, "/tmp");
  assertEquals(next.config.provider, "openrouter");
});

// ---------------------------------------------------------------------------
// transitionConfigBuilt
// ---------------------------------------------------------------------------

Deno.test("transitionConfigBuilt produces running_agent state", () => {
  const state: ConfigBuiltState = {
    tag: "config_built",
    iterationNum: 0,
    ladder: DEFAULT_MODEL_LADDER,
    selection: sel(),
    config: cfg(),
    prompt: "test prompt",
  };

  const next = transitionConfigBuilt(state);
  assertEquals(next.tag, "running_agent");
  assertEquals(next.config, state.config);
});

// ---------------------------------------------------------------------------
// transitionRunningAgent
// ---------------------------------------------------------------------------

Deno.test("transitionRunningAgent with successful agent -> done/continue", async () => {
  const state: RunningAgentState = {
    tag: "running_agent",
    iterationNum: 0,
    ladder: DEFAULT_MODEL_LADDER,
    selection: sel(),
    config: cfg(),
    prompt: "test prompt",
  };

  const deps = {
    execute: () => Promise.resolve({ status: "continue" as const }),
  };

  const next = await transitionRunningAgent(
    state,
    deps,
    {},
    noopLog,
    AbortSignal.timeout(10_000),
  );
  assertEquals(next.tag, "done");
  assertEquals(next.result.status, "continue");
});

Deno.test("transitionRunningAgent forwards workerIndex to execute for stdio prefixing", async () => {
  const state: RunningAgentState = {
    tag: "running_agent",
    iterationNum: 0,
    ladder: DEFAULT_MODEL_LADDER,
    selection: sel({ targetScenario: "33", actionableScenarios: ["33"] }),
    config: cfg(),
    prompt: "test prompt",
  };

  let capturedWorkerIndex: number | undefined = -1;
  const deps = {
    execute: (opts: { workerIndex?: number }) => {
      capturedWorkerIndex = opts.workerIndex;
      return Promise.resolve({ status: "continue" as const });
    },
  };

  await transitionRunningAgent(
    state,
    deps,
    {},
    noopLog,
    AbortSignal.timeout(10_000),
    2,
  );
  assertEquals(capturedWorkerIndex, 2);
});

Deno.test("transitionRunningAgent fires onIterationEnd plugin hook", async () => {
  const state: RunningAgentState = {
    tag: "running_agent",
    iterationNum: 0,
    ladder: DEFAULT_MODEL_LADDER,
    selection: sel(),
    config: cfg(),
    prompt: "test prompt",
  };

  let hookFired = false;
  const plugin: Plugin = {
    onIterationEnd: () => {
      hookFired = true;
    },
  };

  await transitionRunningAgent(
    state,
    { execute: () => Promise.resolve({ status: "complete" as const }) },
    plugin,
    noopLog,
    AbortSignal.timeout(10_000),
  );
  assertEquals(hookFired, true);
});

// ---------------------------------------------------------------------------
// workerTransition dispatcher
// ---------------------------------------------------------------------------

Deno.test("workerTransition returns done state unchanged", async () => {
  const done: WorkerState = { tag: "done", result: { status: "complete" } };
  const next = await workerTransition(done, {
    plugin: {},
    log: noopLog,
    signal: AbortSignal.timeout(10_000),
    cwd: undefined,
    agentDeps: {
      execute: () => Promise.resolve({ status: "continue" as const }),
    },
  });
  assertEquals(next, done);
});

// ---------------------------------------------------------------------------
// Full pipeline test
// ---------------------------------------------------------------------------

Deno.test("worker pipeline: resolving_model -> ... -> done", async () => {
  let current: WorkerState = initialWorkerState({
    iterationNum: 0,
    ladder: DEFAULT_MODEL_LADDER,
    level: 0,
    targetScenarioOverride: "1",
    promptOverride: undefined,
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  });

  const tags: string[] = [];
  const opts = {
    plugin: {},
    log: noopLog,
    signal: AbortSignal.timeout(10_000),
    cwd: undefined,
    agentDeps: {
      execute: () => Promise.resolve({ status: "complete" as const }),
    },
  };

  while (!isWorkerTerminal(current)) {
    current = await workerTransition(current, opts);
    tags.push(current.tag);
  }

  assertEquals(tags, [
    "model_resolved",
    "prompt_built",
    "config_built",
    "running_agent",
    "done",
  ]);
  assertEquals(current.tag === "done" && current.result.status, "complete");
});
