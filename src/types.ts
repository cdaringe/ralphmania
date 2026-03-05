export type Agent = (typeof VALID_AGENTS)[number];
export type LogLevel = "info" | "error" | "debug";
export type Logger = (
  opts: { tags: [LogLevel, ...string[]]; message: string },
) => void;
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export type ValidationResult =
  | { status: "passed" }
  | { status: "skip" }
  | { status: "failed"; outputPath: string };

export type ToolMode = "fast" | "general" | "strong";

export type ModelSelection = {
  readonly model: string;
  readonly mode: ToolMode;
  readonly targetScenario: number | undefined;
};

export type IterationResult =
  | { status: "complete" }
  | { status: "continue" }
  | { status: "failed"; code: number }
  | { status: "timeout" };

export type CommandSpec = {
  readonly command: string;
  readonly args: string[];
};

export type LoopState = {
  readonly validationFailurePath: string | undefined;
  readonly task: "build" | "produce_receipts" | "complete";
};

export const VALID_AGENTS = ["claude", "codex"] as const;
