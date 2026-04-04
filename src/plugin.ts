import type {
  AgentSessionConfig,
  EscalationLevel,
  IterationResult,
  Logger,
  ModelLadder,
  ModelSelection,
  RectifyAction,
  Result,
  ValidationResult,
} from "./types.ts";
import { err, ok } from "./types.ts";

import type { LoopState } from "./types.ts";

/** Context passed to every Plugin hook during the loop. */
export type HookContext = {
  readonly ladder: ModelLadder;
  readonly log: Logger;
  readonly iterationNum: number;
};

/**
 * Interface for extending the ralphmania loop. Each optional hook fires at a
 * specific stage and can modify or observe the loop's behavior.
 *
 * @example
 * ```ts
 * import type { Plugin } from "@cdaringe/ralphmania";
 *
 * export const plugin: Plugin = {
 *   onModelSelected({ selection, ctx }) {
 *     ctx.log({ tags: ["info", "plugin"], message: `Using ${selection.model}` });
 *     return selection;
 *   },
 * };
 * ```
 */
export type Plugin = {
  /**
   * Override the resolved CLI configuration before the loop starts.
   * Every field in the return type is optional -- omitted fields keep
   * the CLI-resolved value.
   */
  onConfigResolved?: (opts: {
    ladder: ModelLadder;
    iterations: number;
    level: EscalationLevel | undefined;
    parallel: number;
    gui: boolean;
    guiPort: number;
    resetWorktrees: boolean;
    log: Logger;
  }) =>
    | {
      coder?: string;
      verifier?: string;
      escalated?: string;
      iterations?: number;
      level?: EscalationLevel;
      parallel?: number;
      gui?: boolean;
      guiPort?: number;
      resetWorktrees?: boolean;
      specFile?: string;
      progressFile?: string;
    }
    | Promise<{
      coder?: string;
      verifier?: string;
      escalated?: string;
      iterations?: number;
      level?: EscalationLevel;
      parallel?: number;
      gui?: boolean;
      guiPort?: number;
      resetWorktrees?: boolean;
      specFile?: string;
      progressFile?: string;
    }>;

  /** Override the model selection for the current iteration. */
  onModelSelected?: (opts: {
    selection: ModelSelection;
    ctx: HookContext;
  }) => ModelSelection | Promise<ModelSelection>;

  /** Modify the prompt before it is sent to the agent. */
  onPromptBuilt?: (opts: {
    prompt: string;
    selection: ModelSelection;
    ctx: HookContext;
  }) => string | Promise<string>;

  /** Modify the session config before the agent is spawned. */
  onSessionConfigBuilt?: (opts: {
    config: AgentSessionConfig;
    selection: ModelSelection;
    ctx: HookContext;
  }) => AgentSessionConfig | Promise<AgentSessionConfig>;

  /** Called after each agent iteration completes. */
  onIterationEnd?: (opts: {
    result: IterationResult;
    ctx: HookContext;
  }) => void | Promise<void>;

  /** Override validation results after the validation script runs. */
  onValidationComplete?: (opts: {
    result: ValidationResult;
    ctx: HookContext;
  }) => ValidationResult | Promise<ValidationResult>;

  /**
   * Called when validation fails post-merge, before spawning a rectification
   * agent on the merged main. Return `{ action: "agent" }` (default) to
   * proceed, `{ action: "skip" }` to fall back to the normal restart, or
   * `{ action: "abort", reason }` to stop the loop.
   */
  onRectify?: (opts: {
    validationFailurePath: string;
    iterationsUsed: number;
    ctx: HookContext;
  }) => RectifyAction | Promise<RectifyAction>;

  /** Called once after the loop exits, regardless of outcome. */
  onLoopEnd?: (opts: {
    finalState: LoopState;
    iterationNum: number;
    log: Logger;
  }) => void | Promise<void>;
};

/** A plugin with no hooks defined. Used as the default when no plugin is loaded. */
export const noopPlugin: Plugin = {};

/**
 * Resolve a Plugin from a dynamically imported module namespace.
 * Expects a named `plugin` export: `export const plugin: Plugin = { ... }`.
 */
export const resolvePlugin = (mod: Record<string, unknown>): Plugin =>
  typeof mod.plugin === "object" && mod.plugin !== null
    ? (mod.plugin as Plugin)
    : {};

/**
 * Dynamically import a Plugin from a file path, URL, or package
 * specifier (`jsr:`, `npm:`). Returns noopPlugin if no path is given.
 */
export const loadPlugin = async (
  { pluginPath, log }: { pluginPath: string | undefined; log: Logger },
): Promise<Result<Plugin, string>> => {
  if (!pluginPath) return ok(noopPlugin);
  try {
    const isUrl = pluginPath.startsWith("file://") ||
      pluginPath.startsWith("http://") ||
      pluginPath.startsWith("https://") ||
      pluginPath.startsWith("jsr:") ||
      pluginPath.startsWith("npm:");
    const specifier = isUrl
      ? pluginPath
      : new URL(pluginPath, `file://${Deno.cwd()}/`).href;
    const mod = await import(specifier);
    const plugin = resolvePlugin(mod);
    log({
      tags: ["info", "plugin"],
      message: `Loaded plugin from ${pluginPath}`,
    });
    return ok(plugin);
  } catch (e) {
    return err(`Failed to load plugin from ${pluginPath}: ${e}`);
  }
};
