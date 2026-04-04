import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { err } from "../src/types.ts";
import {
  isTerminal,
  transition,
  transitionCheckingDoneness,
  transitionFindingActionable,
  transitionInit,
  transitionReadingProgress,
  transitionRunningWorkers,
  transitionValidating,
} from "../src/machines/state-machine.ts";
import type {
  CheckingDonenessState,
  FindingActionableState,
  OrchestratorState,
  ReadingProgressState,
  RunningWorkersState,
  ValidatingState,
} from "../src/machines/state-machine.ts";
import type { EscalationState } from "../src/types.ts";
import { makeCtx, stubDeps } from "./fixtures.ts";

// ---------------------------------------------------------------------------
// isTerminal
// ---------------------------------------------------------------------------

Deno.test("isTerminal returns true for done", () => {
  assertEquals(isTerminal({ tag: "done", iterationsUsed: 3 }), true);
});

Deno.test("isTerminal returns true for aborted", () => {
  assertEquals(isTerminal({ tag: "aborted" }), true);
});

Deno.test("isTerminal returns false for non-terminal states", () => {
  assertEquals(isTerminal({ tag: "init" }), false);
  assertEquals(
    isTerminal({
      tag: "reading_progress",
      iterationsUsed: 0,
      validationFailurePath: undefined,
    }),
    false,
  );
  assertEquals(
    isTerminal({
      tag: "validating",
      iterationsUsed: 0,
      validationFailurePath: undefined,
    }),
    false,
  );
});

// ---------------------------------------------------------------------------
// transitionInit
// ---------------------------------------------------------------------------

Deno.test("transitionInit without checkpoint → reading_progress", async () => {
  const ctx = makeCtx();
  const next = await transitionInit(ctx);
  assertEquals(next.tag, "reading_progress");
  if (next.tag === "reading_progress") {
    assertEquals(next.iterationsUsed, 0);
    assertEquals(next.validationFailurePath, undefined);
  }
});

Deno.test("transitionInit with validate checkpoint → validating", async () => {
  const ctx = makeCtx({
    deps: stubDeps({
      readCheckpoint: () =>
        Promise.resolve({
          iterationsUsed: 5,
          step: "validate" as const,
          validationFailurePath: "/tmp/fail.log",
        }),
    }),
  });
  const next = await transitionInit(ctx);
  assertEquals(next.tag, "validating");
  if (next.tag === "validating") {
    assertEquals(next.iterationsUsed, 5);
    assertEquals(next.validationFailurePath, "/tmp/fail.log");
  }
});

Deno.test("transitionInit with done checkpoint → reading_progress with correct iteration count", async () => {
  const ctx = makeCtx({
    deps: stubDeps({
      readCheckpoint: () =>
        Promise.resolve({
          iterationsUsed: 3,
          step: "done" as const,
          validationFailurePath: undefined,
        }),
    }),
  });
  const next = await transitionInit(ctx);
  assertEquals(next.tag, "reading_progress");
  if (next.tag === "reading_progress") {
    assertEquals(next.iterationsUsed, 3);
  }
});

// ---------------------------------------------------------------------------
// transitionReadingProgress
// ---------------------------------------------------------------------------

Deno.test("transitionReadingProgress with aborted signal → aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const ctx = makeCtx({ signal: controller.signal });
  const state: ReadingProgressState = {
    tag: "reading_progress",
    iterationsUsed: 0,
    validationFailurePath: undefined,
  };
  const next = await transitionReadingProgress(state, ctx);
  assertEquals(next.tag, "aborted");
});

Deno.test("transitionReadingProgress at iteration limit → done", async () => {
  const ctx = makeCtx({ iterations: 3 });
  const state: ReadingProgressState = {
    tag: "reading_progress",
    iterationsUsed: 3,
    validationFailurePath: undefined,
  };
  const next = await transitionReadingProgress(state, ctx);
  assertEquals(next.tag, "done");
  if (next.tag === "done") {
    assertEquals(next.iterationsUsed, 3);
  }
});

Deno.test("transitionReadingProgress all verified → done", async () => {
  const content = "| 1.1 | VERIFIED | done |\n| 1.2 | VERIFIED | done |";
  const ctx = makeCtx({
    deps: stubDeps({ readProgress: () => Promise.resolve(content) }),
  });
  const state: ReadingProgressState = {
    tag: "reading_progress",
    iterationsUsed: 0,
    validationFailurePath: undefined,
  };
  const next = await transitionReadingProgress(state, ctx);
  assertEquals(next.tag, "done");
});

Deno.test("transitionReadingProgress with actionable scenarios → finding_actionable", async () => {
  const content = "| 1.1 |          |      |\n| 1.2 | VERIFIED | done |";
  const ctx = makeCtx({
    deps: stubDeps({ readProgress: () => Promise.resolve(content) }),
  });
  const state: ReadingProgressState = {
    tag: "reading_progress",
    iterationsUsed: 0,
    validationFailurePath: undefined,
  };
  const next = await transitionReadingProgress(state, ctx);
  assertEquals(next.tag, "finding_actionable");
  if (next.tag === "finding_actionable") {
    assertEquals(next.progressContent, content);
  }
});

Deno.test("transitionReadingProgress invalid status clears validationFailurePath", async () => {
  const content = "| 1.1 | COMPLETE | done |";
  const ctx = makeCtx({
    expectedScenarioIds: ["1.1"],
    deps: stubDeps({ readProgress: () => Promise.resolve(content) }),
  });
  const state: ReadingProgressState = {
    tag: "reading_progress",
    iterationsUsed: 0,
    validationFailurePath: "/tmp/old-fail.log",
  };
  const next = await transitionReadingProgress(state, ctx);
  assertEquals(next.tag, "finding_actionable");
  if (next.tag === "finding_actionable") {
    assertEquals(next.validationFailurePath, undefined);
  }
});

// ---------------------------------------------------------------------------
// transitionFindingActionable
// ---------------------------------------------------------------------------

Deno.test("transitionFindingActionable with no actionable → done", async () => {
  const content = "| 1.1 | VERIFIED | done |\n| 1.2 | OBSOLETE | skip |";
  const ctx = makeCtx({ expectedScenarioIds: ["1.1", "1.2"] });
  const state: FindingActionableState = {
    tag: "finding_actionable",
    iterationsUsed: 0,
    validationFailurePath: undefined,
    progressContent: content,
  };
  const next = await transitionFindingActionable(state, ctx);
  assertEquals(next.tag, "done");
});

Deno.test("transitionFindingActionable with actionable scenarios → running_workers", async () => {
  const content = "| 1.1 |          |      |\n| 1.2 | NEEDS_REWORK | fix |";
  const ctx = makeCtx();
  const state: FindingActionableState = {
    tag: "finding_actionable",
    iterationsUsed: 0,
    validationFailurePath: undefined,
    progressContent: content,
  };
  const next = await transitionFindingActionable(state, ctx);
  assertEquals(next.tag, "running_workers");
  if (next.tag === "running_workers") {
    // NEEDS_REWORK should come first in ordering
    assertEquals(next.uniqueActionable[0], "1.2");
    assertEquals(next.uniqueActionable[1], "1.1");
  }
});

Deno.test("transitionFindingActionable updates escalation state", async () => {
  const content = "| 1.1 | NEEDS_REWORK | fix |";
  let writtenState: EscalationState = {};
  const ctx = makeCtx({
    deps: stubDeps({
      writeEscalationState: (s) => {
        writtenState = s;
        return Promise.resolve();
      },
    }),
  });
  const state: FindingActionableState = {
    tag: "finding_actionable",
    iterationsUsed: 0,
    validationFailurePath: undefined,
    progressContent: content,
  };
  const next = await transitionFindingActionable(state, ctx);
  assertEquals(next.tag, "running_workers");
  assertEquals(writtenState["1.1"], 1);
  if (next.tag === "running_workers") {
    assertEquals(next.escalation["1.1"], 1);
  }
});

// ---------------------------------------------------------------------------
// transitionRunningWorkers
// ---------------------------------------------------------------------------

Deno.test("transitionRunningWorkers with worktrees → validating", async () => {
  const ctx = makeCtx();
  const state: RunningWorkersState = {
    tag: "running_workers",
    iterationsUsed: 0,
    validationFailurePath: undefined,
    uniqueActionable: ["1.1"],
    escalation: {},
  };
  const next = await transitionRunningWorkers(state, ctx);
  assertEquals(next.tag, "validating");
  if (next.tag === "validating") {
    assertEquals(next.iterationsUsed, 0);
  }
});

Deno.test("transitionRunningWorkers no worktrees → reading_progress (skip round)", async () => {
  const ctx = makeCtx({
    deps: stubDeps({
      createWorktree: () => Promise.resolve(err("git failed")),
    }),
  });
  const state: RunningWorkersState = {
    tag: "running_workers",
    iterationsUsed: 2,
    validationFailurePath: undefined,
    uniqueActionable: ["1.1"],
    escalation: {},
  };
  const next = await transitionRunningWorkers(state, ctx);
  assertEquals(next.tag, "reading_progress");
  if (next.tag === "reading_progress") {
    assertEquals(next.iterationsUsed, 3);
  }
});

Deno.test("transitionRunningWorkers passes correct escalation levels to workers", async () => {
  const levels: (number | undefined)[] = [];
  const ctx = makeCtx({
    parallelism: 2,
    deps: stubDeps({
      runIteration: (opts) => {
        levels.push(opts.level);
        return Promise.resolve({ status: "continue" });
      },
    }),
  });
  const state: RunningWorkersState = {
    tag: "running_workers",
    iterationsUsed: 0,
    validationFailurePath: undefined,
    uniqueActionable: ["1.1", "1.2"],
    escalation: { "1.1": 1 },
  };
  await transitionRunningWorkers(state, ctx);
  assertEquals(levels.sort(), [0, 1]);
});

Deno.test("transitionRunningWorkers passes workerIndex to runIteration for stdio prefixing", async () => {
  const workerIndices: (number | undefined)[] = [];
  const ctx = makeCtx({
    parallelism: 2,
    deps: stubDeps({
      runIteration: (opts) => {
        workerIndices.push(opts.workerIndex);
        return Promise.resolve({ status: "continue" });
      },
    }),
  });
  const state: RunningWorkersState = {
    tag: "running_workers",
    iterationsUsed: 0,
    validationFailurePath: undefined,
    uniqueActionable: ["5.1", "9.1"],
    escalation: {},
  };
  await transitionRunningWorkers(state, ctx);
  assertEquals(workerIndices.sort(), [0, 1]);
});

Deno.test("transitionRunningWorkers writes agent checkpoint", async () => {
  const checkpoints: { step: string }[] = [];
  const ctx = makeCtx({
    deps: stubDeps({
      writeCheckpoint: (cp) => {
        checkpoints.push(cp);
        return Promise.resolve();
      },
    }),
  });
  const state: RunningWorkersState = {
    tag: "running_workers",
    iterationsUsed: 0,
    validationFailurePath: undefined,
    uniqueActionable: ["1.1"],
    escalation: {},
  };
  await transitionRunningWorkers(state, ctx);
  assertEquals(checkpoints[0]?.step, "agent");
});

Deno.test("transitionRunningWorkers worker validation failure persists escalation state", async () => {
  let writtenEscalation: EscalationState = {};
  const rerunLevels: (number | undefined)[] = [];
  let callCount = 0;
  const ctx = makeCtx({
    deps: stubDeps({
      runIteration: (opts) => {
        callCount++;
        // Second call is the re-run after validation failure
        if (callCount === 2) rerunLevels.push(opts.level);
        return Promise.resolve({ status: "continue" });
      },
      runValidation: () =>
        Promise.resolve({
          status: "failed" as const,
          outputPath: "/tmp/wt-fail.log",
        }),
      writeEscalationState: (s) => {
        writtenEscalation = s;
        return Promise.resolve();
      },
    }),
  });
  const state: RunningWorkersState = {
    tag: "running_workers",
    iterationsUsed: 0,
    validationFailurePath: undefined,
    uniqueActionable: ["1.1"],
    escalation: {},
  };
  await transitionRunningWorkers(state, ctx);
  // Escalation should include the failed scenario at level 1
  assertEquals(writtenEscalation["1.1"], 1);
  // Re-run should use the escalated level
  assertEquals(rerunLevels, [1]);
});

Deno.test("transitionRunningWorkers worker validation failure re-run receives validationFailurePath", async () => {
  let rerunFailurePath: string | undefined;
  let callCount = 0;
  const ctx = makeCtx({
    deps: stubDeps({
      runIteration: (opts) => {
        callCount++;
        if (callCount === 2) rerunFailurePath = opts.validationFailurePath;
        return Promise.resolve({ status: "continue" });
      },
      runValidation: () =>
        Promise.resolve({
          status: "failed" as const,
          outputPath: "/tmp/wt-fail.log",
        }),
    }),
  });
  const state: RunningWorkersState = {
    tag: "running_workers",
    iterationsUsed: 0,
    validationFailurePath: undefined,
    uniqueActionable: ["1.1"],
    escalation: {},
  };
  await transitionRunningWorkers(state, ctx);
  assertEquals(rerunFailurePath, "/tmp/wt-fail.log");
});

// ---------------------------------------------------------------------------
// transitionValidating
// ---------------------------------------------------------------------------

Deno.test("transitionValidating → checking_doneness with incremented iteration", async () => {
  const ctx = makeCtx();
  const state: ValidatingState = {
    tag: "validating",
    iterationsUsed: 2,
    validationFailurePath: undefined,
  };
  const next = await transitionValidating(state, ctx);
  assertEquals(next.tag, "checking_doneness");
  if (next.tag === "checking_doneness") {
    assertEquals(next.iterationsUsed, 3);
    assertEquals(next.validationFailurePath, undefined);
  }
});

Deno.test("transitionValidating with failing validation → checking_doneness with failure path", async () => {
  const ctx = makeCtx({
    deps: stubDeps({
      runValidation: () =>
        Promise.resolve({
          status: "failed" as const,
          outputPath: "/tmp/fail.log",
        }),
    }),
  });
  const state: ValidatingState = {
    tag: "validating",
    iterationsUsed: 0,
    validationFailurePath: undefined,
  };
  const next = await transitionValidating(state, ctx);
  assertEquals(next.tag, "checking_doneness");
  if (next.tag === "checking_doneness") {
    assertEquals(next.validationFailurePath, "/tmp/fail.log");
  }
});

Deno.test("transitionValidating fires onValidationComplete plugin hook", async () => {
  let hookFired = false;
  const ctx = makeCtx({
    plugin: {
      onValidationComplete: ({ result: _result }) => {
        hookFired = true;
        return { status: "passed" as const };
      },
    },
    deps: stubDeps({
      runValidation: () =>
        Promise.resolve({
          status: "failed" as const,
          outputPath: "/tmp/x.log",
        }),
    }),
  });
  const state: ValidatingState = {
    tag: "validating",
    iterationsUsed: 0,
    validationFailurePath: undefined,
  };
  const next = await transitionValidating(state, ctx);
  assertEquals(hookFired, true);
  // Plugin overrode failure to pass, so no failure path
  if (next.tag === "checking_doneness") {
    assertEquals(next.validationFailurePath, undefined);
  }
});

Deno.test("transitionValidating writes validate then done checkpoints", async () => {
  const steps: string[] = [];
  const ctx = makeCtx({
    deps: stubDeps({
      writeCheckpoint: (cp) => {
        steps.push(cp.step);
        return Promise.resolve();
      },
    }),
  });
  const state: ValidatingState = {
    tag: "validating",
    iterationsUsed: 0,
    validationFailurePath: undefined,
  };
  await transitionValidating(state, ctx);
  assertEquals(steps, ["validate", "done"]);
});

// ---------------------------------------------------------------------------
// transitionCheckingDoneness
// ---------------------------------------------------------------------------

Deno.test("transitionCheckingDoneness all verified → done", async () => {
  const content = "| 1.1 | VERIFIED | done |\n| 1.2 | VERIFIED | done |";
  const ctx = makeCtx({
    deps: stubDeps({ readProgress: () => Promise.resolve(content) }),
  });
  const state: CheckingDonenessState = {
    tag: "checking_doneness",
    iterationsUsed: 3,
    validationFailurePath: undefined,
  };
  const next = await transitionCheckingDoneness(state, ctx);
  assertEquals(next.tag, "done");
  if (next.tag === "done") {
    assertEquals(next.iterationsUsed, 3);
  }
});

Deno.test("transitionCheckingDoneness not all verified with failure → rectifying (budget remaining)", async () => {
  const content = "| 1.1 | VERIFIED | done |\n| 1.2 |          |      |";
  const ctx = makeCtx({
    deps: stubDeps({ readProgress: () => Promise.resolve(content) }),
  });
  const state: CheckingDonenessState = {
    tag: "checking_doneness",
    iterationsUsed: 1,
    validationFailurePath: "/tmp/old.log",
  };
  const next = await transitionCheckingDoneness(state, ctx);
  assertEquals(next.tag, "rectifying");
  if (next.tag === "rectifying") {
    assertEquals(next.iterationsUsed, 1);
    assertEquals(next.validationFailurePath, "/tmp/old.log");
  }
});

// ---------------------------------------------------------------------------
// transition dispatcher
// ---------------------------------------------------------------------------

Deno.test("transition dispatches init correctly", async () => {
  const ctx = makeCtx();
  const next = await transition({ tag: "init" }, ctx);
  assertEquals(next.tag, "reading_progress");
});

Deno.test("transition returns done state unchanged", async () => {
  const ctx = makeCtx();
  const done: OrchestratorState = { tag: "done", iterationsUsed: 5 };
  const next = await transition(done, ctx);
  assertEquals(next, done);
});

Deno.test("transition returns aborted state unchanged", async () => {
  const ctx = makeCtx();
  const aborted: OrchestratorState = { tag: "aborted" };
  const next = await transition(aborted, ctx);
  assertEquals(next, aborted);
});

// ---------------------------------------------------------------------------
// Multi-step transition sequences
// ---------------------------------------------------------------------------

Deno.test("transition sequence: init → reading_progress → finding_actionable → running_workers → validating → checking_doneness → done", async () => {
  let round = 0;
  const ctx = makeCtx({
    iterations: 1,
    expectedScenarioIds: ["1.1"],
    deps: stubDeps({
      readSpec: () => Promise.resolve("| 1.1 | Scenario one |"),
      readProgress: () => {
        round++;
        return Promise.resolve(
          round <= 2
            ? "| 1.1 |          |      |"
            : "| 1.1 | VERIFIED | done |",
        );
      },
    }),
  });

  let state: OrchestratorState = { tag: "init" };
  const tags: string[] = [];

  while (!isTerminal(state)) {
    state = await transition(state, ctx);
    tags.push(state.tag);
  }

  assertEquals(tags, [
    "reading_progress",
    "finding_actionable",
    "running_workers",
    "validating",
    "checking_doneness",
    "done",
  ]);
});

Deno.test("transition sequence: checkpoint resume skips to validating", async () => {
  const ctx = makeCtx({
    iterations: 5,
    expectedScenarioIds: ["1.1"],
    deps: stubDeps({
      readCheckpoint: () =>
        Promise.resolve({
          iterationsUsed: 2,
          step: "validate" as const,
          validationFailurePath: undefined,
        }),
      readSpec: () => Promise.resolve("| 1.1 | Scenario one |"),
      readProgress: () => Promise.resolve("| 1.1 | VERIFIED | done |"),
    }),
  });

  let state: OrchestratorState = { tag: "init" };
  const tags: string[] = [];

  while (!isTerminal(state)) {
    state = await transition(state, ctx);
    tags.push(state.tag);
  }

  // Should go: init → validating → checking_doneness → done
  // (skipping reading_progress, finding_actionable, running_workers)
  assertEquals(tags, [
    "validating",
    "checking_doneness",
    "done",
  ]);
});

// ---------------------------------------------------------------------------
// Validation failure prevents premature exit
// ---------------------------------------------------------------------------

Deno.test("transitionReadingProgress all verified but validation failure → finding_actionable", async () => {
  const content = "| 1.1 | VERIFIED | done |\n| 1.2 | VERIFIED | done |";
  const ctx = makeCtx({
    deps: stubDeps({ readProgress: () => Promise.resolve(content) }),
  });
  const state: ReadingProgressState = {
    tag: "reading_progress",
    iterationsUsed: 0,
    validationFailurePath: "/tmp/fail.log",
  };
  const next = await transitionReadingProgress(state, ctx);
  assertEquals(next.tag, "finding_actionable");
});

Deno.test("transitionCheckingDoneness all verified but validation failure → rectifying (budget remaining)", async () => {
  const content = "| 1.1 | VERIFIED | done |\n| 1.2 | VERIFIED | done |";
  const ctx = makeCtx({
    deps: stubDeps({ readProgress: () => Promise.resolve(content) }),
  });
  const state: CheckingDonenessState = {
    tag: "checking_doneness",
    iterationsUsed: 1,
    validationFailurePath: "/tmp/fail.log",
  };
  const next = await transitionCheckingDoneness(state, ctx);
  assertEquals(next.tag, "rectifying");
  if (next.tag === "rectifying") {
    assertEquals(next.validationFailurePath, "/tmp/fail.log");
  }
});

Deno.test("transitionFindingActionable no actionable but validation failure → forces scenarios to running_workers", async () => {
  const content = "| 1.1 | VERIFIED | done |\n| 1.2 | VERIFIED | done |";
  const ctx = makeCtx({ expectedScenarioIds: ["1.1", "1.2"] });
  const state: FindingActionableState = {
    tag: "finding_actionable",
    iterationsUsed: 0,
    validationFailurePath: "/tmp/fail.log",
    progressContent: content,
  };
  const next = await transitionFindingActionable(state, ctx);
  assertEquals(next.tag, "running_workers");
  if (next.tag === "running_workers") {
    assertEquals(next.uniqueActionable, ["1.1", "1.2"]);
    assertEquals(next.validationFailurePath, "/tmp/fail.log");
  }
});

Deno.test("transitionFindingActionable validation failure but all OBSOLETE → done (cannot recover)", async () => {
  const content = "| 1.1 | OBSOLETE | skip |\n| 1.2 | OBSOLETE | skip |";
  const ctx = makeCtx({ expectedScenarioIds: ["1.1", "1.2"] });
  const state: FindingActionableState = {
    tag: "finding_actionable",
    iterationsUsed: 0,
    validationFailurePath: "/tmp/fail.log",
    progressContent: content,
  };
  const next = await transitionFindingActionable(state, ctx);
  assertEquals(next.tag, "done");
});

// ---------------------------------------------------------------------------
// Deep verification: spec/progress mismatch prevents premature exit
// ---------------------------------------------------------------------------

Deno.test("transitionCheckingDoneness spec/progress ID mismatch → reading_progress (not done)", async () => {
  // Progress has IDs 43, 44 all VERIFIED, but spec has DOCSSITE.1, DOCSSITE.2
  const progressContent = "| 43 | VERIFIED | done |\n| 44 | VERIFIED | done |";
  const specContent =
    "| DOCSSITE.1 | Build docs site |\n| DOCSSITE.2 | Deploy docs site |";
  const ctx = makeCtx({
    expectedScenarioIds: ["DOCSSITE.1", "DOCSSITE.2"],
    deps: stubDeps({
      readProgress: () => Promise.resolve(progressContent),
      readSpec: () => Promise.resolve(specContent),
    }),
  });
  const state: CheckingDonenessState = {
    tag: "checking_doneness",
    iterationsUsed: 3,
    validationFailurePath: undefined,
  };
  const next = await transitionCheckingDoneness(state, ctx);
  assertEquals(next.tag, "reading_progress");
});

Deno.test("transitionReadingProgress spec/progress ID mismatch → finding_actionable (not done)", async () => {
  const progressContent = "| 43 | VERIFIED | done |\n| 44 | VERIFIED | done |";
  const specContent =
    "| DOCSSITE.1 | Build docs site |\n| DOCSSITE.2 | Deploy docs site |";
  const ctx = makeCtx({
    expectedScenarioIds: ["DOCSSITE.1", "DOCSSITE.2"],
    deps: stubDeps({
      readProgress: () => Promise.resolve(progressContent),
      readSpec: () => Promise.resolve(specContent),
    }),
  });
  const state: ReadingProgressState = {
    tag: "reading_progress",
    iterationsUsed: 0,
    validationFailurePath: undefined,
  };
  const next = await transitionReadingProgress(state, ctx);
  assertEquals(next.tag, "finding_actionable");
});

Deno.test("transitionCheckingDoneness with fresh spec matching progress → done", async () => {
  const progressContent =
    "| A.1 | VERIFIED | done |\n| A.2 | VERIFIED | done |";
  const specContent = "| A.1 | Scenario A1 |\n| A.2 | Scenario A2 |";
  const ctx = makeCtx({
    expectedScenarioIds: ["A.1", "A.2"],
    deps: stubDeps({
      readProgress: () => Promise.resolve(progressContent),
      readSpec: () => Promise.resolve(specContent),
    }),
  });
  const state: CheckingDonenessState = {
    tag: "checking_doneness",
    iterationsUsed: 5,
    validationFailurePath: undefined,
  };
  const next = await transitionCheckingDoneness(state, ctx);
  assertEquals(next.tag, "done");
  if (next.tag === "done") {
    assertEquals(next.iterationsUsed, 5);
  }
});
