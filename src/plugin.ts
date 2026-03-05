import type {
  Agent,
  CommandSpec,
  IterationResult,
  Logger,
  LoopState,
  ModelSelection,
  Result,
  ValidationResult,
} from "./types.ts";
import { err, ok } from "./types.ts";

/** Context passed to every {@link Plugin} hook during the loop. */
export type HookContext = {
  readonly agent: Agent;
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
 * const myPlugin: Plugin = {
 *   onModelSelected({ selection, ctx }) {
 *     ctx.log({ tags: ["info", "plugin"], message: `Using ${selection.model}` });
 *     return selection;
 *   },
 * };
 * export default myPlugin;
 * ```
 */
export type Plugin = {
  /** Override the resolved agent and iteration count before the loop starts. */
  onConfigResolved?: (opts: {
    agent: Agent;
    iterations: number;
    log: Logger;
  }) =>
    | { agent: Agent; iterations: number }
    | Promise<{ agent: Agent; iterations: number }>;

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

  /** Modify the CLI command before it is spawned. */
  onCommandBuilt?: (opts: {
    spec: CommandSpec;
    selection: ModelSelection;
    ctx: HookContext;
  }) => CommandSpec | Promise<CommandSpec>;

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

  /** Called once after the loop exits, regardless of outcome. */
  onLoopEnd?: (opts: {
    finalState: LoopState;
    totalIterations: number;
    log: Logger;
  }) => void | Promise<void>;
};

/** A plugin with no hooks defined. Used as the default when no plugin is loaded. */
export const noopPlugin: Plugin = {};

/**
 * Dynamically import a {@link Plugin} from a file path, URL, or package
 * specifier (`jsr:`, `npm:`). Returns {@link noopPlugin} if no path is given.
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
    const plugin: Plugin = mod.default ?? mod;
    log({
      tags: ["info", "plugin"],
      message: `Loaded plugin from ${pluginPath}`,
    });
    return ok(plugin);
  } catch (e) {
    return err(`Failed to load plugin from ${pluginPath}: ${e}`);
  }
};
