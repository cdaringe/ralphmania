import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { runParallelLoop } from "../src/orchestrator.ts";
import type { ParallelDeps } from "../src/orchestrator.ts";
import { resolveWorkerModelSelection } from "../src/runner.ts";
import type { EscalationLevel, ValidationResult } from "../src/types.ts";
import { ok } from "../src/types.ts";
import type { Plugin } from "../src/plugin.ts";
import {
  createEscalationStore,
  createProgressStore,
  integrationDeps,
  noopLog,
  stubWorktree,
} from "./fixtures.ts";

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

Deno.test("integration: worker transitions progress from WIP to WORK_COMPLETE to VERIFIED across rounds", async () => {
  const progress = createProgressStore(
    "| 1.1 |          |      |\n| 1.2 |          |      |",
  );
  let round = 0;

  await runParallelLoop({
    agent: "claude",
    iterations: 5,
    parallelism: 1,
    expectedScenarioIds: ["1.1", "1.2"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: integrationDeps({
      progress,
      onIteration: ({ progress: p }) => {
        // Simulate agent marking scenarios WORK_COMPLETE, then VERIFIED
        round++;
        if (round === 1) {
          p.set(
            "| 1.1 | WORK_COMPLETE | done |\n| 1.2 |          |      |",
          );
        } else if (round === 2) {
          p.set(
            "| 1.1 | VERIFIED | done |\n| 1.2 | WORK_COMPLETE | done |",
          );
        } else if (round === 3) {
          p.set("| 1.1 | VERIFIED | done |\n| 1.2 | VERIFIED | done |");
        }
      },
    }),
  });

  // Should exit before using all 5 iterations since all scenarios become VERIFIED
  assertEquals(round <= 4, true, `Expected <=4 rounds, got ${round}`);
  assertEquals(progress.get().includes("VERIFIED"), true);
});

Deno.test("integration: rework scenarios get escalated level from orchestrator", async () => {
  const progress = createProgressStore(
    "| 1.1 | NEEDS_REWORK | fix this |\n| 1.2 | VERIFIED | done |",
  );
  const escalation = createEscalationStore();
  const levels: (EscalationLevel | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1", "1.2"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: integrationDeps({
      progress,
      escalation,
      onIteration: ({ level }) => {
        levels.push(level);
        // Simulate agent fixing the rework
        progress.set(
          "| 1.1 | WORK_COMPLETE | fixed |\n| 1.2 | VERIFIED | done |",
        );
      },
    }),
  });

  // Escalation state should have been updated for scenario 1.1
  assertEquals(escalation.state["1.1"], 1, "scenario 1.1 should be escalated");

  // Worker should have received escalated level (1), not default (0)
  assertEquals(levels[0], 1, "worker should receive escalation level 1");
});

Deno.test("integration: non-rework scenarios get base level 0", async () => {
  const progress = createProgressStore(
    "| 1.1 |          |      |\n| 1.2 | VERIFIED | done |",
  );
  const levels: (EscalationLevel | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1", "1.2"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: integrationDeps({
      progress,
      onIteration: ({ level }) => {
        levels.push(level);
      },
    }),
  });

  // Non-rework scenario should get level 0
  assertEquals(levels[0], 0, "non-rework worker should receive level 0");
});

Deno.test("integration: CLI --level overrides base level for non-rework", async () => {
  const progress = createProgressStore(
    "| 1.1 |          |      |\n| 1.2 | VERIFIED | done |",
  );
  const levels: (EscalationLevel | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1", "1.2"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: 1,
    deps: integrationDeps({
      progress,
      onIteration: ({ level }) => {
        levels.push(level);
      },
    }),
  });

  // CLI level 1 should override the default 0 for non-rework
  assertEquals(levels[0], 1, "CLI level 1 should propagate to worker");
});

Deno.test("integration: onValidationComplete plugin hook fires in parallel loop", async () => {
  const progress = createProgressStore("| 1.1 |          |      |");
  let hookFired = false;
  let hookResult: ValidationResult | undefined;

  const plugin: Plugin = {
    onValidationComplete: ({ result }) => {
      hookFired = true;
      hookResult = result;
      // Override: convert failure to pass
      return { status: "passed" };
    },
  };

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin,
    level: undefined,
    deps: integrationDeps({
      progress,
      onValidation: () => ({
        status: "failed" as const,
        outputPath: "/tmp/fail.log",
      }),
    }),
  });

  assertEquals(hookFired, true, "onValidationComplete should fire");
  assertEquals(
    hookResult?.status,
    "failed",
    "hook should receive raw validation result",
  );
});

Deno.test("integration: onValidationComplete override prevents failure propagation", async () => {
  const progress = createProgressStore("| 1.1 |          |      |");
  const failurePaths: (string | undefined)[] = [];

  const plugin: Plugin = {
    onValidationComplete: () => {
      // Override all failures to pass
      return { status: "passed" as const };
    },
  };

  await runParallelLoop({
    agent: "claude",
    iterations: 2,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin,
    level: undefined,
    deps: integrationDeps({
      progress,
      onIteration: ({ validationFailurePath }) => {
        failurePaths.push(validationFailurePath);
      },
      onValidation: ({ cwd }) =>
        // Worker-level validation passes; only orchestrator-level fails
        cwd !== undefined ? { status: "passed" as const } : {
          status: "failed" as const,
          outputPath: "/tmp/overridden.log",
        },
    }),
  });

  // Because the plugin overrides to "passed", no failure path should propagate
  assertEquals(failurePaths, [undefined, undefined]);
});

Deno.test("integration: validation failure feeds back to next round", async () => {
  const progress = createProgressStore("| 1.1 |          |      |");
  const failurePaths: (string | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 3,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: integrationDeps({
      progress,
      onIteration: ({ validationFailurePath }) => {
        failurePaths.push(validationFailurePath);
      },
      onValidation: ({ iterationNum, cwd }) =>
        // Only fail at orchestrator level so worker-level validation
        // does not trigger a fix-up re-run.
        cwd === undefined && iterationNum === 0
          ? {
            status: "failed" as const,
            outputPath: "/tmp/round0-fail.log",
          }
          : { status: "passed" as const },
    }),
  });

  assertEquals(failurePaths[0], undefined, "round 0 has no prior failure");
  assertEquals(
    failurePaths[1],
    "/tmp/round0-fail.log",
    "round 1 receives round 0 failure",
  );
  assertEquals(
    failurePaths[2],
    undefined,
    "round 2 clears after round 1 pass",
  );
});

Deno.test("integration: parallel workers get distinct scenarios with correct escalation", async () => {
  const progress = createProgressStore(
    [
      "| 1.1 | NEEDS_REWORK | broken |",
      "| 1.2 |              |        |",
      "| 1.3 | VERIFIED     | done   |",
    ].join("\n"),
  );
  const escalation = createEscalationStore();
  const workerAssignments: {
    scenario?: string;
    level: EscalationLevel | undefined;
  }[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 2,
    expectedScenarioIds: ["1.1", "1.2", "1.3"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: integrationDeps({
      progress,
      escalation,
      onIteration: ({ targetScenarioOverride, level }) => {
        workerAssignments.push({
          scenario: targetScenarioOverride,
          level,
        });
      },
    }),
  });

  // Worker 0: scenario 1.1 (NEEDS_REWORK) → escalated level 1
  // Worker 1: scenario 1.2 (unimplemented) → level 0
  assertEquals(workerAssignments.length, 2, "should launch 2 workers");

  const reworkWorker = workerAssignments.find((w) => w.scenario === "1.1");
  const newWorker = workerAssignments.find((w) => w.scenario === "1.2");

  assertEquals(
    reworkWorker?.level,
    1,
    "NEEDS_REWORK scenario should get escalated level",
  );
  assertEquals(
    newWorker?.level,
    0,
    "unimplemented scenario should get base level",
  );
});

Deno.test("integration: escalation persists across rounds for repeated rework", async () => {
  const progress = createProgressStore(
    "| 1.1 | NEEDS_REWORK | still broken |",
  );
  const escalation = createEscalationStore();
  const levelsPerRound: (EscalationLevel | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 2,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: integrationDeps({
      progress,
      escalation,
      onIteration: ({ level }) => {
        levelsPerRound.push(level);
        // Don't fix it — let it stay NEEDS_REWORK for round 2
      },
    }),
  });

  // Both rounds should see escalated level (capped at 1)
  assertEquals(levelsPerRound[0], 1, "round 1 should escalate");
  assertEquals(levelsPerRound[1], 1, "round 2 should stay escalated (capped)");

  // Escalation state should reflect the scenario
  assertEquals(
    escalation.state["1.1"],
    1,
    "escalation state persists for scenario 1.1",
  );
});

Deno.test("integration: progress changes between rounds affect scenario selection", async () => {
  const progress = createProgressStore(
    "| 1.1 |          |      |\n| 1.2 |          |      |",
  );
  const scenariosPerRound: (string | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 3,
    parallelism: 1,
    expectedScenarioIds: ["1.1", "1.2"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: integrationDeps({
      progress,
      onIteration: ({ targetScenarioOverride }) => {
        scenariosPerRound.push(targetScenarioOverride);

        // Round 1: mark scenario 1.1 as VERIFIED
        if (scenariosPerRound.length === 1) {
          progress.set(
            "| 1.1 | VERIFIED | done |\n| 1.2 |          |      |",
          );
        } // Round 2: mark scenario 1.2 as VERIFIED
        else if (scenariosPerRound.length === 2) {
          progress.set(
            "| 1.1 | VERIFIED | done |\n| 1.2 | VERIFIED | done |",
          );
        }
      },
    }),
  });

  // Round 1 should work on scenario 1.1 (first actionable)
  assertEquals(scenariosPerRound[0], "1.1");
  // Round 2 should work on scenario 1.2 (scenario 1.1 is now VERIFIED)
  assertEquals(scenariosPerRound[1], "1.2");
  // Round 3 should not happen — all verified
  assertEquals(
    scenariosPerRound.length,
    2,
    "should exit after 2 rounds when all VERIFIED",
  );
});

Deno.test("integration: conflict triggers reconciliation then continues", async () => {
  const progress = createProgressStore(
    "| 1.1 |          |      |\n| 1.2 |          |      |",
  );
  let reconcileCount = 0;
  const mergeResults = ["conflict", "merged"] as const;
  let mergeCall = 0;

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 2,
    expectedScenarioIds: ["1.1", "1.2"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: integrationDeps({
      progress,
      onIteration: () => {
        // Workers succeed
      },
      onValidation: () => ({ status: "passed" as const }),
    }),
  });

  // Basic structure: the loop should complete even with conflicts
  // (the stub mergeWorktree returns "merged" so no conflict occurs here,
  // but we can test with overrides)

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 2,
    expectedScenarioIds: ["1.1", "1.2"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: {
      ...integrationDeps({ progress }).valueOf() as object,
      readProgress: () => Promise.resolve(progress.get()),
      createWorktree: ({ workerIndex }) =>
        Promise.resolve(ok(stubWorktree(workerIndex))),
      runIteration: () => Promise.resolve({ status: "continue" as const }),
      runValidation: () => Promise.resolve({ status: "passed" as const }),
      hasNewCommits: () => Promise.resolve(true),
      mergeWorktree: () => {
        const r = mergeResults[mergeCall] ?? "merged";
        mergeCall++;
        return Promise.resolve(r);
      },
      cleanupWorktree: () => Promise.resolve(ok(undefined)),
      resetWorkingTree: () => Promise.resolve(ok(undefined)),
      reconcileMerge: () => {
        reconcileCount++;
        return Promise.resolve();
      },
      readCheckpoint: () => Promise.resolve(undefined),
      writeCheckpoint: () => Promise.resolve(),
      clearCheckpoint: () => Promise.resolve(),
      readEscalationState: () => Promise.resolve({}),
      writeEscalationState: () => Promise.resolve(),
    } satisfies ParallelDeps,
  });

  assertEquals(
    reconcileCount,
    1,
    "reconciliation should trigger for the conflict",
  );
});

Deno.test("integration: OBSOLETE scenarios are skipped, not assigned to workers", async () => {
  const progress = createProgressStore(
    [
      "| 1.1 | OBSOLETE | removed |",
      "| 1.2 |          |         |",
      "| 1.3 | VERIFIED | done    |",
    ].join("\n"),
  );
  const scenarios: (string | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 3,
    expectedScenarioIds: ["1.1", "1.2", "1.3"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: integrationDeps({
      progress,
      onIteration: ({ targetScenarioOverride }) => {
        scenarios.push(targetScenarioOverride);
      },
    }),
  });

  assertEquals(scenarios, ["1.2"], "only scenario 1.2 should be actionable");
});

Deno.test("integration: resolveWorkerModelSelection maps escalated level to CLAUDE_ESCALATED", () => {
  const selection = resolveWorkerModelSelection({
    agent: "claude",
    level: 1,
    targetScenario: "5.1",
  });
  // CLAUDE_ESCALATED: opus/strong/high
  assertEquals(selection.model, "opus");
  assertEquals(selection.mode, "strong");
  assertEquals(selection.effort, "high");
  assertEquals(selection.targetScenario, "5.1");
  assertEquals(selection.actionableScenarios, ["5.1"]);
});

Deno.test("integration: resolveWorkerModelSelection maps base level to CLAUDE_CODER", () => {
  const selection = resolveWorkerModelSelection({
    agent: "claude",
    level: 0,
    targetScenario: "3.1",
  });
  // CLAUDE_CODER: sonnet/general/high
  assertEquals(selection.model, "sonnet");
  assertEquals(selection.mode, "general");
  assertEquals(selection.effort, "high");
  assertEquals(selection.targetScenario, "3.1");
});

Deno.test("integration: resolveWorkerModelSelection codex level 0 uses general", () => {
  const selection = resolveWorkerModelSelection({
    agent: "codex",
    level: 0,
    targetScenario: "1.1",
  });
  assertEquals(selection.model, "gpt-5.1-codex-max");
  assertEquals(selection.mode, "general");
  assertEquals(selection.effort, undefined);
});

Deno.test("integration: resolveWorkerModelSelection codex level 1 uses strong", () => {
  const selection = resolveWorkerModelSelection({
    agent: "codex",
    level: 1,
    targetScenario: "1.1",
  });
  assertEquals(selection.model, "gpt-5.3-codex");
  assertEquals(selection.mode, "strong");
  assertEquals(selection.effort, undefined);
});

Deno.test("integration: full lifecycle — implement, rework, fix, verify", async () => {
  // Simulates a complete lifecycle:
  // Round 1: Agent implements scenario 1.1
  // Round 2: Agent implements scenario 1.2
  // Validation fails after round 2
  // Round 3: Agent receives failure feedback, marks both VERIFIED
  const progress = createProgressStore(
    "| 1.1 |          |      |\n| 1.2 |          |      |",
  );
  const escalation = createEscalationStore();
  let round = 0;
  const validationPaths: (string | undefined)[] = [];

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 10,
    parallelism: 1,
    expectedScenarioIds: ["1.1", "1.2"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: integrationDeps({
      progress,
      escalation,
      onIteration: ({ validationFailurePath }) => {
        round++;
        validationPaths.push(validationFailurePath);

        if (round === 1) {
          progress.set(
            "| 1.1 | WORK_COMPLETE | done |\n| 1.2 |          |      |",
          );
        } else if (round === 2) {
          progress.set(
            "| 1.1 | WORK_COMPLETE | done |\n| 1.2 | WORK_COMPLETE | done |",
          );
        } else if (round === 3) {
          // After validation failure, fix issues and verify
          progress.set(
            "| 1.1 | VERIFIED | done |\n| 1.2 | VERIFIED | done |",
          );
        }
      },
      onValidation: ({ iterationNum, cwd }) =>
        // Only fail at orchestrator level
        cwd === undefined && iterationNum === 1
          ? {
            status: "failed" as const,
            outputPath: "/tmp/validation-fail.log",
          }
          : { status: "passed" as const },
    }),
  });

  // Should complete in 3 rounds (after round 3, all VERIFIED)
  assertEquals(round, 3, "should take 3 rounds");
  assertEquals(iterationsUsed, 3, "should use 3 iterations");

  // Validation feedback should flow correctly
  assertEquals(validationPaths[0], undefined, "round 1: no prior failure");
  assertEquals(validationPaths[1], undefined, "round 2: round 1 passed");
  assertEquals(
    validationPaths[2],
    "/tmp/validation-fail.log",
    "round 3: receives round 2 failure",
  );
});
