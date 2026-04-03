// coverage:ignore — Git subprocess operations requiring real repository state
import type { Logger, Result } from "../types.ts";
import { err, ok } from "../types.ts";
import {
  ESCALATION_FILE,
  LOOP_STATE_FILE,
  WORKTREE_BASE_DIR,
} from "../constants.ts";

export type WorktreeInfo = {
  readonly path: string;
  readonly branch: string;
  readonly scenario: string;
};

export type MergeResult = "merged" | "conflict";

const run = async (
  args: string[],
  opts?: { cwd?: string },
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const output = await new Deno.Command("git", {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    cwd: opts?.cwd,
  }).output();
  const decoder = new TextDecoder();
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout).trim(),
    stderr: decoder.decode(output.stderr).trim(),
  };
};

export const createWorktree = async (
  { scenario, workerIndex, log }: {
    scenario: string;
    workerIndex: number;
    log: Logger;
  },
): Promise<Result<WorktreeInfo, string>> => {
  const timestamp = Date.now();
  const branch =
    `ralph/worker-${workerIndex}-scenario-${scenario}-${timestamp}`;
  const path = `${WORKTREE_BASE_DIR}/worker-${workerIndex}`;

  // Remove stale worktree path if it exists
  try {
    await Deno.stat(path);
    log({
      tags: ["debug", "worktree"],
      message: `Removing stale worktree at ${path}`,
    });
    await forceRemoveWorktree(path, log);
  } catch {
    // Path doesn't exist, which is fine
  }

  await Deno.mkdir(WORKTREE_BASE_DIR, { recursive: true });

  const result = await run(["worktree", "add", "-b", branch, path, "HEAD"]);

  return result.code !== 0
    ? err(`Failed to create worktree: ${result.stderr}`)
    : (log({
      tags: ["info", "worktree"],
      message: `Created worktree at ${path} on branch ${branch}`,
    }),
      ok({ path, branch, scenario }));
};

export const hasNewCommits = async (
  { worktree, log }: { worktree: WorktreeInfo; log: Logger },
): Promise<boolean> => {
  const result = await run(["log", "HEAD.." + worktree.branch, "--oneline"], {
    cwd: undefined,
  });
  return result.code !== 0
    ? (log({
      tags: ["debug", "worktree"],
      message:
        `Failed to check commits for ${worktree.branch}: ${result.stderr}`,
    }),
      false)
    : result.stdout.length > 0;
};

const mergeWithTheirs = async (
  { worktree, log }: { worktree: WorktreeInfo; log: Logger },
): Promise<MergeResult> => {
  const result = await run([
    "merge",
    worktree.branch,
    "-X",
    "theirs",
    "--no-edit",
    "-m",
    `Merge ${worktree.branch} (scenario ${worktree.scenario}, resolved)`,
  ]);

  return result.code !== 0
    ? (log({
      tags: ["error", "worktree"],
      message:
        `Merge failed for scenario ${worktree.scenario} even with theirs strategy`,
    }),
      await run(["merge", "--abort"]),
      "conflict" as const)
    : (log({
      tags: ["info", "worktree"],
      message:
        `Merged ${worktree.branch} (scenario ${worktree.scenario}) via theirs`,
    }),
      "merged" as const);
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Best-effort worktree removal that handles permission and lock issues.
 * 1. Remove stale lock files inside the worktree and .git/worktrees/ entry.
 * 2. Unlock the worktree (git worktree unlock).
 * 3. Try `git worktree remove --force`.
 * 4. Fall back to manual directory removal + `git worktree prune`.
 */
const forceRemoveWorktree = async (
  path: string,
  log: Logger,
): Promise<boolean> => {
  // Remove index.lock inside the worktree itself
  await Deno.remove(`${path}/.git/index.lock`).catch(() => {});
  await Deno.remove(`${path}/index.lock`).catch(() => {});

  // Find and unlock the corresponding .git/worktrees/ entry
  const gitDirResult = await run(["rev-parse", "--git-dir"]);
  if (gitDirResult.code === 0) {
    const gitDir = gitDirResult.stdout;
    try {
      for await (const entry of Deno.readDir(`${gitDir}/worktrees`)) {
        if (!entry.isDirectory) continue;
        const wtGitDir = `${gitDir}/worktrees/${entry.name}`;
        try {
          const gitdirContent = await Deno.readTextFile(
            `${wtGitDir}/gitdir`,
          );
          if (gitdirContent.trim().startsWith(path)) {
            await Deno.remove(`${wtGitDir}/locked`).catch(() => {});
            await Deno.remove(`${wtGitDir}/index.lock`).catch(() => {});
          }
        } catch {
          // gitdir file missing or unreadable
        }
      }
    } catch {
      // worktrees dir missing
    }
  }

  // Attempt unlock (may fail if not locked — that's fine)
  await run(["worktree", "unlock", path]);

  // Try the normal git removal
  const removeResult = await run(["worktree", "remove", "--force", path]);
  if (removeResult.code === 0) return true;

  log({
    tags: ["debug", "worktree"],
    message:
      `git worktree remove --force failed for ${path}: ${removeResult.stderr}, falling back to manual removal`,
  });

  // Manual fallback: delete the directory and prune git's internal refs
  try {
    await Deno.remove(path, { recursive: true });
  } catch {
    // Directory may already be gone
  }
  await run(["worktree", "prune"]);
  return true;
};

export const mergeWorktree = async (
  { worktree, log }: { worktree: WorktreeInfo; log: Logger },
): Promise<MergeResult> => {
  // Retry once after a short delay to handle transient git lock issues.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await run([
      "merge",
      worktree.branch,
      "--no-edit",
      "-m",
      `Merge ${worktree.branch} (scenario ${worktree.scenario})`,
    ]);

    if (result.code === 0) {
      log({
        tags: ["info", "worktree"],
        message: `Merged ${worktree.branch} (scenario ${worktree.scenario})`,
      });
      return "merged";
    }

    // If it looks like a transient lock error, retry after a brief delay.
    if (
      attempt === 0 &&
      (result.stderr.includes("index.lock") ||
        result.stderr.includes("Unable to create") ||
        result.stderr.includes("lock"))
    ) {
      log({
        tags: ["info", "worktree"],
        message:
          `Merge for ${worktree.scenario} hit transient lock, retrying in 1s`,
      });
      await delay(1000);
      continue;
    }

    // Real conflict — abort and try theirs strategy.
    log({
      tags: ["info", "worktree"],
      message:
        `Merge conflict for scenario ${worktree.scenario}, retrying with theirs strategy`,
    });
    await run(["merge", "--abort"]);
    return mergeWithTheirs({ worktree, log });
  }

  // Unreachable, but satisfies the type checker.
  await run(["merge", "--abort"]);
  return mergeWithTheirs({ worktree, log });
};

export const resetWorkingTree = async (
  { log }: { log: Logger },
): Promise<Result<void, string>> => {
  const result = await run(["checkout", "--", "."]);
  return result.code !== 0
    ? (log({
      tags: ["error", "worktree"],
      message: `Failed to reset working tree: ${result.stderr}`,
    }),
      err(`Failed to reset working tree: ${result.stderr}`))
    : (log({
      tags: ["debug", "worktree"],
      message: "Reset working tree (discarded uncommitted changes)",
    }),
      ok(undefined));
};

/**
 * Remove all ralph worker worktrees, prune git refs, delete ralph/worker-*
 * branches, and clear tool state files (escalation.json, loop-state.json).
 * Called on boot when --reset-worktrees is passed.
 */
export const resetAllWorktrees = async (
  { log }: { log: Logger },
): Promise<Result<void, string>> => {
  log({
    tags: ["info", "worktree"],
    message: "Resetting all ralph worktrees...",
  });

  // Remove each subdirectory in WORKTREE_BASE_DIR via robust removal
  try {
    for await (const entry of Deno.readDir(WORKTREE_BASE_DIR)) {
      if (!entry.isDirectory) continue;
      const path = `${WORKTREE_BASE_DIR}/${entry.name}`;
      await forceRemoveWorktree(path, log);
      log({
        tags: ["info", "worktree"],
        message: `Removed worktree at ${path}`,
      });
    }
  } catch {
    // WORKTREE_BASE_DIR does not exist — nothing to clean
  }

  // Delete local ralph/worker-* branches (in parallel — independent ops)
  const branchList = await run(["branch", "--list", "ralph/worker-*"]);
  if (branchList.code === 0 && branchList.stdout) {
    const branches = branchList.stdout.split("\n").map((b) => b.trim()).filter(
      Boolean,
    );
    await Promise.all(branches.map(async (branch) => {
      const delResult = await run(["branch", "-D", branch]);
      delResult.code !== 0 && log({
        tags: ["debug", "worktree"],
        message: `Failed to delete branch ${branch}: ${delResult.stderr}`,
      });
    }));
  }

  // Clear tool state files
  await Deno.remove(ESCALATION_FILE).catch(() => {});
  await Deno.remove(LOOP_STATE_FILE).catch(() => {});

  log({
    tags: ["info", "worktree"],
    message: "All ralph worktrees and state cleared.",
  });
  return ok(undefined);
};

/**
 * Prune orphaned `ralph/worker-*` branches that have no matching worktree.
 * Safe to run on every boot — only removes branches whose worktree is gone.
 */
export const pruneOrphanedBranches = async (
  { log }: { log: Logger },
): Promise<void> => {
  // Collect active worktree branch refs
  const wtList = await run(["worktree", "list", "--porcelain"]);
  const activeRefs = new Set<string>();
  if (wtList.code === 0) {
    for (const line of wtList.stdout.split("\n")) {
      if (line.startsWith("branch refs/heads/ralph/worker-")) {
        activeRefs.add(line.replace("branch refs/heads/", ""));
      }
    }
  }

  const branchList = await run(["branch", "--list", "ralph/worker-*"]);
  if (branchList.code !== 0 || !branchList.stdout) return;

  const branches = branchList.stdout.split("\n").map((b) => b.trim()).filter(
    Boolean,
  );
  const orphaned = branches.filter((b) => !activeRefs.has(b));
  if (orphaned.length === 0) return;

  log({
    tags: ["info", "worktree"],
    message: `Pruning ${orphaned.length} orphaned ralph branch(es)`,
  });
  await Promise.all(orphaned.map(async (branch) => {
    const delResult = await run(["branch", "-D", branch]);
    delResult.code !== 0 && log({
      tags: ["debug", "worktree"],
      message: `Failed to prune branch ${branch}: ${delResult.stderr}`,
    });
  }));
};

export const cleanupWorktree = async (
  { worktree, log }: { worktree: WorktreeInfo; log: Logger },
): Promise<Result<void, string>> => {
  await forceRemoveWorktree(worktree.path, log);

  const branchResult = await run(["branch", "-D", worktree.branch]);
  branchResult.code !== 0 && log({
    tags: ["debug", "worktree"],
    message:
      `Failed to delete branch ${worktree.branch}: ${branchResult.stderr}`,
  });

  return ok(undefined);
};
