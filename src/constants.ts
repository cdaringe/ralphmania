import { tmpdir } from "node:os";
import type {
  KnownProvider,
  ModelLadder,
  ModelRoleConfig,
  Result,
} from "./types.ts";
import { err, ok } from "./types.ts";

/**
 * Set of provider names recognised by the pi-ai model registry.
 * Used to validate user-supplied model specs at parse time.
 *
 * Typed as `ReadonlySet<KnownProvider>` so the compiler enforces that
 * every entry is a member of pi-ai's provider union.
 */
const _KNOWN_PROVIDERS: readonly KnownProvider[] = [
  "amazon-bedrock",
  "anthropic",
  "azure-openai-responses",
  "cerebras",
  "github-copilot",
  "google",
  "google-antigravity",
  "google-gemini-cli",
  "google-vertex",
  "groq",
  "huggingface",
  "kimi-coding",
  "minimax",
  "minimax-cn",
  "mistral",
  "openai",
  "openai-codex",
  "opencode",
  "opencode-go",
  "openrouter",
  "vercel-ai-gateway",
  "xai",
  "zai",
] as const;
export const KNOWN_PROVIDERS: ReadonlySet<string> = new Set(_KNOWN_PROVIDERS);

export const TIMEOUT_MS = 60 * 60 * 1000;
export const WORKER_IDLE_TIMEOUT_MS = 90 * 1000;
/** Hard timeout for the validation script (10 minutes). */
export const VALIDATION_TIMEOUT_MS = 10 * 60 * 1000;
export const ESCALATION_FILE = ".ralph/escalation.json";
export const LOOP_STATE_FILE = ".ralph/loop-state.json";

/** Default model ladder: Anthropic Claude models with role-appropriate thinking. */
export const DEFAULT_MODEL_LADDER: ModelLadder = {
  coder: {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250514",
    thinkingLevel: "high",
  },
  verifier: {
    provider: "anthropic",
    model: "claude-opus-4-5-20250514",
    thinkingLevel: "low",
  },
  escalated: {
    provider: "anthropic",
    model: "claude-opus-4-5-20250514",
    thinkingLevel: "high",
  },
} as const;

/**
 * Parse a model spec string into a ModelRoleConfig.
 * Accepts either "provider/model" or "provider:model", with only the first
 * delimiter splitting provider from model so model names may contain ":".
 * Validates the provider against the set of known providers.
 */
export const parseModelSpec = (
  spec: string,
): Result<ModelRoleConfig, string> => {
  const slashIdx = spec.indexOf("/");
  const colonIdx = spec.indexOf(":");
  const idx = slashIdx >= 1 ? slashIdx : colonIdx >= 1 ? colonIdx : -1;
  if (idx < 1) {
    return err(
      `Invalid model spec "${spec}": expected "provider/model" or "provider:model" format (e.g., "anthropic/claude-sonnet-4-5-20250514")`,
    );
  }
  const provider = spec.slice(0, idx);
  const model = spec.slice(idx + 1);
  if (!KNOWN_PROVIDERS.has(provider)) {
    return err(
      `Unknown provider "${provider}" in model spec "${spec}". ` +
        `Known providers: [${[...KNOWN_PROVIDERS].sort().join(", ")}].`,
    );
  }
  return ok({ provider: provider as KnownProvider, model });
};

/** Format a ModelRoleConfig as "provider/model" for display. */
export const formatModelSpec = (config: ModelRoleConfig): string =>
  `${config.provider}/${config.model}`;

/**
 * The only statuses allowed in the progress.md Status column.
 * Any other value is treated as invalid and must be corrected.
 */
export const Status = {
  WIP: "WIP",
  WORK_COMPLETE: "WORK_COMPLETE",
  VERIFIED: "VERIFIED",
  NEEDS_REWORK: "NEEDS_REWORK",
  OBSOLETE: "OBSOLETE",
} as const;

export const VALID_STATUSES = Object.values(Status);

export type ScenarioStatus = (typeof VALID_STATUSES)[number];

export const WORKTREE_BASE_DIR = `${tmpdir()}/ralph-worktrees${
  Deno.cwd().replaceAll("/", "_")
}`;
export const RECONCILE_TIMEOUT_MS = 10 * 60 * 1000;

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
 * gpg, sudo) bypass stdin:"null" -- these env vars cause them to fail fast
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

export const AUTONOMOUS_PROMPT = `
1. Read {SPEC_FILE} & {PROGRESS_FILE} files. Read .ralph/repo_map.md if it exists.
2. Find the next NEEDS_REWORK scenario. If none, find the highest leverage unimplemented scenario. Implement & add tests.
   2.1. Document your scenario implementation in docs/scenarios/:name.md. Write maximally concise detail, justifying how the scenario is fully completed. Reference key details as evidence for a reviewer.
   2.2. Commit.
   2.3. Update progress.md table with status and filename pointing to docs/scenario/* summary. Do NOT fill in rework notes column--leave that for the reviewer.
3. If all scenarios are VERIFIED output ${COMPLETION_MARKER} then exit. Otherwise, find the first complete & non-VERIFIED scenario in the progress.md & CRITIQUE if the intent of the scenario is actually completed.
  3.1. Ensure e2e & integration tests are present for the scenario.
  3.2. All referenced documents & modules should be verified existing and up-to-date.
  3.3. Assess if the user's scenario outcomes met--not just if the prior agent's tasks are completed.
  3.4. Update {PROGRESS_FILE} status to VERIFIED or NEEDS_REWORK. If NEEDS_REWORK, add rework notes to the notes cell, otherwise clear it.
4. Update repo_map.md with any new design or ops info. Keep it maximally concise and link out to other .ralph/*.md documents to help subsequent agent runs re contextualize efficiently.
`.trim();

export const buildTargetedPrompt = (scenario: string): string =>
  `
1. Read {SPEC_FILE} & {PROGRESS_FILE} files. Read .ralph/repo_map.md if it exists.
2. Implement scenario ${scenario}. Do NOT work on any other scenario. Add tests.
   2.1. Document your scenario implementation in docs/scenarios/:name.md. Write maximally concise detail, justifying how the scenario is fully completed. Reference key details as evidence for a reviewer.
   2.2. Commit.
   2.3. Update progress.md table with status and filename pointing to docs/scenario/* summary. Do NOT fill in rework notes column--leave that for the reviewer.
3. CRITIQUE scenario ${scenario}: verify the intent of the scenario is actually completed.
  3.1. Ensure e2e & integration tests are present for the scenario.
  3.2. All referenced documents & modules should be verified existing and up-to-date.
  3.3. Assess if the user's scenario outcomes met--not just if the prior agent's tasks are completed.
  3.4. Update {PROGRESS_FILE} status to VERIFIED or NEEDS_REWORK. If NEEDS_REWORK, add rework notes to the notes cell, otherwise clear it.
4. Update repo_map.md with any new design or ops info. Keep it maximally concise and link out to other .ralph/*.md documents to help subsequent agent runs re contextualize efficiently.
`.trim();

export const formatDuration = (ms: number): string => {
  if (ms % (60 * 1000) === 0) {
    const minutes = ms / (60 * 1000);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  if (ms % 1000 === 0) {
    const seconds = ms / 1000;
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  return `${ms} ms`;
};
