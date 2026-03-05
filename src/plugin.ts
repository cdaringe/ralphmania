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

export type HookContext = {
  readonly agent: Agent;
  readonly log: Logger;
  readonly iterationNum: number;
};

export type Plugin = {
  onConfigResolved?: (opts: {
    agent: Agent;
    iterations: number;
    log: Logger;
  }) =>
    | { agent: Agent; iterations: number }
    | Promise<{ agent: Agent; iterations: number }>;

  onModelSelected?: (opts: {
    selection: ModelSelection;
    ctx: HookContext;
  }) => ModelSelection | Promise<ModelSelection>;

  onPromptBuilt?: (opts: {
    prompt: string;
    selection: ModelSelection;
    ctx: HookContext;
  }) => string | Promise<string>;

  onCommandBuilt?: (opts: {
    spec: CommandSpec;
    selection: ModelSelection;
    ctx: HookContext;
  }) => CommandSpec | Promise<CommandSpec>;

  onIterationEnd?: (opts: {
    result: IterationResult;
    ctx: HookContext;
  }) => void | Promise<void>;

  onValidationComplete?: (opts: {
    result: ValidationResult;
    ctx: HookContext;
  }) => ValidationResult | Promise<ValidationResult>;

  onLoopEnd?: (opts: {
    finalState: LoopState;
    totalIterations: number;
    log: Logger;
  }) => void | Promise<void>;
};

export const noopPlugin: Plugin = {};

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
