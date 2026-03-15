export const TIMEOUT_MS = 60 * 60 * 1000;
export const REWORK_THRESHOLD = 1;
export const ESCALATION_FILE = ".ralph/escalation.json";
export const LOOP_STATE_FILE = ".ralph/loop-state.json";

/** Coder config: unimplemented scenarios remain. */
export const CLAUDE_CODER = {
  model: "sonnet",
  mode: "general",
  effort: "high",
} as const;
/** Verifier config: all scenarios implemented, verifying. */
export const CLAUDE_VERIFIER = {
  model: "opus",
  mode: "general",
  effort: "low",
} as const;
/** Escalated config: NEEDS_REWORK present. */
export const CLAUDE_ESCALATED = {
  model: "opus",
  mode: "strong",
  effort: "high",
} as const;

export const WORKTREE_BASE_DIR = ".ralph/worktrees";
export const RECONCILE_TIMEOUT_MS = 10 * 60 * 1000;

export const USAGE =
  `Usage: deno run mod.ts --iterations <n> [--agent claude|codex] [--plugin <path>] [--level 0-1] [--parallel <n>]

Options:
  -i, --iterations <n>       Number of agentic loop iterations (required)
  -a, --agent <name>         Agent backend: claude (default) or codex
  -p, --plugin <path>        Path to a plugin module
  -l, --level <0-1>          Starting escalation level for the Claude model ladder
                             (0=coder/verifier, 1=escalated)
  -P, --parallel <n>         Number of parallel workers (default: 1)`;
export const COMPLETION_MARKER = "<promise>COMPLETE</promise>";
export const VALIDATE_SCRIPT = "specification.validate.sh";
export const VALIDATE_OUTPUT_DIR = ".ralph/validation";
/**
 * Environment variable injected into the validation script pointing to a
 * temporary file. If the script writes anything to this file, its contents
 * are used as the validation output instead of the stdio capture.
 */
export const RALPH_OUTPUT_FILE_VAR = "RALPH_OUTPUT_FILE";

export const VALIDATE_TEMPLATE = `#!/usr/bin/env bash
set -euo pipefail

# specification.validate.sh
# Validates that specification requirements are met.
# Fill in your validation logic below.
# Exit 0 on success, non-zero on failure.
# stdout/stderr will be captured and provided to the agent on failure.
#
# Tip: write to \$RALPH_OUTPUT_FILE to override the default stdio capture.

echo "TODO: implement validation checks"
exit 1
`;

export const RALPH_RECEIPTS_DIRNAME = ".ralph/receipts";

/**
 * Environment variable overrides that suppress interactive password/passphrase
 * prompts from common tools. Programs that open `/dev/tty` directly (git, ssh,
 * gpg, sudo) bypass stdin:"null" — these env vars cause them to fail fast
 * instead of hanging.
 *
 * Use {@link nonInteractiveEnv} to merge these with the inherited environment.
 */
export const NON_INTERACTIVE_ENV_OVERRIDES: Record<string, string> = {
  CI: "true",
  DEBIAN_FRONTEND: "noninteractive",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
  GIT_TERMINAL_PROMPT: "0",
  NO_COLOR: "1",
  SSH_BATCH_MODE: "yes",
  TERM: "dumb",
};

/** Merge inherited environment with non-interactive overrides. */
export const nonInteractiveEnv = (): Record<string, string> => ({
  ...Deno.env.toObject(),
  ...NON_INTERACTIVE_ENV_OVERRIDES,
});

export const BASE_PROMPT = `
1. Read @specification.md & @progress.md files. Read .ralph/repo_map.md if it exists.
2. Find the next NEEDS_REWORK scenario. If none, find the highest leverage uninmplemented scenario. Implement & add tests.
   2.1. Document your scenario implementation in docs/scenarios/:name.md. Write maximally concise detail, justifying how the scenario is fully completed. Reference key details as evidence for a reviewer.
   2.2. Commit.
   2.3. Update progress.md table with status and filename pointing to docs/scenario/* summary. Do NOT fill in rework notes column--leave that for the reviewer.
3. If all all scearios are VERIFIED output ${COMPLETION_MARKER} the exit. Otherwise, find the first complete & non-VERIFIED scenario in the progress.md & CRITIQUE if the intent of the scenario is actually completed.
  3.1. Ensure e2e & integration tests are present for the scenario.
  3.2. All referenced documents & modules should be verified existing and up-to-date.
  3.3. Assess if the user's scenario outcomes met--not just if the prior agent's tasks are completed.
  3.4. Update @progress.md status to VERIFIED or NEEDS_REWORK. If NEEDS_REWORK, add rework notes to the notes cell, otherwise clear it.
4. Update repo_map.md with any new design or ops info. Keep it maximally concise and link out to other .ralph/*.md documents to help subsequent agent runs re contextualize efficiently.
`.trim();
