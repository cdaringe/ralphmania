/** Severity levels for log output. */
export type LogLevel = "info" | "error" | "debug";

/** A structured logging function that accepts a severity tag and message. */
export type Logger = (
  opts: { tags: [LogLevel, ...string[]]; message: string },
) => void;

export { err, ok } from "neverthrow";
export type { Result } from "neverthrow";

import type { KnownProvider as _KnownProvider } from "@mariozechner/pi-ai";
export type KnownProvider = _KnownProvider;

/** Outcome of running the validation script after an iteration. */
export type ValidationResult =
  | { status: "passed" }
  | { status: "skip" }
  | { status: "failed"; outputPath: string };

/**
 * Model role within the escalation ladder. `"coder"` builds features,
 * `"verifier"` confirms completion, and `"escalated"` handles rework.
 */
export type ToolMode = "coder" | "verifier" | "escalated";

/** Pi-mono thinking level, controlling model reasoning depth. */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";

/** Per-scenario escalation level (0-1) in the model ladder. */
export type EscalationLevel = 0 | 1;

/** Persistent escalation state: scenario number (as string) -> level. */
export type EscalationState = Record<string, EscalationLevel>;

/** Provider + model pair identifying a specific LLM configuration. */
export type ModelRoleConfig = {
  readonly provider: KnownProvider;
  readonly model: string;
  readonly thinkingLevel?: ThinkingLevel;
};

/**
 * Three-role model ladder. Each role maps to a provider/model/thinking
 * combination. Configurable via CLI (`--coder`, `--verifier`, `--escalated`)
 * or the plugin `onConfigResolved` hook.
 */
export type ModelLadder = {
  readonly coder: ModelRoleConfig;
  readonly verifier: ModelRoleConfig;
  readonly escalated: ModelRoleConfig;
};

/**
 * Resolved model configuration for an iteration, including the concrete
 * provider, model name, role, optional scenario focus, and thinking level.
 */
export type ModelSelection = {
  readonly provider: KnownProvider;
  readonly model: string;
  readonly mode: ToolMode;
  readonly targetScenario: string | undefined;
  readonly thinkingLevel: ThinkingLevel | undefined;
  readonly actionableScenarios: readonly string[];
};

/** Outcome of a single agent iteration. */
export type IterationResult =
  | { status: "complete" }
  | { status: "continue" }
  | { status: "failed"; code: number }
  | { status: "timeout" };

/**
 * Compatibility overrides for OpenAI-compatible endpoints that don't
 * fully implement the OpenAI API.
 *
 * Most local servers (ollama, llama.cpp, vLLM) need at minimum
 * `supportsDeveloperRole: false` because they don't recognize the
 * `developer` message role that pi-coding-agent sends by default.
 * Without this, the server may reject the request or silently drop
 * system instructions.
 *
 * See {@link https://platform.openai.com/docs/guides/text?api-mode=chat#developer-messages | OpenAI developer messages}
 * for the upstream spec, and {@link https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md | pi-mono models.md}
 * for the full compat reference.
 *
 * Re-exported from `@mariozechner/pi-ai` — see `OpenAICompletionsCompat`.
 */
export type { OpenAICompletionsCompat } from "@mariozechner/pi-ai";

/**
 * Sensible compat defaults for local/self-hosted models.
 * Most don't support developer role, store, reasoning effort, or
 * streaming usage.
 */
export const LOCAL_MODEL_COMPAT_DEFAULTS:
  import("@mariozechner/pi-ai").OpenAICompletionsCompat = {
    supportsDeveloperRole: false,
    supportsStore: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: false,
    maxTokensField: "max_tokens",
  };

/**
 * Descriptor for a model hosted outside the pi-ai registry.
 *
 * - `"ollama"`: queries the ollama `/api/show` endpoint to discover
 *   context window, input modalities, etc. Talks to ollama's
 *   OpenAI-compatible `/v1` endpoint for inference.
 * - `"openai-compatible"`: generic OpenAI-completions endpoint (e.g.
 *   llama.cpp, vLLM, LM Studio). You must provide `contextWindow`.
 *
 * Both kinds default to `LOCAL_MODEL_COMPAT_DEFAULTS` (which disables
 * `developer` role, `store`, `reasoning_effort`, etc.). Override via
 * `compat` if your server supports more.
 */
export type CustomModelConfig =
  | {
    readonly kind: "ollama";
    /** Ollama base URL (default `http://localhost:11434`). */
    readonly baseUrl?: string;
    /** Model name as known to ollama, e.g. `"gemma4:e2b"`. */
    readonly model: string;
    /** Override OpenAI compatibility flags. Defaults to {@link LOCAL_MODEL_COMPAT_DEFAULTS}. */
    readonly compat?: import("@mariozechner/pi-ai").OpenAICompletionsCompat;
  }
  | {
    readonly kind: "openai-compatible";
    /** Base URL for the OpenAI-compatible `/v1` endpoint. */
    readonly baseUrl: string;
    /** Model identifier passed in API requests. */
    readonly model: string;
    /** Context window size in tokens (required — no discovery API). */
    readonly contextWindow: number;
    /** Override OpenAI compatibility flags. Defaults to {@link LOCAL_MODEL_COMPAT_DEFAULTS}. */
    readonly compat?: import("@mariozechner/pi-ai").OpenAICompletionsCompat;
  };

/**
 * Configuration for a pi-mono agent session. Passed through the
 * `onSessionConfigBuilt` plugin hook before execution.
 */
export type AgentSessionConfig = {
  readonly provider: KnownProvider;
  readonly model: string;
  readonly workingDir: string;
  readonly thinkingLevel?: ThinkingLevel;
  /**
   * When set, bypasses the pi-ai model registry and constructs the
   * `Model` object from the provided config. Use this for local or
   * self-hosted models not in the registry.
   */
  readonly customModel?: CustomModelConfig;
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
export type LoopStep = "agent" | "validate" | "rectify" | "done";

/**
 * Action returned by the plugin onRectify hook to control how rectification
 * proceeds after a validation failure.
 */
export type RectifyAction =
  | { action: "agent"; promptOverride?: string }
  | { action: "skip" }
  | { action: "abort"; reason: string };

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

/** Delivery mode for interactive input to a running agent session. */
export type InputMode = "steer" | "followUp";
