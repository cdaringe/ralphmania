// coverage:ignore — CLI entry point with process-level orchestration and interactive prompts
import { Command, ValidationError } from "@cliffy/command";
import {
  err,
  type EscalationLevel,
  type ModelLadder,
  ok,
  type Result,
} from "./types.ts";
import { DEFAULT_MODEL_LADDER, parseModelSpec } from "./constants.ts";
import { bold, cyan, dim } from "./colors.ts";

export type CliConfig = {
  ladder: ModelLadder;
  iterations: number;
  pluginPath: string | undefined;
  level: EscalationLevel | undefined;
  parallel: number;
  gui: boolean;
  guiPort: number;
  resetWorktrees: boolean;
  sim: boolean;
  simScenarios: number;
  simProfile: "instant" | "fast" | "realistic";
};

const validateLevel = (v: number): number => {
  if (v < 0 || v > 1) throw new ValidationError("level must be 0 or 1");
  return v;
};

/** Apply the shared run-command options to a Command. */
// deno-lint-ignore no-explicit-any
const withRunOptions = <T extends Command<any>>(cmd: T): T =>
  cmd
    .option(
      "-i, --iterations <count:integer>",
      "Number of agentic loop iterations.",
    )
    .option(
      "--coder <spec:string>",
      "Coder model as provider/model or provider:model (default: anthropic/claude-sonnet-4-5-20250514).",
    )
    .option(
      "--verifier <spec:string>",
      "Verifier model as provider/model or provider:model (default: anthropic/claude-opus-4-5-20250514).",
    )
    .option(
      "--escalated <spec:string>",
      "Escalated model as provider/model or provider:model (default: anthropic/claude-opus-4-5-20250514).",
    )
    .option("-p, --plugin <path:string>", "Path to a plugin module.")
    .option(
      "-l, --level <level:integer>",
      "Starting escalation level (0=coder/verifier, 1=escalated).",
      { value: validateLevel },
    )
    .option("-P, --parallel <count:integer>", "Number of parallel workers.", {
      default: 2,
    })
    .option("--gui", "Start the live GUI server alongside the loop.", {
      default: false,
    })
    .option("--gui-port <port:integer>", "Port for the GUI server.", {
      default: 8420,
    })
    .option(
      "--reset-worktrees",
      "Clear all existing ralph worker worktrees and state on boot.",
      { default: false },
    )
    .option(
      "--sim",
      "Run in simulation mode with fake agent backends (implies --gui).",
      { default: false },
    )
    .option(
      "--sim-scenarios <count:integer>",
      "Number of simulated scenarios.",
      { default: 4 },
    )
    .option(
      "--sim-profile <profile:string>",
      "Simulation timing profile: instant, fast, or realistic.",
      { default: "fast" },
    ) as T;

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

/** Resolve a model ladder from CLI options, using defaults for unspecified roles. */
const resolveLadder = (options: ParsedOptions): Result<ModelLadder, string> => {
  const coderSpec = options.coder as string | undefined;
  const verifierSpec = options.verifier as string | undefined;
  const escalatedSpec = options.escalated as string | undefined;

  const coder = coderSpec
    ? parseModelSpec(coderSpec)
    : ok({ ...DEFAULT_MODEL_LADDER.coder });
  if (coder.isErr()) return err(`--coder: ${coder.error}`);

  const verifier = verifierSpec
    ? parseModelSpec(verifierSpec)
    : ok({ ...DEFAULT_MODEL_LADDER.verifier });
  if (verifier.isErr()) return err(`--verifier: ${verifier.error}`);

  const escalated = escalatedSpec
    ? parseModelSpec(escalatedSpec)
    : ok({ ...DEFAULT_MODEL_LADDER.escalated });
  if (escalated.isErr()) return err(`--escalated: ${escalated.error}`);

  return ok({
    coder: {
      ...DEFAULT_MODEL_LADDER.coder,
      ...coder.value,
    },
    verifier: {
      ...DEFAULT_MODEL_LADDER.verifier,
      ...verifier.value,
    },
    escalated: {
      ...DEFAULT_MODEL_LADDER.escalated,
      ...escalated.value,
    },
  });
};

const toCliConfig = (options: ParsedOptions): Result<CliConfig, string> => {
  const iterations = options.iterations as number | undefined;
  if (!iterations || iterations < 1) return err("iterations required");

  const ladderResult = resolveLadder(options);
  if (ladderResult.isErr()) return err(ladderResult.error);

  const sim = (options.sim as boolean | undefined) ?? false;
  const simProfile = (options.simProfile as string | undefined) ?? "fast";
  const validProfiles = ["instant", "fast", "realistic"] as const;
  if (!validProfiles.includes(simProfile as typeof validProfiles[number])) {
    return err(`--sim-profile must be one of: ${validProfiles.join(", ")}`);
  }

  return ok({
    ladder: ladderResult.value,
    iterations,
    pluginPath: options.plugin as string | undefined,
    level: options.level as EscalationLevel | undefined,
    parallel: (options.parallel as number | undefined) ?? 2,
    gui: sim || ((options.gui as boolean | undefined) ?? false),
    guiPort: (options.guiPort as number | undefined) ?? 8420,
    resetWorktrees: (options.resetWorktrees as boolean | undefined) ?? false,
    sim,
    simScenarios: (options.simScenarios as number | undefined) ?? 4,
    simProfile: simProfile as "instant" | "fast" | "realistic",
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

    // Resolve model ladder
    const ladderResult = resolveLadder(options);
    if (ladderResult.isErr()) return err(ladderResult.error);
    const ladder = ladderResult.value;

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

    const sim = (options.sim as boolean | undefined) ?? false;
    const gui = sim || ((options.gui as boolean | undefined) ?? false);
    const guiPort = (options.guiPort as number | undefined) ?? 8420;
    const resetWorktrees = (options.resetWorktrees as boolean | undefined) ??
      false;
    const simProfile = (options.simProfile as string | undefined) ?? "fast";
    const validProfiles = ["instant", "fast", "realistic"] as const;
    if (
      sim &&
      !validProfiles.includes(simProfile as typeof validProfiles[number])
    ) {
      return err(`--sim-profile must be one of: ${validProfiles.join(", ")}`);
    }
    return ok({
      ladder,
      iterations,
      pluginPath,
      level,
      parallel,
      gui,
      guiPort,
      resetWorktrees,
      sim,
      simScenarios: (options.simScenarios as number | undefined) ?? 4,
      simProfile: simProfile as "instant" | "fast" | "realistic",
    });
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
