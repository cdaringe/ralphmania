import { assertEquals } from "jsr:@std/assert";
import { findActionableScenarios, isAllVerified } from "./model.ts";
import { runParallelLoop } from "./parallel.ts";
import type { ParallelDeps } from "./parallel.ts";
import type { Logger } from "./types.ts";
import { ok } from "./types.ts";
import type { WorktreeInfo } from "./worktree.ts";

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

Deno.test("isAllVerified returns true when all VERIFIED", () => {
  const content = [
    "| 1 | VERIFIED | done |",
    "| 2 | VERIFIED | yep  |",
  ].join("\n");
  assertEquals(isAllVerified(content), true);
});

Deno.test("isAllVerified returns false when some COMPLETE", () => {
  const content = [
    "| 1 | VERIFIED | done |",
    "| 2 | COMPLETE | yep  |",
  ].join("\n");
  assertEquals(isAllVerified(content), false);
});

Deno.test("isAllVerified returns false on empty content", () => {
  assertEquals(isAllVerified(""), false);
});

Deno.test("isAllVerified returns false when some not done", () => {
  const content = [
    "| 1 | VERIFIED | done |",
    "| 2 |          |      |",
  ].join("\n");
  assertEquals(isAllVerified(content), false);
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
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => {
        readCount++;
        // First read: not done. Post-round read: all verified.
        return Promise.resolve(
          readCount <= 2
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

// --- New: scenario distribution & merge robustness ---

Deno.test("runParallelLoop passes distinct targetScenarioOverride to workers", async () => {
  const content =
    "| 1 | VERIFIED | done |\n| 2 |          |      |\n| 3 | NEEDS_REWORK | fix |\n| 4 |          |      |";
  const overrides: (number | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 3,
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      runIteration: (opts) => {
        overrides.push(opts.targetScenarioOverride);
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  // NEEDS_REWORK (3) first, then remaining actionable (2, 4)
  assertEquals(overrides, [3, 2, 4]);
});

Deno.test("runParallelLoop calls resetWorkingTree before merges", async () => {
  const content = "| 1 |          |      |";
  const callOrder: string[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      hasNewCommits: () => Promise.resolve(true),
      resetWorkingTree: () => {
        callOrder.push("reset");
        return Promise.resolve(ok(undefined));
      },
      mergeWorktree: () => {
        callOrder.push("merge");
        return Promise.resolve("merged");
      },
    }),
  });

  assertEquals(callOrder, ["reset", "merge"]);
});

Deno.test("runParallelLoop limits workers to actionable scenario count", async () => {
  const content =
    "| 1 | VERIFIED | done |\n| 2 |          |      |\n| 3 | VERIFIED | done |";
  const workersCreated: number[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 3,
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

  // Only 1 actionable scenario (2), so only 1 worker
  assertEquals(workersCreated, [0]);
});

Deno.test("runParallelLoop logs scenario resolution after merges", async () => {
  let readCount = 0;
  const logged: string[] = [];
  const testLog: Logger = (opts) => {
    logged.push(opts.message);
  };

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 2,
    signal: AbortSignal.timeout(10_000),
    log: testLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => {
        readCount++;
        // Round start: two actionable. Post-merge: scenario 1 resolved.
        return Promise.resolve(
          readCount <= 1
            ? "| 1 |          |      |\n| 2 |          |      |"
            : "| 1 | COMPLETE |      |\n| 2 |          |      |",
        );
      },
      hasNewCommits: () => Promise.resolve(true),
      mergeWorktree: () => Promise.resolve("merged"),
    }),
  });

  const resolved = logged.filter((m) => m.includes("resolved by"));
  const stillActionable = logged.filter((m) => m.includes("still actionable"));
  assertEquals(resolved.length, 1);
  assertEquals(stillActionable.length, 1);
});

// --- Checkpoint (state serialization) tests ---

Deno.test("runParallelLoop writes checkpoint after each round", async () => {
  const content = "| 1 |          |      |";
  const written: { iterationsUsed: number; step: string }[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 2,
    parallelism: 1,
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      writeCheckpoint: (cp) => {
        written.push(cp);
        return Promise.resolve();
      },
    }),
  });

  // Each round writes agent + validate + done; verify the "done" checkpoints
  const done = written.filter((c) => c.step === "done");
  assertEquals(done.length, 2);
  assertEquals(done[0].iterationsUsed, 1);
  assertEquals(done[1].iterationsUsed, 2);
});

Deno.test("runParallelLoop clears checkpoint on clean exit", async () => {
  const content = "| 1 | VERIFIED | done |";
  let cleared = false;

  await runParallelLoop({
    agent: "claude",
    iterations: 5,
    parallelism: 1,
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
  const written: { iterationsUsed: number; step: string }[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 5,
    parallelism: 1,
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
      writeCheckpoint: (cp) => {
        written.push(cp);
        return Promise.resolve();
      },
    }),
  });

  // Started from 3, ran until 5 — "done" checkpoints for iterations 4 and 5
  const done = written.filter((c) => c.step === "done").map((c) =>
    c.iterationsUsed
  );
  assertEquals(done, [4, 5]);
});

Deno.test("runParallelLoop restores validationFailurePath from checkpoint", async () => {
  const content = "| 1 |          |      |";
  const failurePaths: (string | undefined)[] = [];

  await runParallelLoop({
    agent: "claude",
    iterations: 4,
    parallelism: 1,
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
          validationFailurePath: "/tmp/prior-failure.log",
        }),
      runIteration: (opts) => {
        failurePaths.push(opts.validationFailurePath);
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  // First iteration after resume should see the restored failure path
  assertEquals(failurePaths[0], "/tmp/prior-failure.log");
});

Deno.test("runParallelLoop writes checkpoint with validationFailurePath", async () => {
  const content = "| 1 |          |      |";
  const written: { step: string; validationFailurePath: string | undefined }[] =
    [];

  await runParallelLoop({
    agent: "claude",
    iterations: 1,
    parallelism: 1,
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: stubDeps({
      readProgress: () => Promise.resolve(content),
      runValidation: () =>
        Promise.resolve({ status: "failed", outputPath: "/tmp/fail.log" }),
      writeCheckpoint: (cp) => {
        written.push(cp);
        return Promise.resolve();
      },
    }),
  });

  // "done" checkpoint carries the failure path from validation
  const done = written.filter((c) => c.step === "done");
  assertEquals(done[0]?.validationFailurePath, "/tmp/fail.log");
});
