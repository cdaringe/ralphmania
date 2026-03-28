import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  cleanupWorktree,
  createWorktree,
  hasNewCommits,
} from "../src/worktree.ts";
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

  assertEquals(result.ok, true);
  if (!result.ok) return;

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
  assertEquals(cleanup.ok, true);

  // Verify directory removed
  const afterStat = await Deno.stat(wt.path).catch(() => null);
  assertEquals(afterStat, null);
});
