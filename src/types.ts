/** Supported AI agent backends. Derived from {@link VALID_AGENTS}. */
export type Agent = (typeof VALID_AGENTS)[number];

/** Severity levels for log output. */
export type LogLevel = "info" | "error" | "debug";

/** A structured logging function that accepts a severity tag and message. */
export type Logger = (
  opts: { tags: [LogLevel, ...string[]]; message: string },
) => void;

/**
 * A discriminated union representing success or failure.
 *
 * @example
 * ```ts
 * import { ok, err, type Result } from "@cdaringe/ralphmania";
 *
 * const divide = (a: number, b: number): Result<number, string> =>
 *   b === 0 ? err("division by zero") : ok(a / b);
 * ```
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Construct a success {@link Result}. */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/** Construct a failure {@link Result}. */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

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

/**
 * The resolved model configuration for an iteration, including the concrete
 * model name, capability tier, and an optional scenario to focus on.
 */
export type ModelSelection = {
  readonly model: string;
  readonly mode: ToolMode;
  readonly targetScenario: number | undefined;
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
 * Tracks the current phase of the agentic loop. The task progresses from
 * `"build"` to `"produce_receipts"` to `"complete"`.
 */
export type LoopState = {
  readonly validationFailurePath: string | undefined;
  readonly task: "build" | "produce_receipts" | "complete";
};

/** The set of supported agent backend identifiers. */
export const VALID_AGENTS = ["claude", "codex"] as const;
