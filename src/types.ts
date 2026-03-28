/** Supported AI agent backends. Derived from {@link VALID_AGENTS}. */
export type Agent = (typeof VALID_AGENTS)[number];

/** Severity levels for log output. */
export type LogLevel = "info" | "error" | "debug";

/** A structured logging function that accepts a severity tag and message. */
export type Logger = (
  opts: { tags: [LogLevel, ...string[]]; message: string },
) => void;

export { err, ok } from "neverthrow";
export type { Result } from "neverthrow";

/** Outcome of running the validation script after an iteration. */
export type ValidationResult =
  | { status: "passed" }
  | { status: "skip" }
  | { status: "failed"; outputPath: string };

/**
 * Model capability tier. `"fast"` uses the cheapest model, `"general"` is the
 * default, and `"strong"` escalates to the most capable model for rework.
 */
export type ToolMode = "fast" | "general" | "strong";

/** Claude Code effort level, passed via `CLAUDE_CODE_EFFORT_LEVEL` env var. */
export type EffortLevel = "low" | "medium" | "high";

/** Per-scenario escalation level (0–1) in the Claude ladder. */
export type EscalationLevel = 0 | 1;

/** Persistent escalation state: scenario number (as string) → level. */
export type EscalationState = Record<string, EscalationLevel>;

/**
 * The resolved model configuration for an iteration, including the concrete
 * model name, capability tier, an optional scenario to focus on, and an
 * optional effort level for Claude Code.
 */
export type ModelSelection = {
  readonly model: string;
  readonly mode: ToolMode;
  readonly targetScenario: string | undefined;
  readonly effort: EffortLevel | undefined;
  readonly actionableScenarios: readonly string[];
};

/** Outcome of a single agent iteration. */
export type IterationResult =
  | { status: "complete" }
  | { status: "continue" }
  | { status: "failed"; code: number }
  | { status: "timeout" };

/** A shell command with its arguments, ready to be spawned. */
export type CommandSpec = {
  readonly command: string;
  readonly args: string[];
};

/**
 * Tracks the current phase of the agentic loop. The task is either `"build"`
 * (running agent + validation) or `"complete"` (all scenarios verified).
 */
export type LoopState = {
  readonly validationFailurePath: string | undefined;
  readonly task: "build" | "complete";
};

/** The step within an iteration that was last checkpointed. */
export type LoopStep = "agent" | "validate" | "done";

/**
 * Persisted loop checkpoint written at each major step so the workstream can
 * be stopped and restarted at the exact point it was interrupted.
 *
 * - `"agent"`:    written before spawning worker agents for this iteration.
 * - `"validate"`: written after agents+merges complete, before validation.
 * - `"done"`:     written after validation; `iterationsUsed` is already
 *                 incremented so the next resume starts the following round.
 */
export type LoopCheckpoint = {
  readonly iterationsUsed: number;
  readonly step: LoopStep;
  readonly validationFailurePath: string | undefined;
};

/** The set of supported agent backend identifiers. */
export const VALID_AGENTS = ["claude", "codex"] as const;

/**
 * Subset of the Claude Agent SDK NDJSON streaming message types relevant
 * to output extraction when using `--output-format=stream-json`.
 *
 * @see {@link https://platform.claude.com/docs/en/agent-sdk/typescript#message-types}
 */

/** Final result message emitted when the agent completes or errors. */
export type SDKResultMessage =
  | {
    type: "result";
    subtype: "success";
    result: string;
    is_error: boolean;
    duration_ms: number;
    num_turns: number;
    total_cost_usd: number;
  }
  | {
    type: "result";
    subtype:
      | "error_max_turns"
      | "error_during_execution"
      | "error_max_budget_usd";
    is_error: boolean;
    errors: string[];
  };

/** System-level events (init, status, hooks, tasks, etc.). */
export type SDKSystemMessage = {
  type: "system";
  subtype: string;
  session_id: string;
};

/**
 * A content block inside an Anthropic API message.
 * @see {@link https://docs.anthropic.com/en/api/messages}
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "thinking"; thinking: string };

/** Assistant turn with a full Anthropic API message payload. */
export type SDKAssistantMessage = {
  type: "assistant";
  session_id: string;
  message: { content: ContentBlock[] };
};

/** Streaming partial events (only with --include-partial-messages). */
export type SDKPartialAssistantMessage = {
  type: "stream_event";
  event: unknown;
};

/** Tool use summary (e.g. "Read 3 files, ran 2 commands"). */
export type SDKToolUseSummaryMessage = {
  type: "tool_use_summary";
  summary: string;
};

/**
 * Discriminated union of NDJSON message types emitted by
 * `claude --output-format=stream-json`.
 *
 * @see {@link https://platform.claude.com/docs/en/agent-sdk/typescript#message-types}
 */
export type SDKMessage =
  | SDKResultMessage
  | SDKSystemMessage
  | SDKAssistantMessage
  | SDKPartialAssistantMessage
  | SDKToolUseSummaryMessage;

const SDK_MESSAGE_TYPES: ReadonlySet<string> = new Set<SDKMessage["type"]>([
  "result",
  "system",
  "assistant",
  "stream_event",
  "tool_use_summary",
]);

/** Narrows parsed JSON to a known SDK streaming message. */
export const isSDKMessage = (v: unknown): v is SDKMessage =>
  typeof v === "object" && v !== null &&
  SDK_MESSAGE_TYPES.has((v as { type: string }).type);

type TextBlock = Extract<ContentBlock, { type: "text" }>;

/**
 * Extract displayable text from a parsed SDK streaming message.
 * Biases towards showing MORE output so the user sees activity.
 *
 * @see {@link https://platform.claude.com/docs/en/agent-sdk/typescript#message-types}
 */
export const extractSDKText = (raw: unknown): string | undefined => {
  if (!isSDKMessage(raw)) return undefined;
  switch (raw.type) {
    case "assistant": {
      const parts = raw.message.content.flatMap((b): string[] => {
        switch (b.type) {
          case "text":
            return b.text ? [b.text] : [];
          case "tool_use":
            return [`[tool: ${b.name}]`];
          case "thinking":
            return b.thinking ? [b.thinking] : [];
        }
      });
      return parts.join("\n") || undefined;
    }
    case "result":
      return raw.subtype === "success"
        ? raw.result
        : `[${raw.subtype}] ${raw.errors.join(", ")}`;
    case "tool_use_summary":
      return raw.summary;
    case "system":
      return `[system: ${raw.subtype}]`;
    default:
      return undefined;
  }
};
