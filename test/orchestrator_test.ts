import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { findActionableScenarios, isAllVerified } from "../src/model.ts";
import { runParallelLoop } from "../src/orchestrator.ts";
import { noopLog, stubDeps, stubWorktree } from "./fixtures.ts";
import { err, ok, type Result } from "../src/types.ts";

/** Unwrap a Result, throwing on error. */
const unwrap = <T>(r: Result<T, string>): T => {
  if (r.isErr()) throw new Error(`Unexpected error: ${r.error}`);
  return r.value;
};

// --- Model function tests (used by parallel orchestration) ---

Deno.test("findActionableScenarios finds scenarios that are not VERIFIED or OBSOLETE", () => {
  const content = [
    "| 1.1 | WORK_COMPLETE | done |",
    "| 1.2 |          |      |",
    "| 1.3 | VERIFIED | yep  |",
    "| 1.4 | NEEDS_REWORK | fix |",
    "| 1.5 |          |      |",
  ].join("\n");
  assertEquals(unwrap(findActionableScenarios(content)), [
    "1.1",
    "1.2",
    "1.4",
    "1.5",
  ]);
});

Deno.test("findActionableScenarios returns empty when all VERIFIED", () => {
  const content = [
    "| 1.1 | VERIFIED | done |",
    "| 1.2 | VERIFIED | yep  |",
  ].join("\n");
  assertEquals(unwrap(findActionableScenarios(content)), []);
});

Deno.test("findActionableScenarios returns all when none done", () => {
  const content = [
    "| 1.1 |          |      |",
    "| 1.2 |          |      |",
  ].join("\n");
  assertEquals(unwrap(findActionableScenarios(content)), ["1.1", "1.2"]);
});

Deno.test("isAllVerified returns true when all VERIFIED and IDs match", () => {
  const content = [
    "| 1.1 | VERIFIED | done |",
    "| 1.2 | VERIFIED | yep  |",
  ].join("\n");
  assertEquals(unwrap(isAllVerified(content, ["1.1", "1.2"])), true);
});

Deno.test("isAllVerified returns false when expected scenario IDs are missing", () => {
  const content = [
    "| 1.1 | VERIFIED | done |",
    "| 1.2 | VERIFIED | yep  |",
  ].join("\n");
  assertEquals(
    unwrap(isAllVerified(content, ["1.1", "1.2", "1.3", "1.4", "1.5"])),
    false,
  );
});

Deno.test("isAllVerified returns false when IDs do not match expected", () => {
  const content = [
    "| 1.1 | VERIFIED | done |",
    "| 1.3 | VERIFIED | yep  |",
  ].join("\n");
  assertEquals(unwrap(isAllVerified(content, ["1.1", "1.2"])), false);
});

Deno.test("isAllVerified returns false when non-sequential IDs miss expected set", () => {
  const content = [
    "| 2.1 | VERIFIED | done |",
    "| 3.1 | VERIFIED | yep  |",
    "| 8.1 | VERIFIED | ok   |",
  ].join("\n");
  assertEquals(
    unwrap(
      isAllVerified(content, [
        "1.1",
        "2.1",
        "3.1",
        "4.1",
        "5.1",
        "6.1",
        "7.1",
        "8.1",
        "9.1",
        "10.1",
      ]),
    ),
    false,
  );
});

Deno.test("isAllVerified returns true when expectedScenarioIds is undefined", () => {
  const content = [
    "| 1.1 | VERIFIED | done |",
    "| 1.2 | VERIFIED | yep  |",
  ].join("\n");
  assertEquals(unwrap(isAllVerified(content)), true);
});

Deno.test("isAllVerified returns false when some WORK_COMPLETE", () => {
  const content = [
    "| 1.1 | VERIFIED | done |",
    "| 1.2 | WORK_COMPLETE | yep  |",
  ].join("\n");
  assertEquals(unwrap(isAllVerified(content, ["1.1", "1.2"])), false);
});

Deno.test("isAllVerified returns false on empty content", () => {
  assertEquals(unwrap(isAllVerified("", [])), false);
});

Deno.test("isAllVerified returns false when some not done", () => {
  const content = [
    "| 1.1 | VERIFIED | done |",
    "| 1.2 |          |      |",
  ].join("\n");
  assertEquals(unwrap(isAllVerified(content, ["1.1", "1.2"])), false);
});

Deno.test("findActionableScenarios skips OBSOLETE scenarios", () => {
  const content = [
    "| 1.1 | OBSOLETE | no longer needed |",
    "| 1.2 |          |                  |",
    "| 1.3 | VERIFIED | done             |",
  ].join("\n");
  assertEquals(unwrap(findActionableScenarios(content)), ["1.2"]);
});

Deno.test("isAllVerified returns true when all VERIFIED and OBSOLETE cover expected IDs", () => {
  const content = [
    "| 1.1 | VERIFIED | done     |",
    "| 1.2 | OBSOLETE | skipped  |",
    "| 1.3 | VERIFIED | done     |",
  ].join("\n");
  assertEquals(unwrap(isAllVerified(content, ["1.1", "1.2", "1.3"])), true);
});

Deno.test("isAllVerified returns false when OBSOLETE leaves some IDs incomplete", () => {
  const content = [
    "| 1.1 | VERIFIED | done     |",
    "| 1.2 | OBSOLETE | skipped  |",
    "| 1.3 |          |          |",
  ].join("\n");
  assertEquals(unwrap(isAllVerified(content, ["1.1", "1.2", "1.3"])), false);
});

Deno.test("isAllVerified returns true when all rows are OBSOLETE matching expected IDs", () => {
  const content = [
    "| 1.1 | OBSOLETE | skipped |",
    "| 1.2 | OBSOLETE | skipped |",
  ].join("\n");
  assertEquals(unwrap(isAllVerified(content, ["1.1", "1.2"])), true);
});

// --- runParallelLoop tests ---

Deno.test("runParallelLoop exits immediately when all scenarios verified", async () => {
  const content = "| 1.1 | VERIFIED | done |\n| 1.2 | VERIFIED | done |";

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 5,
    parallelism: 2,
    expectedScenarioIds: ["1.1", "1.2"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({ readProgress: () => Promise.resolve(content) }),
  });

  assertEquals(iterationsUsed, 0);
});

Deno.test("runParallelLoop dispatches parallelism workers", async () => {
  const content =
    "| 1.1 | VERIFIED | done |\n| 1.2 |          |      |\n| 1.3 |          |      |";
  const workersCreated: number[] = [];

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 2,
    expectedScenarioIds: ["1.1", "1.2", "1.3"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      createWorktree: ({ workerIndex }) => {
        workersCreated.push(workerIndex);
        return Promise.resolve(ok(stubWorktree(workerIndex)));
      },
    }),
  });

  assertEquals(iterationsUsed, 1);
  assertEquals(workersCreated, [0, 1]);
});

Deno.test("runParallelLoop stops after max iterations", async () => {
  const content = "| 1.1 |          |      |";

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 3,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
    }),
  });

  assertEquals(iterationsUsed, 3);
});

Deno.test("runParallelLoop stops early when verified after round", async () => {
  let readCount = 0;

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 10,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => {
        readCount++;
        // First read: not done. Post-round read: all verified.
        return Promise.resolve(
          readCount <= 1
            ? "| 1 |          |      |"
            : "| 1.1 | VERIFIED | done |",
        );
      },
    }),
  });

  assertEquals(iterationsUsed, 1);
});

Deno.test("runParallelLoop merges worktrees with new commits", async () => {
  const content = "| 1.1 |          |      |";
  let merged = false;

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      hasNewCommits: () => Promise.resolve(true),
      mergeWorktree: () => {
        merged = true;
        return Promise.resolve("merged");
      },
    }),
  });

  assertEquals(merged, true);
});

Deno.test("runParallelLoop skips merge when no new commits", async () => {
  const content = "| 1.1 |          |      |";
  let merged = false;

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      hasNewCommits: () => Promise.resolve(false),
      mergeWorktree: () => {
        merged = true;
        return Promise.resolve("merged");
      },
    }),
  });

  assertEquals(merged, false);
});

Deno.test("runParallelLoop returns 130 on aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 5,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: controller.signal,
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps(),
  });

  assertEquals(iterationsUsed, 130);
});

Deno.test("runParallelLoop runs validation after each round", async () => {
  const content = "| 1.1 |          |      |";
  let validationCount = 0;

  await runParallelLoop({
    agent: "claude",
    iterations: 2,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      runValidation: () => {
        validationCount++;
        return Promise.resolve({ status: "passed" as const });
      },
    }),
  });

  assertEquals(validationCount, 2);
});

Deno.test("runParallelLoop cleans up worktrees on worker failure", async () => {
  const content = "| 1.1 |          |      |";
  let cleanedUp = false;

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      runIteration: () => Promise.resolve({ status: "failed", code: 1 }),
      cleanupWorktree: () => {
        cleanedUp = true;
        return Promise.resolve(ok(undefined));
      },
    }),
  });

  assertEquals(cleanedUp, true);
});

Deno.test("runParallelLoop passes validation failure path to next round workers", async () => {
  const content = "| 1.1 |          |      |";
  const failurePaths: (string | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 2,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      runIteration: (opts) => {
        failurePaths.push(opts.validationFailurePath);
        return Promise.resolve({ status: "continue" });
      },
      runValidation: ({ iterationNum }) =>
        Promise.resolve(
          iterationNum === 0
            ? {
              status: "failed" as const,
              outputPath: "/tmp/validation-0.log",
            }
            : { status: "passed" as const },
        ),
    }),
  });

  assertEquals(failurePaths, [undefined, "/tmp/validation-0.log"]);
});

Deno.test("runParallelLoop clears validation failure path after passing", async () => {
  const content = "| 1.1 |          |      |";
  const failurePaths: (string | undefined)[] = [];
  let round = 0;

  await runParallelLoop({
    agent: "claude",
    iterations: 3,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      runIteration: (opts) => {
        failurePaths.push(opts.validationFailurePath);
        return Promise.resolve({ status: "continue" });
      },
      runValidation: () => {
        const r = round++;
        return Promise.resolve(
          r === 0
            ? {
              status: "failed" as const,
              outputPath: "/tmp/fail.log",
            }
            : { status: "passed" as const },
        );
      },
    }),
  });

  assertEquals(failurePaths, [undefined, "/tmp/fail.log", undefined]);
});

Deno.test("runParallelLoop writes checkpoint after each round", async () => {
  const content = "| 1.1 |          |      |";
  const checkpoints: { iterationsUsed: number; step: string }[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 3,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      writeCheckpoint: (cp) => {
        checkpoints.push(cp);
        return Promise.resolve();
      },
    }),
  });

  // Each round writes agent + validate + done — verify the "done" checkpoints
  const doneCheckpoints = checkpoints.filter((c) => c.step === "done");
  assertEquals(doneCheckpoints.length, 3);
  assertEquals(doneCheckpoints.map((c) => c.iterationsUsed), [1, 2, 3]);
});

Deno.test("runParallelLoop clears checkpoint on clean exit", async () => {
  const content = "| 1.1 |          |      |";
  let cleared = false;

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      clearCheckpoint: () => {
        cleared = true;
        return Promise.resolve();
      },
    }),
  });

  assertEquals(cleared, true);
});

Deno.test("runParallelLoop resumes iterationsUsed from checkpoint", async () => {
  const content = "| 1.1 |          |      |";
  let rounds = 0;

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 5,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      readCheckpoint: () =>
        Promise.resolve({
          iterationsUsed: 3,
          step: "done" as const,
          validationFailurePath: undefined,
        }),
      runIteration: () => {
        rounds++;
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  assertEquals(iterationsUsed, 5);
  assertEquals(rounds, 2); // only rounds 4 and 5
});

Deno.test("runParallelLoop restores validationFailurePath from checkpoint", async () => {
  const content = "| 1.1 |          |      |";
  const failurePaths: (string | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 4,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      readCheckpoint: () =>
        Promise.resolve({
          iterationsUsed: 3,
          step: "done" as const,
          validationFailurePath: "/tmp/saved-fail.log",
        }),
      runIteration: (opts) => {
        failurePaths.push(opts.validationFailurePath);
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  assertEquals(failurePaths, ["/tmp/saved-fail.log"]);
});

Deno.test("runParallelLoop writes checkpoint with validationFailurePath", async () => {
  const content = "| 1.1 |          |      |";
  const checkpoints: {
    step: string;
    validationFailurePath: string | undefined;
  }[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 2,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      writeCheckpoint: (cp) => {
        checkpoints.push(cp);
        return Promise.resolve();
      },
      runValidation: ({ iterationNum }) =>
        Promise.resolve(
          iterationNum === 0
            ? { status: "failed" as const, outputPath: "/tmp/v.log" }
            : { status: "passed" as const },
        ),
    }),
  });

  // "done" checkpoints carry the post-validation failure path
  const done = checkpoints.filter((c) => c.step === "done");
  assertEquals(done[0]?.validationFailurePath, "/tmp/v.log");
  assertEquals(done[1]?.validationFailurePath, undefined);
});

Deno.test("runParallelLoop resumes at validate step — skips agent work", async () => {
  const content = "| 1.1 |          |      |";
  let agentRuns = 0;

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 4,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      readCheckpoint: () =>
        Promise.resolve({
          iterationsUsed: 2,
          step: "validate" as const,
          validationFailurePath: undefined,
        }),
      runIteration: () => {
        agentRuns++;
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  assertEquals(iterationsUsed, 4);
  // Iteration 2 resumed at validate (no agent); iteration 3 ran agent normally
  assertEquals(agentRuns, 1);
});

Deno.test("runParallelLoop always prescribes targetScenarioOverride to workers", async () => {
  const content = "| 1.1 |          |      |";
  let override: string | undefined = undefined;

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      runIteration: (opts) => {
        override = opts.targetScenarioOverride;
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  // Worker 0 must be prescribed scenario 1.1 (the only actionable one)
  assertEquals(override, "1.1");
});

Deno.test("runParallelLoop logs error for invalid progress statuses", async () => {
  const content = "| 1.1 | COMPLETE | done |\n| 1.2 | VERIFIED | done |";
  const errors: string[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1", "1.2"],
    signal: AbortSignal.timeout(10_000),
    log: (opts) => {
      if (opts.tags[0] === "error") errors.push(opts.message);
    },
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
    }),
  });

  assertEquals(
    errors.some((e) => e.includes('invalid status "COMPLETE"')),
    true,
  );
});

Deno.test("runParallelLoop prescribes distinct scenarios to parallel workers", async () => {
  const content = [
    "| 1.1 |          |      |",
    "| 1.2 |          |      |",
    "| 1.3 |          |      |",
  ].join("\n");
  const overrides: string[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 3,
    expectedScenarioIds: ["1.1", "1.2", "1.3"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      createWorktree: ({ workerIndex }) =>
        Promise.resolve(ok(stubWorktree(workerIndex))),
      runIteration: (opts) => {
        if (opts.targetScenarioOverride !== undefined) {
          overrides.push(opts.targetScenarioOverride);
        }
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  // Each worker gets a distinct scenario; no duplicates
  assertEquals(overrides.sort(), ["1.1", "1.2", "1.3"]);
});

Deno.test("runParallelLoop skips round when all worktree creations fail", async () => {
  const content = "| 1.1 |          |      |";
  let iterationRan = false;

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      createWorktree: () => Promise.resolve(err("git failed")),
      runIteration: () => {
        iterationRan = true;
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  assertEquals(iterationRan, false);
  assertEquals(iterationsUsed, 1);
});

Deno.test("runParallelLoop triggers reconcileMerge on conflict", async () => {
  const content = "| 1.1 |          |      |";
  let reconciled = false;

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      hasNewCommits: () => Promise.resolve(true),
      mergeWorktree: () => Promise.resolve("conflict"),
      reconcileMerge: () => {
        reconciled = true;
        return Promise.resolve();
      },
    }),
  });

  assertEquals(reconciled, true);
});

Deno.test("runParallelLoop deduplicates scenarios so no two workers get the same one", async () => {
  // Simulate progress.md with duplicate rows for scenario 18.1 (both NEEDS_REWORK)
  const content = [
    "| 18.1 | NEEDS_REWORK | fix |",
    "| 18.1 | NEEDS_REWORK | fix |",
  ].join("\n");
  const overrides: string[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 2,
    expectedScenarioIds: ["18.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      createWorktree: ({ workerIndex }) =>
        Promise.resolve(ok(stubWorktree(workerIndex))),
      runIteration: (opts) => {
        if (opts.targetScenarioOverride !== undefined) {
          overrides.push(opts.targetScenarioOverride);
        }
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  // Only one worker should be launched — scenario 18.1 must not be duplicated
  assertEquals(overrides, ["18.1"]);
});

Deno.test("runParallelLoop deduplicates across rework and actionable lists", async () => {
  // Scenario 5.1 appears as both actionable (no status) and in a duplicate row
  const content = [
    "| 5.1 |          |      |",
    "| 5.1 |          |      |",
    "| 5.2 |          |      |",
  ].join("\n");
  const overrides: string[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 3,
    expectedScenarioIds: ["5.1", "5.2"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      createWorktree: ({ workerIndex }) =>
        Promise.resolve(ok(stubWorktree(workerIndex))),
      runIteration: (opts) => {
        if (opts.targetScenarioOverride !== undefined) {
          overrides.push(opts.targetScenarioOverride);
        }
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  // Should only get [5.1, 5.2], not [5.1, 5.1, 5.2]
  assertEquals(overrides.sort(), ["5.1", "5.2"]);
});

Deno.test("runParallelLoop logs resolved/still-actionable after merge", async () => {
  let readCount = 0;
  const messages: string[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioIds: ["1.1"],
    signal: AbortSignal.timeout(10_000),
    log: (opts) => {
      messages.push(opts.message);
    },
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => {
        readCount++;
        return Promise.resolve(
          readCount <= 1
            ? "| 1 |          |      |"
            : "| 1.1 | VERIFIED | done |",
        );
      },
      hasNewCommits: () => Promise.resolve(true),
      mergeWorktree: () => Promise.resolve("merged"),
    }),
  });

  assertEquals(
    messages.some((m) => m.includes("Scenario 1.1: resolved")),
    true,
  );
});

Deno.test("runParallelLoop does not assign workers to VERIFIED scenarios with imperfect formatting", async () => {
  // Regression: old regex-based code treated the last VERIFIED row without a
  // trailing pipe as actionable because \s* matched \n and borrowed the next
  // line's pipe — the last row had no next line to borrow from.
  const content = [
    "| 1.1  | VERIFIED",
    "| 1.2  |         ",
    "| 18.1 | VERIFIED",
  ].join("\n");
  const overrides: string[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 2,
    expectedScenarioIds: ["1.1", "1.2", "18.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      createWorktree: ({ workerIndex }) =>
        Promise.resolve(ok(stubWorktree(workerIndex))),
      runIteration: (opts) => {
        if (opts.targetScenarioOverride !== undefined) {
          overrides.push(opts.targetScenarioOverride);
        }
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  // Only scenario 1.2 (empty status) should get a worker — not 1.1 or 18.1
  assertEquals(overrides, ["1.2"]);
});
