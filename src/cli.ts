// coverage:ignore — CLI entry point with process-level orchestration and interactive prompts
import { Command, EnumType, ValidationError } from "@cliffy/command";
import {
  type Agent,
  err,
  type EscalationLevel,
  ok,
  type Result,
  VALID_AGENTS,
} from "./types.ts";
import { bold, cyan, dim, green, yellow } from "./colors.ts";

export type CliConfig = {
  agent: Agent;
  iterations: number;
  pluginPath: string | undefined;
  level: EscalationLevel | undefined;
  parallel: number;
};

const agentType = new EnumType(VALID_AGENTS);

const isAgent = (s: string): s is Agent => VALID_AGENTS.some((a) => a === s);

const validateLevel = (v: number): number => {
  if (v < 0 || v > 1) throw new ValidationError("level must be 0 or 1");
  return v;
};

/** Apply the shared run-command options to a Command. */
const withRunOptions = <T extends Command>(cmd: T) =>
  cmd
    .type("agent", agentType)
    .option(
      "-i, --iterations <count:integer>",
      "Number of agentic loop iterations.",
    )
    .option("-a, --agent <name:agent>", "Agent backend.", {
      default: "claude" as const,
    })
    .option("-p, --plugin <path:string>", "Path to a plugin module.")
    .option(
      "-l, --level <level:integer>",
      "Starting escalation level (0=coder/verifier, 1=escalated).",
      { value: validateLevel },
    )
    .option("-P, --parallel <count:integer>", "Number of parallel workers.", {
      default: 2,
    });

export type CliActions = {
  // deno-lint-ignore no-explicit-any
  onRun?: (...args: any[]) => void | Promise<void>;
  // deno-lint-ignore no-explicit-any
  onServeReceipts?: (...args: any[]) => void | Promise<void>;
};

/**
 * Build the CLI command tree. Version is injected to avoid circular imports.
 * Actions must be provided here because cliffy requires `.action()` before `.command()`.
 */
// deno-lint-ignore explicit-module-boundary-types
export const createCli = (version: string, actions: CliActions = {}) => {
  const runCmd = withRunOptions(
    new Command().description("Run the agentic loop (default command)."),
  );
  if (actions.onRun) runCmd.action(actions.onRun);

  const receiptsCmd = new Command()
    .description("Serve evidence receipts as a static HTTP site.")
    .option("-o, --open [open:boolean]", "Open in browser.", {
      default: false,
    })
    .option("--port <port:integer>", "Server port.", {
      default: 8421,
    });
  if (actions.onServeReceipts) receiptsCmd.action(actions.onServeReceipts);

  const root = withRunOptions(
    new Command()
      .name("ralphmania")
      .version(version)
      .description(
        "Run an AI agent in a loop until a specification is complete.",
      ),
  );
  if (actions.onRun) root.action(actions.onRun);

  return root
    .command("run", runCmd)
    .command(
      "serve",
      new Command()
        .description("Serve generated artifacts.")
        .command("receipts", receiptsCmd),
    );
};

// deno-lint-ignore no-explicit-any
type ParsedOptions = Record<string, any>;

const toCliConfig = (options: ParsedOptions): Result<CliConfig, string> => {
  const agent = String(options.agent ?? "claude").toLowerCase();
  if (!isAgent(agent)) return err("invalid agent");

  const iterations = options.iterations as number | undefined;
  if (!iterations || iterations < 1) return err("iterations required");

  return ok({
    agent,
    iterations,
    pluginPath: options.plugin as string | undefined,
    level: options.level as EscalationLevel | undefined,
    parallel: (options.parallel as number | undefined) ?? 2,
  });
};

/**
 * Parse CLI args non-interactively. Returns a Result.
 * --help and --version cause cliffy to throw (via throwErrors), yielding err.
 */
export const parseCliArgs = async (
  rawArgs: string[],
  version = "0.0.0",
): Promise<Result<CliConfig, string>> => {
  const prevExitCode = Deno.exitCode;
  try {
    const { options, cmd } = await createCli(version)
      .noExit()
      .throwErrors()
      .parse(rawArgs);

    const name = cmd.getName();
    if (name !== "ralphmania" && name !== "run") {
      return err("subcommand matched");
    }
    return toCliConfig(options);
  } catch {
    return err("parse error");
  } finally {
    Deno.exitCode = prevExitCode;
  }
};

/** Parse CLI args, prompting interactively for missing values when running in a TTY. */
export const parseCliArgsInteractive = async (
  rawArgs: string[],
  version = "0.0.0",
): Promise<Result<CliConfig, string>> => {
  const prevExitCode = Deno.exitCode;
  try {
    const { options } = await createCli(version)
      .noExit()
      .throwErrors()
      .parse(rawArgs);

    const isTTY = Deno.stdin.isTerminal();
    const pluginPath = options.plugin as string | undefined;
    const level = options.level as EscalationLevel | undefined;
    const parallel = (options.parallel as number | undefined) ?? 2;

    // Resolve agent
    let agent: string = String(options.agent ?? "").toLowerCase();
    if (!isAgent(agent)) {
      if (!isTTY) return err("agent required");
      agent = await promptSelect({
        message: "Select agent backend",
        options: [...VALID_AGENTS],
        defaultValue: "claude",
      });
    }
    if (!isAgent(agent)) return err("invalid agent");

    // Resolve iterations
    let iterations = options.iterations as number | undefined;
    if (!iterations || iterations < 1) {
      if (!isTTY) return err("iterations required");
      iterations = await promptNumber({
        message: "Number of iterations",
        defaultValue: 10,
        min: 1,
      });
    }

    return ok({ agent, iterations, pluginPath, level, parallel });
  } catch {
    return err("parse error");
  } finally {
    Deno.exitCode = prevExitCode;
  }
};

const write = (s: string): void => {
  Deno.stdout.writeSync(new TextEncoder().encode(s));
};

const readLine = async (): Promise<string> => {
  const buf = new Uint8Array(1024);
  const n = await Deno.stdin.read(buf);
  return n ? new TextDecoder().decode(buf.subarray(0, n)).trim() : "";
};

const promptSelect = async (
  { message, options, defaultValue }: {
    message: string;
    options: string[];
    defaultValue: string;
  },
): Promise<string> => {
  write(`\n${bold(cyan("?"))} ${bold(message)}\n`);
  options.forEach((opt, i) => {
    const isDefault = opt === defaultValue;
    const prefix = isDefault ? green("  > ") : "    ";
    const label = isDefault ? green(bold(opt)) : dim(opt);
    const tag = isDefault ? dim(" (default)") : "";
    write(`${prefix}${yellow(`${i + 1})`)} ${label}${tag}\n`);
  });
  write(
    `\n${dim("Enter choice [1-" + options.length + "]")} ${
      dim("(" + defaultValue + ")")
    }: `,
  );
  const input = await readLine();
  if (!input) return defaultValue;
  const idx = parseInt(input, 10);
  if (idx >= 1 && idx <= options.length) return options[idx - 1];
  const match = options.find((o) => o.toLowerCase() === input.toLowerCase());
  return match ?? defaultValue;
};

const promptNumber = async (
  { message, defaultValue, min }: {
    message: string;
    defaultValue: number;
    min: number;
  },
): Promise<number> => {
  write(
    `${bold(cyan("?"))} ${bold(message)} ${
      dim("(default: " + defaultValue + ")")
    }: `,
  );
  const input = await readLine();
  if (!input) return defaultValue;
  const n = parseInt(input, 10);
  return isNaN(n) || n < min ? defaultValue : n;
};
