import type { Agent, Logger } from "./types.ts";
import type { WorktreeInfo } from "./worktree.ts";
import { nonInteractiveEnv, RECONCILE_TIMEOUT_MS } from "./constants.ts";
import { getModel } from "./model.ts";
import { buildCommandSpec } from "./command.ts";
import { ndjsonResultTransform, pipeStream } from "./runner.ts";

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

export type ReconcileDeps = {
  run: (
    args: string[],
    opts?: { cwd?: string },
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  spawnAgent: (opts: {
    agent: Agent;
    prompt: string;
    signal: AbortSignal;
    log: Logger;
    cwd?: string;
  }) => Promise<{ code: number }>;
};

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
  { agent, prompt, signal, log, cwd },
) => {
  const model = getModel({ agent, mode: "general" });
  const spec = buildCommandSpec({ agent, model, prompt });

  log({
    tags: ["info", "reconcile"],
    message: `Spawning ${agent} (${model}) for conflict resolution`,
  });

  const child = new Deno.Command(spec.command, {
    args: spec.args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    cwd,
    env: nonInteractiveEnv(),
    signal,
  }).spawn();

  const stdoutStream = agent === "claude"
    ? child.stdout.pipeThrough(ndjsonResultTransform())
    : child.stdout;

  const [status] = await Promise.all([
    child.status,
    pipeStream({ stream: stdoutStream, output: Deno.stdout }),
    pipeStream({ stream: child.stderr, output: Deno.stderr }),
  ]);

  return { code: status.code };
};

/**
 * Reconcile a merge conflict by looping an agent until resolution.
 * Never aborts — loops until the merge succeeds or the signal fires.
 */
export const reconcileMerge = async (
  { worktree, agent, signal, log, deps }: {
    worktree: WorktreeInfo;
    agent: Agent;
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

    if (mergeResult.code === 0) {
      log({
        tags: ["info", "reconcile"],
        message:
          `Merge succeeded on attempt ${attempt} for scenario ${worktree.scenario}`,
      });
      return;
    }

    // Parse conflicted files
    const statusResult = await run(["status", "--porcelain"]);
    const conflictedFiles = parseConflictedFiles(statusResult.stdout);

    if (conflictedFiles.length === 0) {
      // Merge failed but no conflicts detected — unexpected state, commit what we have
      log({
        tags: ["info", "reconcile"],
        message:
          `Merge exited non-zero but no conflicts found for scenario ${worktree.scenario}, completing`,
      });
      return;
    }

    log({
      tags: ["info", "reconcile"],
      message:
        `${conflictedFiles.length} conflicted file(s): ${conflictedFiles.join(", ")}`,
    });

    // Build prompt and spawn agent to resolve
    const prompt = buildReconcilePrompt({ worktree, conflictedFiles });
    const combinedSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(RECONCILE_TIMEOUT_MS),
    ]);

    await spawnAgent({
      agent,
      prompt,
      signal: combinedSignal,
      log,
    });

    // Check if agent resolved everything
    const stillConflicted = await hasUnresolvedConflicts(run);

    if (!stillConflicted) {
      log({
        tags: ["info", "reconcile"],
        message:
          `Agent resolved conflicts on attempt ${attempt} for scenario ${worktree.scenario}`,
      });
      return;
    }

    // Still conflicted — abort this merge and retry
    log({
      tags: ["info", "reconcile"],
      message:
        `Conflicts remain after attempt ${attempt}, aborting merge and retrying`,
    });
    await run(["merge", "--abort"]);
  }

  signal.throwIfAborted();
};
