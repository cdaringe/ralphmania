import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { type Agent, err, ok, type Result, VALID_AGENTS } from "./types.ts";
import { USAGE } from "./constants.ts";

const isAgent = (s: string): s is Agent => VALID_AGENTS.some((a) => a === s);

export const parseCliArgs = (
  rawArgs: string[],
): Result<
  { agent: Agent; iterations: number; pluginPath: string | undefined },
  string
> => {
  const args = parseArgs(rawArgs, {
    string: ["agent", "iterations", "plugin"],
    alias: { a: "agent", i: "iterations", p: "plugin" },
    default: { agent: "claude" },
  });

  const agent = String(args.agent).toLowerCase();
  const iterations = parseInt(String(args.iterations ?? ""), 10);
  const pluginPath = typeof args.plugin === "string" ? args.plugin : undefined;

  return !isAgent(agent) || !iterations || isNaN(iterations) || iterations < 1
    ? err(USAGE)
    : ok({ agent, iterations, pluginPath });
};
