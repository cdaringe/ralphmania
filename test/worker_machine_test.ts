import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  initialWorkerState,
  isWorkerTerminal,
  resolveWorkerModelSelection,
  transitionCommandBuilt,
  transitionModelResolved,
  transitionPromptBuilt,
  transitionResolvingModel,
  transitionRunningAgent,
  workerTransition,
} from "../src/worker-machine.ts";
import type {
  CommandBuiltState,
  ModelResolvedState,
  PromptBuiltState,
  RunningAgentState,
  WorkerState,
} from "../src/worker-machine.ts";
import type { Plugin } from "../src/plugin.ts";
import { noopLog } from "./fixtures.ts";

// ---------------------------------------------------------------------------
// resolveWorkerModelSelection
// ---------------------------------------------------------------------------

Deno.test("resolveWorkerModelSelection claude level 0 → CLAUDE_CODER", () => {
  const s = resolveWorkerModelSelection({
    agent: "claude",
    level: 0,
    targetScenario: "3",
  });
  assertEquals(s.model, "sonnet");
  assertEquals(s.mode, "general");
  assertEquals(s.effort, "high");
  assertEquals(s.targetScenario, "3");
  assertEquals(s.actionableScenarios, ["3"]);
});

Deno.test("resolveWorkerModelSelection claude level 1 → CLAUDE_ESCALATED", () => {
  const s = resolveWorkerModelSelection({
    agent: "claude",
    level: 1,
    targetScenario: "7",
  });
  assertEquals(s.model, "opus");
  assertEquals(s.mode, "strong");
  assertEquals(s.effort, "high");
});

Deno.test("resolveWorkerModelSelection claude undefined level → CLAUDE_CODER", () => {
  const s = resolveWorkerModelSelection({
    agent: "claude",
    level: undefined,
    targetScenario: "1",
  });
  assertEquals(s.model, "sonnet");
});

Deno.test("resolveWorkerModelSelection codex level 0 → general", () => {
  const s = resolveWorkerModelSelection({
    agent: "codex",
    level: 0,
    targetScenario: "1",
  });
  assertEquals(s.model, "gpt-5.1-codex-max");
  assertEquals(s.mode, "general");
  assertEquals(s.effort, undefined);
});

Deno.test("resolveWorkerModelSelection codex level 1 → strong", () => {
  const s = resolveWorkerModelSelection({
    agent: "codex",
    level: 1,
    targetScenario: "1",
  });
  assertEquals(s.model, "gpt-5.3-codex");
  assertEquals(s.mode, "strong");
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
      agent: "claude",
      level: undefined,
      targetScenarioOverride: "1",
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
    agent: "codex",
    level: 1,
    targetScenarioOverride: "3",
    validationFailurePath: "/tmp/fail.log",
    specFile: "spec.md",
    progressFile: "progress.md",
  });
  assertEquals(s.tag, "resolving_model");
  assertEquals(s.iterationNum, 5);
  assertEquals(s.agent, "codex");
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
    agent: "claude",
    level: 1,
    targetScenarioOverride: "5",
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  });

  const next = await transitionResolvingModel(state, {}, noopLog);
  assertEquals(next.tag, "model_resolved");
  assertEquals(next.selection.model, "opus"); // escalated
  assertEquals(next.selection.targetScenario, "5");
});

Deno.test("transitionResolvingModel fires onModelSelected plugin hook", async () => {
  const state = initialWorkerState({
    iterationNum: 0,
    agent: "claude",
    level: 0,
    targetScenarioOverride: "1",
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
    agent: "claude",
    selection: {
      model: "sonnet",
      mode: "general",
      targetScenario: "3",
      effort: "high",
      actionableScenarios: ["3"],
    },
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
    agent: "claude",
    selection: {
      model: "sonnet",
      mode: "general",
      targetScenario: "1",
      effort: "high",
      actionableScenarios: ["1"],
    },
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
    agent: "claude",
    selection: {
      model: "sonnet",
      mode: "general",
      targetScenario: "1",
      effort: "high",
      actionableScenarios: ["1"],
    },
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

Deno.test("transitionPromptBuilt builds command spec for claude", async () => {
  const state: PromptBuiltState = {
    tag: "prompt_built",
    iterationNum: 0,
    agent: "claude",
    selection: {
      model: "sonnet",
      mode: "general",
      targetScenario: "1",
      effort: "high",
      actionableScenarios: ["1"],
    },
    prompt: "test prompt",
  };

  const next = await transitionPromptBuilt(state, {}, noopLog);
  assertEquals(next.tag, "command_built");
  assertEquals(next.spec.command, "claude");
  assertEquals(next.spec.args.includes("sonnet"), true);
});

Deno.test("transitionPromptBuilt builds command spec for codex", async () => {
  const state: PromptBuiltState = {
    tag: "prompt_built",
    iterationNum: 0,
    agent: "codex",
    selection: {
      model: "gpt-5.1-codex",
      mode: "fast",
      targetScenario: "1",
      effort: undefined,
      actionableScenarios: ["1"],
    },
    prompt: "test prompt",
  };

  const next = await transitionPromptBuilt(state, {}, noopLog);
  assertEquals(next.spec.command, "codex");
});

Deno.test("transitionPromptBuilt fires onCommandBuilt plugin hook", async () => {
  const state: PromptBuiltState = {
    tag: "prompt_built",
    iterationNum: 0,
    agent: "claude",
    selection: {
      model: "sonnet",
      mode: "general",
      targetScenario: "1",
      effort: "high",
      actionableScenarios: ["1"],
    },
    prompt: "test prompt",
  };

  const plugin: Plugin = {
    onCommandBuilt: ({ spec }) => ({
      ...spec,
      command: "custom-agent",
    }),
  };

  const next = await transitionPromptBuilt(state, plugin, noopLog);
  assertEquals(next.spec.command, "custom-agent");
});

// ---------------------------------------------------------------------------
// transitionCommandBuilt
// ---------------------------------------------------------------------------

Deno.test("transitionCommandBuilt produces running_agent state", () => {
  const state: CommandBuiltState = {
    tag: "command_built",
    iterationNum: 0,
    agent: "claude",
    selection: {
      model: "sonnet",
      mode: "general",
      targetScenario: "1",
      effort: "high",
      actionableScenarios: ["1"],
    },
    spec: { command: "claude", args: ["--model", "sonnet", "prompt"] },
  };

  const next = transitionCommandBuilt(state);
  assertEquals(next.tag, "running_agent");
  assertEquals(next.spec, state.spec);
});

// ---------------------------------------------------------------------------
// transitionRunningAgent
// ---------------------------------------------------------------------------

Deno.test("transitionRunningAgent with successful agent → done/continue", async () => {
  const state: RunningAgentState = {
    tag: "running_agent",
    iterationNum: 0,
    agent: "claude",
    selection: {
      model: "sonnet",
      mode: "general",
      targetScenario: "1",
      effort: "high",
      actionableScenarios: ["1"],
    },
    spec: { command: "echo", args: ["hello"] },
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
    undefined,
  );
  assertEquals(next.tag, "done");
  assertEquals(next.result.status, "continue");
});

Deno.test("transitionRunningAgent forwards workerIndex to execute for stdio prefixing", async () => {
  const state: RunningAgentState = {
    tag: "running_agent",
    iterationNum: 0,
    agent: "claude",
    selection: {
      model: "sonnet",
      mode: "general",
      targetScenario: "33",
      effort: "high",
      actionableScenarios: ["33"],
    },
    spec: { command: "echo", args: ["hello"] },
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
    undefined,
    2,
  );
  assertEquals(capturedWorkerIndex, 2);
});

Deno.test("transitionRunningAgent fires onIterationEnd plugin hook", async () => {
  const state: RunningAgentState = {
    tag: "running_agent",
    iterationNum: 0,
    agent: "claude",
    selection: {
      model: "sonnet",
      mode: "general",
      targetScenario: "1",
      effort: "high",
      actionableScenarios: ["1"],
    },
    spec: { command: "echo", args: ["hello"] },
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
    undefined,
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

Deno.test("worker pipeline: resolving_model → ... → done", async () => {
  let current: WorkerState = initialWorkerState({
    iterationNum: 0,
    agent: "claude",
    level: 0,
    targetScenarioOverride: "1",
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
    "command_built",
    "running_agent",
    "done",
  ]);
  assertEquals(current.tag === "done" && current.result.status, "complete");
});
