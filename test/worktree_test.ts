import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  cleanupWorktree,
  createWorktree,
  hasNewCommits,
  resetAllWorktrees,
} from "../src/git/worktree.ts";
import { ESCALATION_FILE, LOOP_STATE_FILE } from "../src/constants.ts";
import { noopLog } from "./fixtures.ts";

Deno.test("createWorktree creates and cleanupWorktree removes", async () => {
  // This test requires being in a git repo — skip if not
  const gitCheck = await new Deno.Command("git", {
    args: ["rev-parse", "--git-dir"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (gitCheck.code !== 0) return;

  const result = await createWorktree({
    scenario: "99",
    workerIndex: 0,
    log: noopLog,
  });

  assertEquals(result.isOk(), true);
  if (!result.isOk()) return;

  const wt = result.value;
  assertEquals(wt.scenario, "99");
  assertEquals(typeof wt.path, "string");
  assertEquals(typeof wt.branch, "string");

  // Verify directory exists
  const stat = await Deno.stat(wt.path).catch(() => null);
  assertEquals(stat !== null, true);

  // No new commits yet
  const has = await hasNewCommits({ worktree: wt, log: noopLog });
  assertEquals(has, false);

  // Cleanup
  const cleanup = await cleanupWorktree({ worktree: wt, log: noopLog });
  assertEquals(cleanup.isOk(), true);

  // Verify directory removed
  const afterStat = await Deno.stat(wt.path).catch(() => null);
  assertEquals(afterStat, null);
});

Deno.test("resetAllWorktrees clears worktrees and state files", async () => {
  const gitCheck = await new Deno.Command("git", {
    args: ["rev-parse", "--git-dir"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (gitCheck.code !== 0) return;

  // Create a worktree so there is something to clean up
  const wt = await createWorktree({
    scenario: "reset-test",
    workerIndex: 99,
    log: noopLog,
  });
  assertEquals(wt.isOk(), true);

  // Write dummy state files
  await Deno.mkdir(".ralph", { recursive: true });
  await Deno.writeTextFile(ESCALATION_FILE, "{}");
  await Deno.writeTextFile(LOOP_STATE_FILE, "{}");

  const result = await resetAllWorktrees({ log: noopLog });
  assertEquals(result.isOk(), true);

  // Worktree directory should be gone
  if (wt.isOk()) {
    const stat = await Deno.stat(wt.value.path).catch(() => null);
    assertEquals(stat, null);
  }

  // State files should be cleared
  const escStat = await Deno.stat(ESCALATION_FILE).catch(() => null);
  assertEquals(escStat, null);
  const loopStat = await Deno.stat(LOOP_STATE_FILE).catch(() => null);
  assertEquals(loopStat, null);
});

Deno.test("resetAllWorktrees succeeds when no worktrees exist", async () => {
  const gitCheck = await new Deno.Command("git", {
    args: ["rev-parse", "--git-dir"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (gitCheck.code !== 0) return;

  // Should not throw even if WORKTREE_BASE_DIR doesn't exist
  const result = await resetAllWorktrees({ log: noopLog });
  assertEquals(result.isOk(), true);
});
