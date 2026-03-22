import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.11";
import {
  buildReconcilePrompt,
  hasUnresolvedConflicts,
  parseConflictedFiles,
  reconcileMerge,
} from "../src/reconcile.ts";
import type { ReconcileDeps } from "../src/reconcile.ts";
import type { WorktreeInfo } from "../src/worktree.ts";
import { noopLog } from "./fixtures.ts";

const stubWorktree: WorktreeInfo = {
  path: "/tmp/ralph-wt-0",
  branch: "ralph/worker-0-scenario-1-123",
  scenario: 1,
};

const stubRun = (
  responses: { code: number; stdout: string; stderr: string }[],
): ReconcileDeps["run"] => {
  let callIndex = 0;
  return () => {
    const response = responses[callIndex] ??
      { code: 0, stdout: "", stderr: "" };
    callIndex++;
    return Promise.resolve(response);
  };
};

const stubSpawnAgent = (
  codes: number[] = [0],
): ReconcileDeps["spawnAgent"] => {
  let callIndex = 0;
  return () => {
    const code = codes[callIndex] ?? 0;
    callIndex++;
    return Promise.resolve({ code });
  };
};

// --- parseConflictedFiles ---

Deno.test("parseConflictedFiles extracts UU files", () => {
  const porcelain = "UU src/foo.ts\nM  src/bar.ts\nUU src/baz.ts\n";
  assertEquals(parseConflictedFiles(porcelain), ["src/foo.ts", "src/baz.ts"]);
});

Deno.test("parseConflictedFiles handles AA, DD, AU, UA, DU, UD markers", () => {
  const porcelain = [
    "AA file1.ts",
    "DD file2.ts",
    "AU file3.ts",
    "UA file4.ts",
    "DU file5.ts",
    "UD file6.ts",
  ].join("\n");
  assertEquals(parseConflictedFiles(porcelain), [
    "file1.ts",
    "file2.ts",
    "file3.ts",
    "file4.ts",
    "file5.ts",
    "file6.ts",
  ]);
});

Deno.test("parseConflictedFiles returns empty for clean status", () => {
  assertEquals(parseConflictedFiles("M  src/foo.ts\n"), []);
  assertEquals(parseConflictedFiles(""), []);
});

// --- hasUnresolvedConflicts ---

Deno.test("hasUnresolvedConflicts returns true when conflicts exist", async () => {
  const run = stubRun([{ code: 0, stdout: "UU src/foo.ts", stderr: "" }]);
  assertEquals(await hasUnresolvedConflicts(run), true);
});

Deno.test("hasUnresolvedConflicts returns false when clean", async () => {
  const run = stubRun([{ code: 0, stdout: "M  src/foo.ts", stderr: "" }]);
  assertEquals(await hasUnresolvedConflicts(run), false);
});

// --- buildReconcilePrompt ---

Deno.test("buildReconcilePrompt includes branch, scenario, and files", () => {
  const prompt = buildReconcilePrompt({
    worktree: stubWorktree,
    conflictedFiles: ["src/a.ts", "src/b.ts"],
  });
  assertEquals(prompt.includes(stubWorktree.branch), true);
  assertEquals(prompt.includes("scenario 1"), true);
  assertEquals(prompt.includes("- src/a.ts"), true);
  assertEquals(prompt.includes("- src/b.ts"), true);
  assertEquals(prompt.includes("git merge --abort"), true); // warns NOT to do it
});

// --- reconcileMerge ---

Deno.test("reconcileMerge returns immediately when merge succeeds", async () => {
  let agentCalled = false;

  await reconcileMerge({
    worktree: stubWorktree,
    agent: "claude",
    signal: AbortSignal.timeout(5_000),
    log: noopLog,
    deps: {
      // merge succeeds (code 0)
      run: stubRun([{ code: 0, stdout: "", stderr: "" }]),
      spawnAgent: () => {
        agentCalled = true;
        return Promise.resolve({ code: 0 });
      },
    },
  });

  assertEquals(agentCalled, false);
});

Deno.test("reconcileMerge resolves conflicts on first agent attempt", async () => {
  let agentCallCount = 0;

  // Call sequence:
  // 1. git merge → fails (code 1)
  // 2. git status --porcelain → shows conflict
  // 3. (agent spawns)
  // 4. git status --porcelain → clean (no conflicts)
  const responses = [
    { code: 1, stdout: "", stderr: "merge conflict" }, // merge fails
    { code: 0, stdout: "UU src/foo.ts", stderr: "" }, // status shows conflict
    { code: 0, stdout: "M  src/foo.ts", stderr: "" }, // post-agent status clean
  ];

  await reconcileMerge({
    worktree: stubWorktree,
    agent: "claude",
    signal: AbortSignal.timeout(5_000),
    log: noopLog,
    deps: {
      run: stubRun(responses),
      spawnAgent: () => {
        agentCallCount++;
        return Promise.resolve({ code: 0 });
      },
    },
  });

  assertEquals(agentCallCount, 1);
});

Deno.test("reconcileMerge retries when first agent attempt fails to resolve", async () => {
  let agentCallCount = 0;

  // Call sequence:
  // Attempt 1:
  //   1. git merge → fails
  //   2. git status → conflict
  //   3. (agent spawns — fails to resolve)
  //   4. git status → still conflict
  //   5. git merge --abort
  // Attempt 2:
  //   6. git merge → fails
  //   7. git status → conflict
  //   8. (agent spawns — resolves)
  //   9. git status → clean
  const responses = [
    // Attempt 1
    { code: 1, stdout: "", stderr: "conflict" }, // merge
    { code: 0, stdout: "UU src/foo.ts", stderr: "" }, // status (conflict)
    // agent runs here
    { code: 0, stdout: "UU src/foo.ts", stderr: "" }, // status (still conflict)
    { code: 0, stdout: "", stderr: "" }, // merge --abort
    // Attempt 2
    { code: 1, stdout: "", stderr: "conflict" }, // merge
    { code: 0, stdout: "UU src/foo.ts", stderr: "" }, // status (conflict)
    // agent runs here
    { code: 0, stdout: "M  src/foo.ts", stderr: "" }, // status (clean)
  ];

  await reconcileMerge({
    worktree: stubWorktree,
    agent: "claude",
    signal: AbortSignal.timeout(5_000),
    log: noopLog,
    deps: {
      run: stubRun(responses),
      spawnAgent: () => {
        agentCallCount++;
        return Promise.resolve({ code: 0 });
      },
    },
  });

  assertEquals(agentCallCount, 2);
});

Deno.test("reconcileMerge spawns agent when merge fails without conflicts", async () => {
  let agentCallCount = 0;
  let lastPrompt = "";

  // Call sequence:
  // Attempt 1:
  //   1. git merge → fails (code 1)
  //   2. git status --porcelain → no conflict markers (empty/clean)
  //   3. git merge --abort
  //   4. (agent spawns with broad merge prompt)
  //   5. git log -1 --pretty=%s → shows merge commit mentioning branch
  const responses = [
    { code: 1, stdout: "", stderr: "merge failed" }, // merge fails
    { code: 0, stdout: "", stderr: "" }, // status: no conflicts
    { code: 0, stdout: "", stderr: "" }, // merge --abort
    // agent runs here
    {
      code: 0,
      stdout: `Merge ${stubWorktree.branch} (scenario 1, reconciled)`,
      stderr: "",
    }, // git log -1
  ];

  await reconcileMerge({
    worktree: stubWorktree,
    agent: "claude",
    signal: AbortSignal.timeout(5_000),
    log: noopLog,
    deps: {
      run: stubRun(responses),
      spawnAgent: ({ prompt }) => {
        agentCallCount++;
        lastPrompt = prompt;
        return Promise.resolve({ code: 0 });
      },
    },
  });

  assertEquals(agentCallCount, 1);
  assertEquals(
    lastPrompt.includes("without leaving standard conflict markers"),
    true,
  );
  assertEquals(lastPrompt.includes(stubWorktree.branch), true);
});

Deno.test("reconcileMerge retries when agent fails to land merge without conflicts", async () => {
  let agentCallCount = 0;

  // Call sequence:
  // Attempt 1 (no conflicts path, agent fails to land merge):
  //   1. git merge → fails
  //   2. git status → no conflicts
  //   3. git merge --abort
  //   4. (agent spawns — doesn't complete merge)
  //   5. git log → no mention of branch
  // Attempt 2 (merge succeeds directly):
  //   6. git merge → succeeds
  const responses = [
    // Attempt 1
    { code: 1, stdout: "", stderr: "merge failed" }, // merge fails
    { code: 0, stdout: "", stderr: "" }, // status: no conflicts
    { code: 0, stdout: "", stderr: "" }, // merge --abort
    // agent runs here
    { code: 0, stdout: "some unrelated commit", stderr: "" }, // git log: no branch name
    // Attempt 2
    { code: 0, stdout: "", stderr: "" }, // merge succeeds
  ];

  await reconcileMerge({
    worktree: stubWorktree,
    agent: "claude",
    signal: AbortSignal.timeout(5_000),
    log: noopLog,
    deps: {
      run: stubRun(responses),
      spawnAgent: () => {
        agentCallCount++;
        return Promise.resolve({ code: 0 });
      },
    },
  });

  assertEquals(agentCallCount, 1);
});

Deno.test("reconcileMerge throws on aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();

  await assertRejects(
    () =>
      reconcileMerge({
        worktree: stubWorktree,
        agent: "claude",
        signal: controller.signal,
        log: noopLog,
        deps: {
          run: stubRun([{ code: 1, stdout: "", stderr: "conflict" }]),
          spawnAgent: stubSpawnAgent(),
        },
      }),
    DOMException,
  );
});
