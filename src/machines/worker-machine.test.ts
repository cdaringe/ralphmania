import { assertEquals, assertExists } from "jsr:@std/assert@^1";
import type { Plugin } from "../plugin.ts";
import type { IterationResult } from "../types.ts";
import type { AgentInputBus } from "../gui/input-bus.ts";
import { createAgentInputBus } from "../gui/input-bus.ts";
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
} from "./worker-machine.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop: Plugin = {};
const log = (): void => {};

// ---------------------------------------------------------------------------
// resolveWorkerModelSelection
// ---------------------------------------------------------------------------

Deno.test("resolveWorkerModelSelection: claude non-escalated uses sonnet/high", () => {
  const sel = resolveWorkerModelSelection({
    agent: "claude",
    level: 0,
    targetScenario: "ARCH.1",
  });
  assertEquals(sel.model, "sonnet");
  assertEquals(sel.effort, "high");
  assertEquals(sel.targetScenario, "ARCH.1");
  assertEquals(sel.actionableScenarios, ["ARCH.1"]);
});

Deno.test("resolveWorkerModelSelection: claude escalated (level ≥ 1) uses opus/high", () => {
  const sel = resolveWorkerModelSelection({
    agent: "claude",
    level: 1,
    targetScenario: "ARCH.2",
  });
  assertEquals(sel.model, "opus");
  assertEquals(sel.effort, "high");
});

Deno.test("resolveWorkerModelSelection: claude undefined level uses sonnet", () => {
  const sel = resolveWorkerModelSelection({
    agent: "claude",
    level: undefined,
    targetScenario: "1",
  });
  assertEquals(sel.model, "sonnet");
});

Deno.test("resolveWorkerModelSelection: codex non-escalated uses general model", () => {
  const sel = resolveWorkerModelSelection({
    agent: "codex",
    level: 0,
    targetScenario: "5",
  });
  assertEquals(sel.mode, "general");
  assertEquals(sel.effort, undefined);
});

Deno.test("resolveWorkerModelSelection: codex escalated uses strong model", () => {
  const sel = resolveWorkerModelSelection({
    agent: "codex",
    level: 1,
    targetScenario: "5",
  });
  assertEquals(sel.mode, "strong");
});

// ---------------------------------------------------------------------------
// initialWorkerState
// ---------------------------------------------------------------------------

Deno.test("initialWorkerState: creates resolving_model state", () => {
  const s = initialWorkerState({
    iterationNum: 3,
    agent: "claude",
    level: 0,
    targetScenarioOverride: "ARCH.3",
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  });
  assertEquals(s.tag, "resolving_model");
  assertEquals(s.iterationNum, 3);
  assertEquals(s.agent, "claude");
  assertEquals(s.targetScenarioOverride, "ARCH.3");
});

// ---------------------------------------------------------------------------
// isWorkerTerminal
// ---------------------------------------------------------------------------

Deno.test("isWorkerTerminal: done is terminal", () => {
  assertEquals(
    isWorkerTerminal({ tag: "done", result: { status: "complete" } }),
    true,
  );
});

Deno.test("isWorkerTerminal: resolving_model is not terminal", () => {
  assertEquals(
    isWorkerTerminal(
      initialWorkerState({
        iterationNum: 0,
        agent: "claude",
        level: undefined,
        targetScenarioOverride: undefined,
        validationFailurePath: undefined,
        specFile: undefined,
        progressFile: undefined,
      }),
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// transitionResolvingModel
// ---------------------------------------------------------------------------

Deno.test("transitionResolvingModel: advances to model_resolved with targetScenario", async () => {
  const state = initialWorkerState({
    iterationNum: 1,
    agent: "claude",
    level: 0,
    targetScenarioOverride: "ARCH.3",
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  });
  const next = await transitionResolvingModel(state, noop, log);
  assertEquals(next.tag, "model_resolved");
  assertEquals(next.selection.targetScenario, "ARCH.3");
  assertEquals(next.selection.model, "sonnet");
});

Deno.test("transitionResolvingModel: plugin.onModelSelected can override selection", async () => {
  const state = initialWorkerState({
    iterationNum: 1,
    agent: "claude",
    level: 0,
    targetScenarioOverride: "ARCH.3",
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  });
  const plugin: Plugin = {
    onModelSelected: ({ selection }) => ({
      ...selection,
      model: "my-custom-model",
    }),
  };
  const next = await transitionResolvingModel(state, plugin, log);
  assertEquals(next.selection.model, "my-custom-model");
});

// ---------------------------------------------------------------------------
// transitionModelResolved
// ---------------------------------------------------------------------------

Deno.test("transitionModelResolved: advances to prompt_built", async () => {
  const state = {
    tag: "model_resolved" as const,
    iterationNum: 1,
    agent: "claude" as const,
    selection: {
      model: "sonnet",
      mode: "general" as const,
      targetScenario: "ARCH.3",
      effort: "high" as const,
      actionableScenarios: ["ARCH.3"],
    },
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  };
  const next = await transitionModelResolved(state, noop, log);
  assertEquals(next.tag, "prompt_built");
  assertExists(next.prompt);
  assertEquals(typeof next.prompt, "string");
  assertEquals(next.prompt.includes("ARCH.3"), true);
});

Deno.test("transitionModelResolved: plugin.onPromptBuilt can override prompt", async () => {
  const state = {
    tag: "model_resolved" as const,
    iterationNum: 1,
    agent: "claude" as const,
    selection: {
      model: "sonnet",
      mode: "general" as const,
      targetScenario: "ARCH.3",
      effort: "high" as const,
      actionableScenarios: ["ARCH.3"],
    },
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  };
  const plugin: Plugin = {
    onPromptBuilt: () => "custom prompt",
  };
  const next = await transitionModelResolved(state, plugin, log);
  assertEquals(next.prompt, "custom prompt");
});

Deno.test("transitionModelResolved: includes validation failure path in prompt", async () => {
  const state = {
    tag: "model_resolved" as const,
    iterationNum: 2,
    agent: "claude" as const,
    selection: {
      model: "sonnet",
      mode: "general" as const,
      targetScenario: "1",
      effort: "high" as const,
      actionableScenarios: ["1"],
    },
    validationFailurePath: ".ralph/validation/iteration-1.log",
    specFile: undefined,
    progressFile: undefined,
  };
  const next = await transitionModelResolved(state, noop, log);
  assertEquals(
    next.prompt.includes(".ralph/validation/iteration-1.log"),
    true,
  );
});

// ---------------------------------------------------------------------------
// transitionPromptBuilt
// ---------------------------------------------------------------------------

Deno.test("transitionPromptBuilt: advances to command_built", async () => {
  const state = {
    tag: "prompt_built" as const,
    iterationNum: 1,
    agent: "claude" as const,
    selection: {
      model: "sonnet",
      mode: "general" as const,
      targetScenario: "1",
      effort: "high" as const,
      actionableScenarios: ["1"],
    },
    prompt: "do the thing",
  };
  const next = await transitionPromptBuilt(state, noop, log);
  assertEquals(next.tag, "command_built");
  assertEquals(next.spec.command, "claude");
  assertEquals(next.spec.args.includes("sonnet"), true);
});

Deno.test("transitionPromptBuilt: plugin.onCommandBuilt can override spec", async () => {
  const state = {
    tag: "prompt_built" as const,
    iterationNum: 1,
    agent: "claude" as const,
    selection: {
      model: "sonnet",
      mode: "general" as const,
      targetScenario: "1",
      effort: "high" as const,
      actionableScenarios: ["1"],
    },
    prompt: "do the thing",
  };
  const plugin: Plugin = {
    onCommandBuilt: ({ spec }) => ({ ...spec, command: "custom-agent" }),
  };
  const next = await transitionPromptBuilt(state, plugin, log);
  assertEquals(next.spec.command, "custom-agent");
});

// ---------------------------------------------------------------------------
// transitionCommandBuilt
// ---------------------------------------------------------------------------

Deno.test("transitionCommandBuilt: advances to running_agent", () => {
  const state = {
    tag: "command_built" as const,
    iterationNum: 1,
    agent: "claude" as const,
    selection: {
      model: "sonnet",
      mode: "general" as const,
      targetScenario: "1",
      effort: "high" as const,
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

Deno.test("transitionRunningAgent: returns done with result on success", async () => {
  const state = {
    tag: "running_agent" as const,
    iterationNum: 1,
    agent: "claude" as const,
    selection: {
      model: "sonnet",
      mode: "general" as const,
      targetScenario: "1",
      effort: "high" as const,
      actionableScenarios: ["1"],
    },
    spec: { command: "claude", args: [] },
  };
  const result: IterationResult = { status: "complete" };
  const deps = { execute: () => Promise.resolve(result) };
  const next = await transitionRunningAgent(
    state,
    deps,
    noop,
    log,
    new AbortController().signal,
    undefined,
  );
  assertEquals(next.tag, "done");
  assertEquals(next.result, result);
});

Deno.test("transitionRunningAgent: calls plugin.onIterationEnd", async () => {
  const state = {
    tag: "running_agent" as const,
    iterationNum: 1,
    agent: "claude" as const,
    selection: {
      model: "sonnet",
      mode: "general" as const,
      targetScenario: "1",
      effort: "high" as const,
      actionableScenarios: ["1"],
    },
    spec: { command: "claude", args: [] },
  };
  let hookFired = false;
  const plugin: Plugin = {
    onIterationEnd: () => {
      hookFired = true;
      return Promise.resolve();
    },
  };
  const deps = {
    execute: (): Promise<IterationResult> =>
      Promise.resolve({ status: "continue" }),
  };
  await transitionRunningAgent(
    state,
    deps,
    plugin,
    log,
    new AbortController().signal,
    undefined,
  );
  assertEquals(hookFired, true);
});

Deno.test("transitionRunningAgent: passes agentInputBus to deps.execute", async () => {
  const state = {
    tag: "running_agent" as const,
    iterationNum: 1,
    agent: "claude" as const,
    selection: {
      model: "sonnet",
      mode: "general" as const,
      targetScenario: "GUI.d",
      effort: "high" as const,
      actionableScenarios: ["GUI.d"],
    },
    spec: { command: "claude", args: [] },
  };
  const mockBus: AgentInputBus = createAgentInputBus();
  let capturedBus: AgentInputBus | undefined;
  const deps = {
    execute: (
      opts: { agentInputBus?: AgentInputBus },
    ): Promise<IterationResult> => {
      capturedBus = opts.agentInputBus;
      return Promise.resolve({ status: "complete" });
    },
  };
  await transitionRunningAgent(
    state,
    deps,
    noop,
    log,
    new AbortController().signal,
    undefined,
    0,
    mockBus,
  );
  assertEquals(capturedBus, mockBus);
});

// ---------------------------------------------------------------------------
// workerTransition — full dispatcher
// ---------------------------------------------------------------------------

Deno.test("workerTransition: resolving_model → model_resolved", async () => {
  const state = initialWorkerState({
    iterationNum: 0,
    agent: "claude",
    level: 0,
    targetScenarioOverride: "1",
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  });
  const agentDeps = {
    execute: (): Promise<IterationResult> =>
      Promise.resolve({ status: "complete" }),
  };
  const next = await workerTransition(state, {
    plugin: noop,
    log,
    signal: new AbortController().signal,
    cwd: undefined,
    agentDeps,
  });
  assertEquals(next.tag, "model_resolved");
});

Deno.test("workerTransition: done state is idempotent", async () => {
  const doneState = {
    tag: "done" as const,
    result: { status: "complete" as const },
  };
  const agentDeps = {
    execute: (): Promise<IterationResult> =>
      Promise.resolve({ status: "complete" }),
  };
  const next = await workerTransition(doneState, {
    plugin: noop,
    log,
    signal: new AbortController().signal,
    cwd: undefined,
    agentDeps,
  });
  assertEquals(next.tag, "done");
});

Deno.test("workerTransition: full pipeline reaches done", async () => {
  const agentDeps = {
    execute: (): Promise<IterationResult> =>
      Promise.resolve({ status: "complete" }),
  };
  const opts = {
    plugin: noop,
    log,
    signal: new AbortController().signal,
    cwd: undefined,
    agentDeps,
  };

  let state: import("./worker-machine.ts").WorkerState = initialWorkerState({
    iterationNum: 0,
    agent: "claude",
    level: 0,
    targetScenarioOverride: "ARCH.3",
    validationFailurePath: undefined,
    specFile: undefined,
    progressFile: undefined,
  });

  while (!isWorkerTerminal(state)) {
    state = await workerTransition(state, opts);
  }

  assertEquals(state.tag, "done");
  if (state.tag === "done") {
    assertEquals(state.result.status, "complete");
  }
});
