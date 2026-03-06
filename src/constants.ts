export const TIMEOUT_MS = 60 * 60 * 1000;
export const REWORK_THRESHOLD = 1;
export const USAGE =
  "Usage: deno run ralph.mts --iterations <n> [--agent claude|codex] [--plugin <path>]";
export const COMPLETION_MARKER = "<promise>COMPLETE</promise>";
export const VALIDATE_SCRIPT = "specification.validate.sh";
export const VALIDATE_OUTPUT_DIR = ".ralph/validation";
export const VALIDATE_TEMPLATE = `#!/usr/bin/env bash
set -euo pipefail

# specification.validate.sh
# Validates that specification requirements are met.
# Fill in your validation logic below.
# Exit 0 on success, non-zero on failure.
# stdout/stderr will be captured and provided to the agent on failure.

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
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
  SSH_BATCH_MODE: "yes",
  DEBIAN_FRONTEND: "noninteractive",
  CI: "true",
};

/** Merge inherited environment with non-interactive overrides. */
export const nonInteractiveEnv = (): Record<string, string> => ({
  ...Deno.env.toObject(),
  ...NON_INTERACTIVE_ENV_OVERRIDES,
});

export const BASE_PROMPT = `@specification.md @progress.md
ONLY DO ONE TASK AT A TIME.

1. Read specification.md and progress.md files.
2. Find the next highest leverage uninmplemented scenario and implement it.
3. Document your scenario implementation in docs/scenarios/:name.md. Write maximally concise detail, justifying how the scenario is fully completed. Reference key details & files as evidence for a reviewer.
4. Commit your changes.
5. Update progress.md scenario table with status and add a filename pointing to docs/scenario/* summary. Do NOT fill in rework notes column--leave that for the reviewer.
6. If all scenarios are completed, revisit each claim ONE BY ONE in the progress
file CRITIQUE if the INTENT of the scenario is ACTUALLY COMPLETED. Run code, use browsers, and verify documentation to validate the scearnio.
  6.1 Review if the user's desires are met--not if the claimed tasks are completed.
  6.2 Every referenced document or module should be verified existing and up-to-date.
  6.3 Update status to VERIFIED or NEEDS_REWORK with rework notes as needed.

Once all claims are VERIFIED, output ${COMPLETION_MARKER}.`;
