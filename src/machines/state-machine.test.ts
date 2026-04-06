import { assertEquals } from "jsr:@std/assert@^1";
import { err, ok } from "neverthrow";
import type { MachineContext } from "./state-machine.ts";
import type { MachineDeps } from "../ports/types.ts";
import {
  isTerminal,
  transition,
  transitionCheckingDoneness,
  transitionFindingActionable,
  transitionInit,
  transitionReadingProgress,
  transitionRectifying,
  transitionRunningWorkers,
  transitionValidating,
} from "./state-machine.ts";
import { noopPlugin } from "../plugin.ts";
import { DEFAULT_MODEL_LADDER } from "../constants.ts";

// ---------------------------------------------------------------------------
// Progress content fixtures
// ---------------------------------------------------------------------------

/** All scenarios verified — machine should terminate. */
const allVerifiedProgress = `
# Progress

| # | Status | Summary | Rework Notes |
| --- | --- | --- | --- |
| ARCH.1 | VERIFIED | done | |
| ARCH.2 | VERIFIED | done | |
`.trim();

/** One scenario WIP — machine should continue. */
const wipProgress = `
# Progress

| # | Status | Summary | Rework Notes |
| --- | --- | --- | --- |
| ARCH.1 | VERIFIED | done | |
| ARCH.2 | WIP | in progress | |
`.trim();

/** One scenario NEEDS_REWORK. */
const reworkProgress = `
# Progress

| # | Status | Summary | Rework Notes |
| --- | --- | --- | --- |
| ARCH.1 | NEEDS_REWORK | broken | fix it |
| ARCH.2 | VERIFIED | done | |
`.trim();

// ---------------------------------------------------------------------------
// Default MachineDeps factory — override only what you need per test
// ---------------------------------------------------------------------------

const noop = (): void => {};

const specContent =
  "| ARCH.1 | Architecture scenario 1 |\n| ARCH.2 | Architecture scenario 2 |";

const makeDeps = (overrides: Partial<MachineDeps> = {}): MachineDeps => ({
  readProgress: () => Promise.resolve(wipProgress),
  readSpec: () => Promise.resolve(specContent),
  createWorktree: ({ workerIndex }) =>
    Promise.resolve(
      ok({
        path: `/tmp/wt-${workerIndex}`,
        branch: `worker-${workerIndex}`,
        scenario: "1",
      }),
    ),
  runIteration: () => Promise.resolve({ status: "continue" as const }),
  runValidation: () => Promise.resolve({ status: "passed" as const }),
  hasNewCommits: () => Promise.resolve(false),
  mergeWorktree: () => Promise.resolve("merged" as const),
  cleanupWorktree: () => Promise.resolve(ok(undefined)),
  resetWorkingTree: () => Promise.resolve(ok(undefined)),
  reconcileMerge: () => Promise.resolve(undefined),
  readCheckpoint: () => Promise.resolve(undefined),
  writeCheckpoint: () => Promise.resolve(undefined),
  clearCheckpoint: () => Promise.resolve(undefined),
  readEscalationState: () => Promise.resolve({}),
  writeEscalationState: () => Promise.resolve(undefined),
  selectScenarioBatch: ({ scenarioIds }) => Promise.resolve([...scenarioIds]),
  ...overrides,
});

const makeCtx = (overrides: Partial<MachineContext> = {}): MachineContext => ({
  ladder: DEFAULT_MODEL_LADDER,
  iterations: 5,
  parallelism: 1,
  expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  signal: new AbortController().signal,
  log: noop as MachineContext["log"],
  plugin: noopPlugin,
  level: undefined,
  specFile: undefined,
  progressFile: undefined,
  deps: makeDeps(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// isTerminal
// ---------------------------------------------------------------------------

Deno.test("isTerminal: done is terminal", () => {
  assertEquals(isTerminal({ tag: "done", iterationsUsed: 3 }), true);
});

Deno.test("isTerminal: aborted is terminal", () => {
  assertEquals(isTerminal({ tag: "aborted" }), true);
});

Deno.test("isTerminal: init is not terminal", () => {
  assertEquals(isTerminal({ tag: "init" }), false);
});

Deno.test("isTerminal: reading_progress is not terminal", () => {
  assertEquals(
    isTerminal({
      tag: "reading_progress",
      iterationsUsed: 0,
      validationFailurePath: undefined,
    }),
    false,
  );
});

// ---------------------------------------------------------------------------
// transitionInit
// ---------------------------------------------------------------------------

Deno.test("transitionInit: fresh start → reading_progress at 0", async () => {
  const ctx = makeCtx({
    deps: makeDeps({ readCheckpoint: () => Promise.resolve(undefined) }),
  });
  const next = await transitionInit(ctx);
  assertEquals(next.tag, "reading_progress");
  if (next.tag === "reading_progress") {
    assertEquals(next.iterationsUsed, 0);
    assertEquals(next.validationFailurePath, undefined);
  }
});

Deno.test("transitionInit: checkpoint at agent step → reading_progress", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      readCheckpoint: () =>
        Promise.resolve({
          iterationsUsed: 2,
          step: "agent" as const,
          validationFailurePath: undefined,
        }),
    }),
  });
  const next = await transitionInit(ctx);
  assertEquals(next.tag, "reading_progress");
  if (next.tag === "reading_progress") {
    assertEquals(next.iterationsUsed, 2);
  }
});

Deno.test("transitionInit: checkpoint at validate step → validating", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      readCheckpoint: () =>
        Promise.resolve({
          iterationsUsed: 1,
          step: "validate" as const,
          validationFailurePath: ".ralph/validation/iteration-1.log",
        }),
    }),
  });
  const next = await transitionInit(ctx);
  assertEquals(next.tag, "validating");
  if (next.tag === "validating") {
    assertEquals(next.iterationsUsed, 1);
    assertEquals(
      next.validationFailurePath,
      ".ralph/validation/iteration-1.log",
    );
  }
});

// ---------------------------------------------------------------------------
// transitionReadingProgress
// ---------------------------------------------------------------------------

Deno.test("transitionReadingProgress: aborted signal → aborted state", async () => {
  const controller = new AbortController();
  controller.abort();
  const ctx = makeCtx({ signal: controller.signal });
  const next = await transitionReadingProgress(
    {
      tag: "reading_progress",
      iterationsUsed: 0,
      validationFailurePath: undefined,
    },
    ctx,
  );
  assertEquals(next.tag, "aborted");
});

Deno.test("transitionReadingProgress: iterations exhausted → done", async () => {
  const ctx = makeCtx({ iterations: 2 });
  const next = await transitionReadingProgress(
    {
      tag: "reading_progress",
      iterationsUsed: 2,
      validationFailurePath: undefined,
    },
    ctx,
  );
  assertEquals(next.tag, "done");
  if (next.tag === "done") {
    assertEquals(next.iterationsUsed, 2);
  }
});

Deno.test("transitionReadingProgress: all verified → done", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      readProgress: () => Promise.resolve(allVerifiedProgress),
    }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  const next = await transitionReadingProgress(
    {
      tag: "reading_progress",
      iterationsUsed: 1,
      validationFailurePath: undefined,
    },
    ctx,
  );
  assertEquals(next.tag, "done");
});

Deno.test("transitionReadingProgress: not done → finding_actionable", async () => {
  const ctx = makeCtx({
    deps: makeDeps({ readProgress: () => Promise.resolve(wipProgress) }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  const next = await transitionReadingProgress(
    {
      tag: "reading_progress",
      iterationsUsed: 0,
      validationFailurePath: undefined,
    },
    ctx,
  );
  assertEquals(next.tag, "finding_actionable");
});

Deno.test("transitionReadingProgress: all verified with active failure → finding_actionable", async () => {
  // If validation failure path is present, don't short-circuit to done
  const ctx = makeCtx({
    deps: makeDeps({
      readProgress: () => Promise.resolve(allVerifiedProgress),
    }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  const next = await transitionReadingProgress(
    {
      tag: "reading_progress",
      iterationsUsed: 0,
      validationFailurePath: ".ralph/validation/iteration-0.log",
    },
    ctx,
  );
  assertEquals(next.tag, "finding_actionable");
});

// ---------------------------------------------------------------------------
// transitionFindingActionable
// ---------------------------------------------------------------------------

Deno.test("transitionFindingActionable: WIP scenario → running_workers", async () => {
  const ctx = makeCtx({ expectedScenarioIds: ["ARCH.1", "ARCH.2"] });
  const next = await transitionFindingActionable(
    {
      tag: "finding_actionable",
      iterationsUsed: 0,
      validationFailurePath: undefined,
      progressContent: wipProgress,
    },
    ctx,
  );
  assertEquals(next.tag, "running_workers");
  if (next.tag === "running_workers") {
    assertEquals(next.uniqueActionable.includes("ARCH.2"), true);
  }
});

Deno.test("transitionFindingActionable: all done → done state", async () => {
  const ctx = makeCtx({ expectedScenarioIds: ["ARCH.1", "ARCH.2"] });
  const next = await transitionFindingActionable(
    {
      tag: "finding_actionable",
      iterationsUsed: 0,
      validationFailurePath: undefined,
      progressContent: allVerifiedProgress,
    },
    ctx,
  );
  assertEquals(next.tag, "done");
});

Deno.test("transitionFindingActionable: NEEDS_REWORK sorted first", async () => {
  const ctx = makeCtx({ expectedScenarioIds: ["ARCH.1", "ARCH.2"] });
  const next = await transitionFindingActionable(
    {
      tag: "finding_actionable",
      iterationsUsed: 0,
      validationFailurePath: undefined,
      progressContent: reworkProgress,
    },
    ctx,
  );
  assertEquals(next.tag, "running_workers");
  if (next.tag === "running_workers") {
    assertEquals(next.uniqueActionable[0], "ARCH.1"); // NEEDS_REWORK first
  }
});

Deno.test("transitionFindingActionable: all done with validation failure → forces scenario back", async () => {
  const ctx = makeCtx({ expectedScenarioIds: ["ARCH.1", "ARCH.2"] });
  const next = await transitionFindingActionable(
    {
      tag: "finding_actionable",
      iterationsUsed: 0,
      validationFailurePath: ".ralph/validation/iteration-0.log",
      progressContent: allVerifiedProgress,
    },
    ctx,
  );
  // Forces at least one scenario back into actionable set
  assertEquals(next.tag, "running_workers");
  if (next.tag === "running_workers") {
    assertEquals(next.uniqueActionable.length > 0, true);
  }
});

// ---------------------------------------------------------------------------
// transitionRunningWorkers
// ---------------------------------------------------------------------------

Deno.test("transitionRunningWorkers: no worktrees created → reading_progress (skips validate)", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      createWorktree: () => Promise.resolve(err("worktree creation failed")),
      readProgress: () => Promise.resolve(wipProgress),
    }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  const next = await transitionRunningWorkers(
    {
      tag: "running_workers",
      iterationsUsed: 0,
      validationFailurePath: undefined,
      uniqueActionable: ["ARCH.2"],
      escalation: {},
    },
    ctx,
  );
  assertEquals(next.tag, "reading_progress");
  if (next.tag === "reading_progress") {
    assertEquals(next.iterationsUsed, 1);
  }
});

Deno.test("transitionRunningWorkers: workers succeed → validating", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      readProgress: () => Promise.resolve(wipProgress),
    }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  const next = await transitionRunningWorkers(
    {
      tag: "running_workers",
      iterationsUsed: 0,
      validationFailurePath: undefined,
      uniqueActionable: ["ARCH.2"],
      escalation: {},
    },
    ctx,
  );
  assertEquals(next.tag, "validating");
});

Deno.test("transitionRunningWorkers: merge conflict triggers reconcile", async () => {
  let reconciled = false;
  const ctx = makeCtx({
    deps: makeDeps({
      hasNewCommits: () => Promise.resolve(true),
      mergeWorktree: () => Promise.resolve("conflict" as const),
      reconcileMerge: () => {
        reconciled = true;
        return Promise.resolve(undefined);
      },
      readProgress: () => Promise.resolve(wipProgress),
    }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  await transitionRunningWorkers(
    {
      tag: "running_workers",
      iterationsUsed: 0,
      validationFailurePath: undefined,
      uniqueActionable: ["ARCH.2"],
      escalation: {},
    },
    ctx,
  );
  assertEquals(reconciled, true);
});

// ---------------------------------------------------------------------------
// transitionValidating
// ---------------------------------------------------------------------------

Deno.test("transitionValidating: validation passes → checking_doneness with no failure path", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      runValidation: () => Promise.resolve({ status: "passed" as const }),
    }),
  });
  const next = await transitionValidating(
    { tag: "validating", iterationsUsed: 1, validationFailurePath: undefined },
    ctx,
  );
  assertEquals(next.tag, "checking_doneness");
  if (next.tag === "checking_doneness") {
    assertEquals(next.validationFailurePath, undefined);
    assertEquals(next.iterationsUsed, 2); // incremented
  }
});

Deno.test("transitionValidating: validation fails → checking_doneness with failure path", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      runValidation: () =>
        Promise.resolve({
          status: "failed" as const,
          outputPath: ".ralph/validation/iteration-1.log",
        }),
    }),
  });
  const next = await transitionValidating(
    { tag: "validating", iterationsUsed: 1, validationFailurePath: undefined },
    ctx,
  );
  assertEquals(next.tag, "checking_doneness");
  if (next.tag === "checking_doneness") {
    assertEquals(
      next.validationFailurePath,
      ".ralph/validation/iteration-1.log",
    );
  }
});

Deno.test("transitionValidating: plugin.onValidationComplete can override result", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      runValidation: () =>
        Promise.resolve({ status: "failed" as const, outputPath: "x.log" }),
    }),
    plugin: {
      onValidationComplete: () => ({ status: "passed" as const }),
    },
  });
  const next = await transitionValidating(
    { tag: "validating", iterationsUsed: 0, validationFailurePath: undefined },
    ctx,
  );
  if (next.tag === "checking_doneness") {
    assertEquals(next.validationFailurePath, undefined); // overridden to passed
  }
});

// ---------------------------------------------------------------------------
// transitionCheckingDoneness
// ---------------------------------------------------------------------------

Deno.test("transitionCheckingDoneness: all verified → done", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      readProgress: () => Promise.resolve(allVerifiedProgress),
    }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  const next = await transitionCheckingDoneness(
    {
      tag: "checking_doneness",
      iterationsUsed: 1,
      validationFailurePath: undefined,
    },
    ctx,
  );
  assertEquals(next.tag, "done");
});

Deno.test("transitionCheckingDoneness: not all verified → reading_progress", async () => {
  const ctx = makeCtx({
    deps: makeDeps({ readProgress: () => Promise.resolve(wipProgress) }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  const next = await transitionCheckingDoneness(
    {
      tag: "checking_doneness",
      iterationsUsed: 1,
      validationFailurePath: undefined,
    },
    ctx,
  );
  assertEquals(next.tag, "reading_progress");
});

Deno.test("transitionCheckingDoneness: all verified but failure path present → rectifying (budget remaining)", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      readProgress: () => Promise.resolve(allVerifiedProgress),
    }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  const next = await transitionCheckingDoneness(
    {
      tag: "checking_doneness",
      iterationsUsed: 2,
      validationFailurePath: ".ralph/validation/iteration-2.log",
    },
    ctx,
  );
  assertEquals(next.tag, "rectifying");
});

// ---------------------------------------------------------------------------
// transition — top-level dispatcher
// ---------------------------------------------------------------------------

Deno.test("transition: init → reading_progress via dispatcher", async () => {
  const ctx = makeCtx();
  const next = await transition({ tag: "init" }, ctx);
  assertEquals(next.tag, "reading_progress");
});

Deno.test("transition: done is terminal — stays done", async () => {
  const ctx = makeCtx();
  const done = { tag: "done" as const, iterationsUsed: 5 };
  const next = await transition(done, ctx);
  assertEquals(next.tag, "done");
});

Deno.test("transition: aborted is terminal — stays aborted", async () => {
  const ctx = makeCtx();
  const aborted = { tag: "aborted" as const };
  const next = await transition(aborted, ctx);
  assertEquals(next.tag, "aborted");
});

Deno.test("transition: logs state transition at debug level", async () => {
  const messages: string[] = [];
  const ctx = makeCtx({
    log: (opts) => {
      if (opts.tags.includes("transition")) messages.push(opts.message);
    },
    deps: makeDeps(),
  });
  await transition({ tag: "init" }, ctx);
  assertEquals(messages.length > 0, true);
  assertEquals(messages[0]?.includes("→"), true);
});

// ---------------------------------------------------------------------------
// Full loop: init → done (all scenarios verified)
// ---------------------------------------------------------------------------

Deno.test("full orchestrator loop terminates when all scenarios verified", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      readProgress: () => Promise.resolve(allVerifiedProgress),
    }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });

  let state: import("./state-machine.ts").OrchestratorState = { tag: "init" };
  let steps = 0;
  while (!isTerminal(state) && steps < 20) {
    state = await transition(state, ctx);
    steps++;
  }
  assertEquals(isTerminal(state), true);
  assertEquals(state.tag, "done");
});

// ---------------------------------------------------------------------------
// Additional coverage: uncovered paths
// ---------------------------------------------------------------------------

Deno.test("transitionReadingProgress: invalid progress statuses are logged and clears failure path", async () => {
  const invalidProgress = `
# Progress

| # | Status | Summary | Rework Notes |
| --- | --- | --- | --- |
| ARCH.1 | BOGUS | done | |
`.trim();
  const messages: string[] = [];
  const ctx = makeCtx({
    deps: makeDeps({ readProgress: () => Promise.resolve(invalidProgress) }),
    expectedScenarioIds: ["ARCH.1"],
    log: (opts) => {
      messages.push(opts.message);
    },
  });
  const next = await transitionReadingProgress(
    {
      tag: "reading_progress",
      iterationsUsed: 0,
      validationFailurePath: ".ralph/validation/iteration-0.log",
    },
    ctx,
  );
  // Invalid status gets logged, finding_actionable advances
  assertEquals(next.tag, "finding_actionable");
  assertEquals(messages.some((m) => m.includes("BOGUS")), true);
});

Deno.test("transitionFindingActionable: scenario id mismatch is logged", async () => {
  const messages: string[] = [];
  const ctx = makeCtx({
    expectedScenarioIds: ["ARCH.1", "ARCH.2", "ARCH.3"],
    log: (opts) => {
      messages.push(opts.message);
    },
    deps: makeDeps(),
  });
  // wipProgress only has ARCH.1 and ARCH.2, not ARCH.3
  await transitionFindingActionable(
    {
      tag: "finding_actionable",
      iterationsUsed: 0,
      validationFailurePath: undefined,
      progressContent: wipProgress,
    },
    ctx,
  );
  assertEquals(
    messages.some((m) => m.includes("mismatch") || m.includes("ARCH.3")),
    true,
  );
});

Deno.test("transitionFindingActionable: all OBSOLETE with validation failure → cannot recover", async () => {
  const allObsoleteProgress = `
# Progress

| # | Status | Summary | Rework Notes |
| --- | --- | --- | --- |
| ARCH.1 | OBSOLETE | old | |
| ARCH.2 | OBSOLETE | old | |
`.trim();
  const ctx = makeCtx({ expectedScenarioIds: ["ARCH.1", "ARCH.2"] });
  const next = await transitionFindingActionable(
    {
      tag: "finding_actionable",
      iterationsUsed: 0,
      validationFailurePath: ".ralph/validation/iteration-0.log",
      progressContent: allObsoleteProgress,
    },
    ctx,
  );
  assertEquals(next.tag, "done");
});

Deno.test("transitionRunningWorkers: per-worker validation failure triggers re-run", async () => {
  let rerunCount = 0;
  const ctx = makeCtx({
    deps: makeDeps({
      runIteration: () => {
        rerunCount++;
        return Promise.resolve({ status: "continue" as const });
      },
      runValidation: () =>
        rerunCount === 1
          ? Promise.resolve({
            status: "failed" as const,
            outputPath: ".ralph/validation/iteration-0.log",
          })
          : Promise.resolve({ status: "passed" as const }),
      readProgress: () => Promise.resolve(wipProgress),
      hasNewCommits: () => Promise.resolve(true),
    }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  await transitionRunningWorkers(
    {
      tag: "running_workers",
      iterationsUsed: 0,
      validationFailurePath: undefined,
      uniqueActionable: ["ARCH.2"],
      escalation: {},
    },
    ctx,
  );
  // Worker ran once; validation failed; iteration re-ran with failure path = 2 total
  assertEquals(rerunCount, 2);
});

Deno.test("transitionRunningWorkers: skips re-run when worker produced no commits", async () => {
  let rerunCount = 0;
  const ctx = makeCtx({
    deps: makeDeps({
      runIteration: () => {
        rerunCount++;
        return Promise.resolve({ status: "continue" as const });
      },
      runValidation: () =>
        Promise.resolve({
          status: "failed" as const,
          outputPath: ".ralph/validation/iteration-0.log",
        }),
      readProgress: () => Promise.resolve(wipProgress),
      hasNewCommits: () => Promise.resolve(false),
    }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  await transitionRunningWorkers(
    {
      tag: "running_workers",
      iterationsUsed: 0,
      validationFailurePath: undefined,
      uniqueActionable: ["ARCH.2"],
      escalation: {},
    },
    ctx,
  );
  // Worker ran once; validation failed but no commits — re-run skipped
  assertEquals(rerunCount, 1);
});

Deno.test("full orchestrator loop terminates on abort signal", async () => {
  const controller = new AbortController();
  const ctx = makeCtx({
    signal: controller.signal,
    deps: makeDeps({
      readProgress: () => Promise.resolve(wipProgress),
    }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });

  // Abort immediately
  controller.abort();

  let state: import("./state-machine.ts").OrchestratorState = {
    tag: "reading_progress",
    iterationsUsed: 0,
    validationFailurePath: undefined,
  };
  let steps = 0;
  while (!isTerminal(state) && steps < 5) {
    state = await transition(state, ctx);
    steps++;
  }
  assertEquals(state.tag, "aborted");
});

// ---------------------------------------------------------------------------
// selectScenarioBatch integration
// ---------------------------------------------------------------------------

Deno.test("transitionFindingActionable: selectScenarioBatch is called and filters batch", async () => {
  const ctx = makeCtx({
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
    parallelism: 2,
    deps: makeDeps({
      selectScenarioBatch: ({ scenarioIds }) =>
        Promise.resolve([scenarioIds[0] ?? ""]),
    }),
  });
  const next = await transitionFindingActionable(
    {
      tag: "finding_actionable",
      iterationsUsed: 0,
      validationFailurePath: undefined,
      progressContent: wipProgress,
    },
    ctx,
  );
  assertEquals(next.tag, "running_workers");
  if (next.tag === "running_workers") {
    // selectScenarioBatch returned only the first scenario
    assertEquals(next.uniqueActionable.length, 1);
  }
});

Deno.test("transitionFindingActionable: clustering reduces parallel batch to one per cluster", async () => {
  const multiWipProgress = `
# Progress

| # | Status | Summary | Rework Notes |
| --- | --- | --- | --- |
| ARCH.1 | WIP | in progress | |
| ARCH.2 | WIP | in progress | |
| 1 | WIP | in progress | |
`.trim();
  const ctx = makeCtx({
    expectedScenarioIds: ["ARCH.1", "ARCH.2", "1"],
    parallelism: 3,
    deps: makeDeps({
      readProgress: () => Promise.resolve(multiWipProgress),
      // Simulate clustering that returns only 1 scenario (all same cluster)
      selectScenarioBatch: ({ scenarioIds }) =>
        Promise.resolve([scenarioIds[0] ?? ""]),
    }),
  });
  const next = await transitionFindingActionable(
    {
      tag: "finding_actionable",
      iterationsUsed: 0,
      validationFailurePath: undefined,
      progressContent: multiWipProgress,
    },
    ctx,
  );
  assertEquals(next.tag, "running_workers");
  if (next.tag === "running_workers") {
    assertEquals(next.uniqueActionable.length, 1);
  }
});

// ---------------------------------------------------------------------------
// transitionCheckingDoneness → rectifying
// ---------------------------------------------------------------------------

Deno.test("transitionCheckingDoneness: validation failure with budget → rectifying", async () => {
  const ctx = makeCtx({
    iterations: 5,
    deps: makeDeps({ readProgress: () => Promise.resolve(wipProgress) }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  const next = await transitionCheckingDoneness(
    {
      tag: "checking_doneness",
      iterationsUsed: 2,
      validationFailurePath: ".ralph/validation/iteration-1.log",
    },
    ctx,
  );
  assertEquals(next.tag, "rectifying");
  if (next.tag === "rectifying") {
    assertEquals(next.iterationsUsed, 2);
    assertEquals(
      next.validationFailurePath,
      ".ralph/validation/iteration-1.log",
    );
  }
});

Deno.test("transitionCheckingDoneness: validation failure with exhausted budget → reading_progress", async () => {
  const ctx = makeCtx({
    iterations: 2,
    deps: makeDeps({ readProgress: () => Promise.resolve(wipProgress) }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });
  const next = await transitionCheckingDoneness(
    {
      tag: "checking_doneness",
      iterationsUsed: 2,
      validationFailurePath: ".ralph/validation/iteration-1.log",
    },
    ctx,
  );
  assertEquals(next.tag, "reading_progress");
});

// ---------------------------------------------------------------------------
// transitionInit with rectify checkpoint
// ---------------------------------------------------------------------------

Deno.test("transitionInit: checkpoint at rectify step → rectifying", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      readCheckpoint: () =>
        Promise.resolve({
          iterationsUsed: 3,
          step: "rectify" as const,
          validationFailurePath: ".ralph/validation/iteration-2.log",
        }),
    }),
  });
  const next = await transitionInit(ctx);
  assertEquals(next.tag, "rectifying");
  if (next.tag === "rectifying") {
    assertEquals(next.iterationsUsed, 3);
    assertEquals(
      next.validationFailurePath,
      ".ralph/validation/iteration-2.log",
    );
  }
});

Deno.test("transitionInit: checkpoint at rectify without failure path → reading_progress", async () => {
  const ctx = makeCtx({
    deps: makeDeps({
      readCheckpoint: () =>
        Promise.resolve({
          iterationsUsed: 3,
          step: "rectify" as const,
          validationFailurePath: undefined,
        }),
    }),
  });
  const next = await transitionInit(ctx);
  assertEquals(next.tag, "reading_progress");
});

// ---------------------------------------------------------------------------
// transitionRectifying
// ---------------------------------------------------------------------------

Deno.test("transitionRectifying: default (no plugin hook) → runs agent and goes to validating", async () => {
  let iterationOpts:
    | { level: number | undefined; promptOverride: string | undefined }
    | undefined;
  const ctx = makeCtx({
    deps: makeDeps({
      runIteration: (opts) => {
        iterationOpts = {
          level: opts.level,
          promptOverride: opts.promptOverride,
        };
        return Promise.resolve({ status: "continue" as const });
      },
    }),
  });
  const next = await transitionRectifying(
    {
      tag: "rectifying",
      iterationsUsed: 1,
      validationFailurePath: ".ralph/validation/iteration-0.log",
    },
    ctx,
  );
  assertEquals(next.tag, "validating");
  assertEquals(iterationOpts?.level, 1);
  assertEquals(
    iterationOpts?.promptOverride?.includes(
      "Your only goal in this pass is to get validation back on track.",
    ),
    true,
  );
  if (next.tag === "validating") {
    assertEquals(next.iterationsUsed, 1);
  }
});

Deno.test("transitionRectifying: plugin promptOverride is passed to agent run", async () => {
  let promptOverride: string | undefined;
  const ctx = makeCtx({
    plugin: {
      onRectify: () => ({
        action: "agent" as const,
        promptOverride: "READ THE VALIDATION FAILURE AND FIX IT",
      }),
    },
    deps: makeDeps({
      runIteration: (opts) => {
        promptOverride = opts.promptOverride;
        return Promise.resolve({ status: "continue" as const });
      },
    }),
  });
  await transitionRectifying(
    {
      tag: "rectifying",
      iterationsUsed: 1,
      validationFailurePath: ".ralph/validation/iteration-0.log",
    },
    ctx,
  );
  assertEquals(promptOverride, "READ THE VALIDATION FAILURE AND FIX IT");
});

Deno.test("transitionRectifying: plugin returns skip → reading_progress", async () => {
  const ctx = makeCtx({
    plugin: {
      onRectify: () => ({ action: "skip" as const }),
    },
  });
  const next = await transitionRectifying(
    {
      tag: "rectifying",
      iterationsUsed: 1,
      validationFailurePath: ".ralph/validation/iteration-0.log",
    },
    ctx,
  );
  assertEquals(next.tag, "reading_progress");
});

Deno.test("transitionRectifying: plugin returns abort → done", async () => {
  const ctx = makeCtx({
    plugin: {
      onRectify: () => ({ action: "abort" as const, reason: "unrecoverable" }),
    },
  });
  const next = await transitionRectifying(
    {
      tag: "rectifying",
      iterationsUsed: 1,
      validationFailurePath: ".ralph/validation/iteration-0.log",
    },
    ctx,
  );
  assertEquals(next.tag, "done");
  if (next.tag === "done") {
    assertEquals(next.iterationsUsed, 1);
  }
});

Deno.test("transitionRectifying: writes checkpoint at rectify step", async () => {
  const checkpoints: { step: string }[] = [];
  const ctx = makeCtx({
    deps: makeDeps({
      writeCheckpoint: (cp) => {
        checkpoints.push(cp);
        return Promise.resolve();
      },
    }),
  });
  await transitionRectifying(
    {
      tag: "rectifying",
      iterationsUsed: 2,
      validationFailurePath: ".ralph/validation/iteration-1.log",
    },
    ctx,
  );
  assertEquals(checkpoints.some((cp) => cp.step === "rectify"), true);
});

// ---------------------------------------------------------------------------
// isTerminal: rectifying is not terminal
// ---------------------------------------------------------------------------

Deno.test("isTerminal: rectifying is not terminal", () => {
  assertEquals(
    isTerminal({
      tag: "rectifying",
      iterationsUsed: 0,
      validationFailurePath: "x.log",
    }),
    false,
  );
});

// ---------------------------------------------------------------------------
// Full rectification loop: validate fails → rectify → re-validate → done
// ---------------------------------------------------------------------------

Deno.test("full loop: validation failure triggers rectification cycle", async () => {
  let validationCallCount = 0;
  const ctx = makeCtx({
    iterations: 5,
    deps: makeDeps({
      readProgress: () => Promise.resolve(allVerifiedProgress),
      runValidation: () => {
        validationCallCount++;
        // First validation (post-merge) fails; second (post-rectify) passes.
        return validationCallCount <= 1
          ? Promise.resolve({
            status: "failed" as const,
            outputPath: ".ralph/validation/iteration-0.log",
          })
          : Promise.resolve({ status: "passed" as const });
      },
    }),
    expectedScenarioIds: ["ARCH.1", "ARCH.2"],
  });

  let state: import("./state-machine.ts").OrchestratorState = {
    tag: "validating",
    iterationsUsed: 0,
    validationFailurePath: undefined,
  };
  const visited: string[] = [];
  let steps = 0;
  while (!isTerminal(state) && steps < 20) {
    state = await transition(state, ctx);
    visited.push(state.tag);
    steps++;
  }
  assertEquals(state.tag, "done");
  assertEquals(visited.includes("rectifying"), true);
});
