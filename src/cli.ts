import { parseArgs } from "jsr:@std/cli@1/parse-args";
import {
  type Agent,
  err,
  type EscalationLevel,
  ok,
  type Result,
  VALID_AGENTS,
} from "./types.ts";
import { USAGE } from "./constants.ts";
import { bold, cyan, dim, green, yellow } from "./colors.ts";

const isAgent = (s: string): s is Agent => VALID_AGENTS.some((a) => a === s);

export type CliConfig = {
  agent: Agent;
  iterations: number;
  pluginPath: string | undefined;
  level: EscalationLevel | undefined;
  parallel: number;
};

const parseLevel = (
  raw: unknown,
): Result<EscalationLevel | undefined, string> => {
  if (raw === undefined || raw === "") return ok(undefined);
  const n = parseInt(String(raw), 10);
  return n >= 0 && n <= 1
    ? ok(n as EscalationLevel)
    : err(`Invalid --level: ${raw} (must be 0-1)`);
};

export const parseCliArgs = (
  rawArgs: string[],
): Result<CliConfig, string> => {
  const args = parseArgs(rawArgs, {
    boolean: ["help"],
    string: ["agent", "iterations", "plugin", "level", "parallel"],
    alias: {
      a: "agent",
      i: "iterations",
      p: "plugin",
      l: "level",
      h: "help",
      P: "parallel",
    },
    default: { agent: "claude" },
  });

  if (args.help) return err(USAGE);

  const agent = String(args.agent).toLowerCase();
  const iterations = parseInt(String(args.iterations ?? ""), 10);
  const pluginPath = typeof args.plugin === "string" ? args.plugin : undefined;
  const levelResult = parseLevel(args.level);
  const parallel = parseInt(String(args.parallel ?? "1"), 10);

  return !levelResult.ok
    ? levelResult
    : !isAgent(agent) || !iterations || isNaN(iterations) || iterations < 1
    ? err(USAGE)
    : isNaN(parallel) || parallel < 1
    ? err(`Invalid --parallel: ${args.parallel} (must be >= 1)`)
    : ok({
      agent,
      iterations,
      pluginPath,
      level: levelResult.value,
      parallel,
    });
};

/** Parse CLI args, prompting interactively for missing values when running in a TTY. */
export const parseCliArgsInteractive = async (
  rawArgs: string[],
): Promise<Result<CliConfig, string>> => {
  const args = parseArgs(rawArgs, {
    boolean: ["help"],
    string: ["agent", "iterations", "plugin", "level", "parallel"],
    alias: {
      a: "agent",
      i: "iterations",
      p: "plugin",
      l: "level",
      h: "help",
      P: "parallel",
    },
  });

  if (args.help) return err(USAGE);

  const pluginPath = typeof args.plugin === "string" ? args.plugin : undefined;
  const levelResult = parseLevel(args.level);
  if (!levelResult.ok) return levelResult;
  const level = levelResult.value;
  const parallel = parseInt(String(args.parallel ?? "2"), 10);
  if (isNaN(parallel) || parallel < 1) {
    return err(`Invalid --parallel: ${args.parallel} (must be >= 1)`);
  }
  const isTTY = Deno.stdin.isTerminal();

  // Resolve agent
  let agent: string = String(args.agent ?? "").toLowerCase();
  if (!isAgent(agent)) {
    if (!isTTY) return err(USAGE);
    agent = await promptSelect({
      message: "Select agent backend",
      options: [...VALID_AGENTS],
      defaultValue: "claude",
    });
  }
  if (!isAgent(agent)) return err(USAGE);

  // Resolve iterations
  let iterations = parseInt(String(args.iterations ?? ""), 10);
  if (!iterations || isNaN(iterations) || iterations < 1) {
    if (!isTTY) return err(USAGE);
    iterations = await promptNumber({
      message: "Number of iterations",
      defaultValue: 10,
      min: 1,
    });
  }

  return ok({ agent, iterations, pluginPath, level, parallel });
};

const write = (s: string) => Deno.stdout.writeSync(new TextEncoder().encode(s));

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
