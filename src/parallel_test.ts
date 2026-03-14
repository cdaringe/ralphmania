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
  runValidation: () => Promise.resolve(undefined),
  hasNewCommits: () => Promise.resolve(false),
  mergeWorktree: () => Promise.resolve("merged"),
  cleanupWorktree: () => Promise.resolve(ok(undefined)),
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
        return Promise.resolve(undefined);
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

Deno.test("runParallelLoop does not pass targetScenarioOverride to workers", async () => {
  const content = "| 1 |          |      |";
  let hasOverride = true;

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
      runIteration: (opts) => {
        hasOverride = "targetScenarioOverride" in opts;
        return Promise.resolve({ status: "continue" });
      },
    }),
  });

  assertEquals(hasOverride, false);
});
