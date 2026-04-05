import type { Logger, ModelLadder } from "../types.ts";
import type { WorktreeInfo } from "./worktree.ts";
import { RECONCILE_TIMEOUT_MS } from "../constants.ts";
import { MERGE_LOG_ID, writeWorkerLine } from "../gui/log-dir.ts";

/** Extract file paths from `git status --porcelain` with unmerged markers. */
export const parseConflictedFiles = (porcelain: string): string[] =>
  porcelain
    .split("\n")
    .filter((line) => /^(UU|AA|DD|AU|UA|DU|UD)\s/.test(line))
    .map((line) => line.slice(3).trim());

/** Check whether the working tree still has unresolved merge conflicts. */
export const hasUnresolvedConflicts = async (
  run: ReconcileDeps["run"],
): Promise<boolean> => {
  const { stdout } = await run(["status", "--porcelain"]);
  return parseConflictedFiles(stdout).length > 0;
};

/** Build the prompt sent to the reconciliation agent. */
export const buildReconcilePrompt = (
  { worktree, conflictedFiles }: {
    worktree: WorktreeInfo;
    conflictedFiles: string[];
  },
): string =>
  `You are resolving merge conflicts for branch ${worktree.branch} (scenario ${worktree.scenario}).

The following files have unresolved conflict markers:
${conflictedFiles.map((f) => `- ${f}`).join("\n")}

Instructions:
1. Read each conflicted file listed above.
2. Resolve ALL conflict markers (<<<<<<<, =======, >>>>>>>) intelligently, preserving the intent of both sides.
3. After resolving each file, run \`git add <file>\` to stage it.
4. Once ALL conflicts are resolved and staged, run \`git commit --no-edit\` to complete the merge.

IMPORTANT:
- Do NOT abort the merge.
- Do NOT modify files that are not in the conflict list above.
- Do NOT run \`git merge --abort\`.
- Resolve every conflict — do not leave any conflict markers.`;

/** Build a broader prompt for when merge fails without conflict markers. */
export const buildMergeRetryPrompt = (
  { worktree }: { worktree: WorktreeInfo },
): string =>
  `You are merging branch ${worktree.branch} (scenario ${worktree.scenario}) into the current branch.

The previous merge attempt failed without leaving standard conflict markers.
This may be due to tree conflicts, rename/delete conflicts, or other non-textual issues.

Instructions:
1. Run \`git status\` to understand the current working tree state.
2. Run \`git merge ${worktree.branch} --no-edit\` to attempt the merge.
3. Inspect any errors or issues that arise.
4. Resolve ALL issues — file additions, deletions, renames, content conflicts — whatever is needed.
5. Stage all resolved files with \`git add\`.
6. Complete the merge with \`git commit --no-edit\`.

IMPORTANT:
- Do NOT give up. The merge MUST be completed.
- Do NOT run \`git merge --abort\`.
- Ensure the final result is a committed merge.`;

export type ReconcileDeps = {
  run: (
    args: string[],
    opts?: { cwd?: string },
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  spawnAgent: (opts: {
    ladder: ModelLadder;
    prompt: string;
    signal: AbortSignal;
    log: Logger;
    cwd?: string;
  }) => Promise<{ code: number }>;
};

/* c8 ignore start -- real git/agent subprocess wiring */
const defaultRun: ReconcileDeps["run"] = async (args, opts) => {
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

const defaultSpawnAgent: ReconcileDeps["spawnAgent"] = async (
  { ladder, prompt, signal: _signal, log, cwd },
) => {
  const config = ladder.coder;

  log({
    tags: ["info", "reconcile"],
    message:
      `Spawning ${config.provider}/${config.model} for conflict resolution`,
  });

  try {
    const { createAgentSession } = await import(
      "@mariozechner/pi-coding-agent"
    );
    const { resolveModel } = await import("../resolve-model.ts");
    const model = await resolveModel(config.provider, config.model);
    const { session } = await createAgentSession({
      model,
      cwd: cwd ?? Deno.cwd(),
      ...(config.thinkingLevel ? { thinkingLevel: config.thinkingLevel } : {}),
    });

    const enc = new TextEncoder();
    const mergeOnLine = (line: string): void => {
      writeWorkerLine(MERGE_LOG_ID, {
        type: "log",
        level: "info",
        tags: ["info", "reconcile", "agent-stream"],
        message: line,
        ts: Date.now(),
        workerId: MERGE_LOG_ID,
      });
    };

    session.subscribe(
      // deno-lint-ignore no-explicit-any
      (event: any) => {
        const text = event.type === "message_update" &&
            event.assistantMessageEvent?.type === "text_delta"
          ? event.assistantMessageEvent.delta
          : undefined;
        if (text) {
          Deno.stdout.writeSync(enc.encode(text + "\n"));
          mergeOnLine(text);
        }
      },
    );

    await session.prompt(prompt);
    return { code: 0 };
  } catch (error) {
    log({
      tags: ["error", "reconcile"],
      message: `Agent session failed: ${error}`,
    });
    return { code: 1 };
  }
};
/* c8 ignore stop */

/**
 * Reconcile a merge conflict by looping an agent until resolution.
 * Never aborts -- loops until the merge succeeds or the signal fires.
 */
export const reconcileMerge = async (
  { worktree, ladder, signal, log, deps }: {
    worktree: WorktreeInfo;
    ladder: ModelLadder;
    signal: AbortSignal;
    log: Logger;
    deps?: Partial<ReconcileDeps>;
  },
): Promise<void> => {
  const run = deps?.run ?? defaultRun;
  const spawnAgent = deps?.spawnAgent ?? defaultSpawnAgent;
  let attempt = 0;

  while (!signal.aborted) {
    attempt++;
    log({
      tags: ["info", "reconcile"],
      message:
        `Reconciliation attempt ${attempt} for ${worktree.branch} (scenario ${worktree.scenario})`,
    });

    // Attempt the merge (leaves conflict markers in working tree on failure)
    const mergeResult = await run([
      "merge",
      worktree.branch,
      "--no-edit",
      "-m",
      `Merge ${worktree.branch} (scenario ${worktree.scenario}, reconciled)`,
    ]);

    // Clean merge -- done
    if (mergeResult.code === 0) {
      return void log({
        tags: ["info", "reconcile"],
        message:
          `Merge succeeded on attempt ${attempt} for scenario ${worktree.scenario}`,
      });
    }

    // Parse conflicted files
    const statusResult = await run(["status", "--porcelain"]);
    const conflictedFiles = parseConflictedFiles(statusResult.stdout);

    if (conflictedFiles.length === 0) {
      // Merge failed but no conflict markers -- abort and let agent handle it
      log({
        tags: ["info", "reconcile"],
        message:
          `Merge exited non-zero but no conflicts found for scenario ${worktree.scenario}, spawning agent to resolve`,
      });
      await run(["merge", "--abort"]);

      await spawnAgent({
        ladder,
        prompt: buildMergeRetryPrompt({ worktree }),
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(RECONCILE_TIMEOUT_MS),
        ]),
        log,
      });

      // Check if agent completed the merge (HEAD should have advanced)
      const logResult = await run(["log", "-1", "--pretty=%s"]);
      if (logResult.stdout.includes(worktree.branch)) {
        return void log({
          tags: ["info", "reconcile"],
          message:
            `Agent completed merge on attempt ${attempt} for scenario ${worktree.scenario}`,
        });
      }

      // Agent didn't land the merge -- loop and retry
      log({
        tags: ["info", "reconcile"],
        message: `Agent did not complete merge on attempt ${attempt}, retrying`,
      });
      continue;
    }

    log({
      tags: ["info", "reconcile"],
      message: `${conflictedFiles.length} conflicted file(s): ${
        conflictedFiles.join(", ")
      }`,
    });

    // Spawn agent to resolve conflicts
    await spawnAgent({
      ladder,
      prompt: buildReconcilePrompt({ worktree, conflictedFiles }),
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(RECONCILE_TIMEOUT_MS),
      ]),
      log,
    });

    // Agent resolved everything -- done
    if (!(await hasUnresolvedConflicts(run))) {
      return void log({
        tags: ["info", "reconcile"],
        message:
          `Agent resolved conflicts on attempt ${attempt} for scenario ${worktree.scenario}`,
      });
    }

    // Still conflicted -- abort this merge and retry
    log({
      tags: ["info", "reconcile"],
      message:
        `Conflicts remain after attempt ${attempt}, aborting merge and retrying`,
    });
    await run(["merge", "--abort"]);
  }

  signal.throwIfAborted();
};
