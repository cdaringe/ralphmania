import { assertEquals } from "jsr:@std/assert";
import { findActionableScenarios, isAllVerified } from "../src/model.ts";
import { runParallelLoop } from "../src/orchestrator.ts";
import type { ParallelDeps } from "../src/orchestrator.ts";
import type { Logger } from "../src/types.ts";
import { ok } from "../src/types.ts";
import type { WorktreeInfo } from "../src/worktree.ts";

// --- Model function tests (used by parallel orchestration) ---

Deno.test("findActionableScenarios finds scenarios without COMPLETE or VERIFIED", () => {
  const content = [
    "| 1 | COMPLETE | done |",
    "| 2 |          |      |",
    "| 3 | VERIFIED | yep  |",
    "| 4 | NEEDS_REWORK | fix |",
    "| 5 |          |      |",
  ].join("\n");
  assertEquals(findActionableScenarios(content), [2, 4, 5]);
});

Deno.test("findActionableScenarios returns empty when all done", () => {
  const content = [
    "| 1 | COMPLETE | done |",
    "| 2 | VERIFIED | yep  |",
  ].join("\n");
  assertEquals(findActionableScenarios(content), []);
});

Deno.test("findActionableScenarios returns all when none done", () => {
  const content = [
    "| 1 |          |      |",
    "| 2 |          |      |",
  ].join("\n");
  assertEquals(findActionableScenarios(content), [1, 2]);
});

Deno.test("isAllVerified returns true when all VERIFIED and count matches", () => {
  const content = [
    "| 1 | VERIFIED | done |",
    "| 2 | VERIFIED | yep  |",
  ].join("\n");
  assertEquals(isAllVerified(content, 2), true);
});

Deno.test("isAllVerified returns false when rows missing from progress", () => {
  const content = [
    "| 1 | VERIFIED | done |",
    "| 2 | VERIFIED | yep  |",
  ].join("\n");
  assertEquals(isAllVerified(content, 5), false);
});

Deno.test("isAllVerified returns false when some COMPLETE", () => {
  const content = [
    "| 1 | VERIFIED | done |",
    "| 2 | COMPLETE | yep  |",
  ].join("\n");
  assertEquals(isAllVerified(content, 2), false);
});

Deno.test("isAllVerified returns false on empty content", () => {
  assertEquals(isAllVerified("", 0), false);
});

Deno.test("isAllVerified returns false when some not done", () => {
  const content = [
    "| 1 | VERIFIED | done |",
    "| 2 |          |      |",
  ].join("\n");
  assertEquals(isAllVerified(content, 2), false);
});

// --- runParallelLoop tests ---

const noopLog: Logger = () => {};

const stubWorktree = (workerIndex: number): WorktreeInfo => ({
  scenario: workerIndex,
  path: `/tmp/ralph-wt-${workerIndex}`,
  branch: `ralph/worker-${workerIndex}-${Date.now()}`,
});

const stubDeps = (
  overrides: Partial<ParallelDeps> = {},
): ParallelDeps => ({
  readProgress: () => Promise.resolve(""),
  createWorktree: ({ workerIndex }) =>
    Promise.resolve(ok(stubWorktree(workerIndex))),
  runIteration: () => Promise.resolve({ status: "continue" }),
  runValidation: () => Promise.resolve({ status: "passed" as const }),
  hasNewCommits: () => Promise.resolve(false),
  mergeWorktree: () => Promise.resolve("merged"),
  cleanupWorktree: () => Promise.resolve(ok(undefined)),
  resetWorkingTree: () => Promise.resolve(ok(undefined)),
  reconcileMerge: () => Promise.resolve(),
  readCheckpoint: () => Promise.resolve(undefined),
  writeCheckpoint: () => Promise.resolve(),
  clearCheckpoint: () => Promise.resolve(),
  ...overrides,
});

Deno.test("runParallelLoop exits immediately when all scenarios verified", async () => {
  const content = "| 1 | VERIFIED | done |\n| 2 | VERIFIED | done |";

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 5,
    parallelism: 2,
    expectedScenarioCount: 2,
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
    "| 1 | VERIFIED | done |\n| 2 |          |      |\n| 3 |          |      |";
  const workersCreated: number[] = [];

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 2,
    expectedScenarioCount: 3,
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
  const content = "| 1 |          |      |";

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 3,
    parallelism: 1,
    expectedScenarioCount: 1,
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
    expectedScenarioCount: 1,
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
            : "| 1 | VERIFIED | done |",
        );
      },
    }),
  });

  assertEquals(iterationsUsed, 1);
});

Deno.test("runParallelLoop merges worktrees with new commits", async () => {
  const content = "| 1 |          |      |";
  let merged = false;

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioCount: 1,
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
  const content = "| 1 |          |      |";
  let merged = false;

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioCount: 1,
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
    expectedScenarioCount: 1,
    signal: controller.signal,
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps(),
  });

  assertEquals(iterationsUsed, 130);
});

Deno.test("runParallelLoop runs validation after each round", async () => {
  const content = "| 1 |          |      |";
  let validationCount = 0;

  await runParallelLoop({
    agent: "claude",
    iterations: 2,
    parallelism: 1,
    expectedScenarioCount: 1,
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
  const content = "| 1 |          |      |";
  let cleanedUp = false;

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioCount: 1,
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
  const content = "| 1 |          |      |";
  const failurePaths: (string | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 2,
    parallelism: 1,
    expectedScenarioCount: 1,
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
  const content = "| 1 |          |      |";
  const failurePaths: (string | undefined)[] = [];
  let round = 0;

  await runParallelLoop({
    agent: "claude",
    iterations: 3,
    parallelism: 1,
    expectedScenarioCount: 1,
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
  const content = "| 1 |          |      |";
  const checkpoints: { iterationsUsed: number; step: string }[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 3,
    parallelism: 1,
    expectedScenarioCount: 1,
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
  const content = "| 1 |          |      |";
  let cleared = false;

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioCount: 1,
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
  const content = "| 1 |          |      |";
  let rounds = 0;

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 5,
    parallelism: 1,
    expectedScenarioCount: 1,
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
  const content = "| 1 |          |      |";
  const failurePaths: (string | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 4,
    parallelism: 1,
    expectedScenarioCount: 1,
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
  const content = "| 1 |          |      |";
  const checkpoints: {
    step: string;
    validationFailurePath: string | undefined;
  }[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 2,
    parallelism: 1,
    expectedScenarioCount: 1,
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
  const content = "| 1 |          |      |";
  let agentRuns = 0;

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 4,
    parallelism: 1,
    expectedScenarioCount: 1,
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

Deno.test("runParallelLoop does not pass targetScenarioOverride to workers", async () => {
  const content = "| 1 |          |      |";
  let hasOverride = true;

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    expectedScenarioCount: 1,
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      runIteration: (opts) => {
        hasOverride = "targetScenarioOverride" in opts;
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  assertEquals(hasOverride, false);
});
