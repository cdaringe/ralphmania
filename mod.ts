#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env
/**
 * Ralphmania runs an AI agent in an agentic loop, iterating until a
 * `specification.md` is fully implemented and validated.
 *
 * ```sh
 * deno run -A mod.ts --iterations 10 --agent claude
 * deno run -A mod.ts --iterations 10 --agent codex
 * deno run -A mod.ts --iterations 10 --plugin ./my-plugin.ts
 * ```
 *
 * @module
 */

export type { HookContext, Plugin } from "./src/plugin.ts";

import denoConfig from "./deno.json" with { type: "json" };
const { version } = denoConfig;
export { loadPlugin, noopPlugin } from "./src/plugin.ts";
export type {
  Agent,
  CommandSpec,
  EffortLevel,
  EscalationLevel,
  EscalationState,
  IterationResult,
  Logger,
  LoopState,
  ModelSelection,
  Result,
  ToolMode,
  ValidationResult,
} from "./src/types.ts";
export { err, ok, VALID_AGENTS } from "./src/types.ts";

import type { Agent, EscalationLevel, LoopState } from "./src/types.ts";
import { createLogger } from "./src/logger.ts";
import { parseCliArgsInteractive } from "./src/cli.ts";
import { ensureValidationHook } from "./src/validation.ts";
import { runLoopIteration, updateReceipts } from "./src/runner.ts";
import { loadPlugin } from "./src/plugin.ts";
import { getModel } from "./src/model.ts";
import {
  CLAUDE_CODER,
  CLAUDE_ESCALATED,
  CLAUDE_VERIFIER,
} from "./src/constants.ts";
import { ensureProgressFile } from "./src/progress.ts";
import { bold, cyan, dim, green, magenta, yellow } from "./src/colors.ts";

const printBanner = (
  { agent, iterations, level }: {
    agent: Agent;
    iterations: number;
    level: EscalationLevel | undefined;
  },
) => {
  const line = dim("─".repeat(46));
  const encoder = new TextEncoder();
  const w = (s: string) => Deno.stdout.writeSync(encoder.encode(s));

  w(`\n${line}\n`);
  w(`  ${bold(magenta("ralphmania"))} ${dim(`v${version}`)}\n`);
  w(`${line}\n`);
  w(`  ${dim("agent")}        ${bold(cyan(agent))}\n`);
  w(`  ${dim("iterations")}   ${bold(yellow(String(iterations)))}\n`);
  w(`  ${dim("level")}        ${bold(yellow(String(level ?? "auto")))}\n`);
  w(`\n`);
  w(`  ${bold("Model Ladder")}\n`);

  if (agent === "claude") {
    const roles = [
      { label: "coder", ...CLAUDE_CODER },
      { label: "verifier", ...CLAUDE_VERIFIER },
      { label: "escalated", ...CLAUDE_ESCALATED },
    ];
    roles.forEach(({ label, model, mode, effort }) => {
      w(
        `  ${dim(label)} ${green("→")} ${model} ${
          dim(`(${mode}, effort: ${effort})`)
        }\n`,
      );
    });
  } else {
    const fast = getModel({ agent, mode: "fast" });
    const general = getModel({ agent, mode: "general" });
    const strong = getModel({ agent, mode: "strong" });
    w(
      `  ${dim("fast")}    ${green("→")} ${fast}    ${
        dim("(default build)")
      }\n`,
    );
    w(
      `  ${dim("general")} ${green("→")} ${general} ${
        dim("(rework escalation)")
      }\n`,
    );
    w(
      `  ${dim("strong")}  ${green("→")} ${strong}  ${dim("(heavy rework)")}\n`,
    );
  }

  w(`${line}\n\n`);
};

const main = async (): Promise<number> => {
  const log = createLogger();
  const parsed = await parseCliArgsInteractive(Deno.args);

  if (!parsed.ok) {
    log({ tags: ["error"], message: parsed.error });
    return 1;
  }

  const { pluginPath } = parsed.value;

  const pluginResult = await loadPlugin({ pluginPath, log });
  if (!pluginResult.ok) {
    log({ tags: ["error"], message: pluginResult.error });
    return 1;
  }
  const plugin = pluginResult.value;

  const { agent, iterations, level } = plugin.onConfigResolved
    ? {
      ...parsed.value,
      ...await plugin.onConfigResolved({
        agent: parsed.value.agent,
        iterations: parsed.value.iterations,
        log,
      }),
    }
    : parsed.value;

  printBanner({ agent, iterations, level });

  const shutdownController = new AbortController();
  const onSigint = () => {
    log({
      tags: ["error"],
      message: "Interrupted (ctrl+c again to force exit)",
    });
    shutdownController.abort();
    Deno.removeSignalListener("SIGINT", onSigint);
    Deno.addSignalListener("SIGINT", () => Deno.exit(130));
  };
  Deno.addSignalListener("SIGINT", onSigint);

  await ensureProgressFile(log);

  const hookResult = await ensureValidationHook(log);
  if (!hookResult.ok) {
    log({ tags: ["error"], message: hookResult.error });
    return 1;
  }

  let state: LoopState = {
    validationFailurePath: undefined,
    task: "build",
  };

  let iterationNum = 0;

  while (iterationNum < iterations) {
    if (shutdownController.signal.aborted) {
      log({ tags: ["error"], message: "Exiting due to signal" });
      return 130;
    }
    state = await runLoopIteration({
      state,
      iterationNum,
      agent,
      signal: shutdownController.signal,
      log,
      plugin,
      level,
    });
    ++iterationNum;
    if (state.task === "complete") break;
  }

  await plugin.onLoopEnd?.({
    finalState: { ...state },
    iterationNum,
    log,
  });

  const receiptsResult = state.task === "complete"
    ? (log({ tags: ["info"], message: "Generating evidence receipts..." }),
      await updateReceipts({ agent }))
    : null;

  receiptsResult && !receiptsResult.ok &&
    log({ tags: ["error"], message: receiptsResult.error });

  state.task !== "complete" &&
    log({
      tags: ["info"],
      message:
        `${iterationNum} iterations completed without completion marker.`,
    });

  return 0;
};

if (import.meta.main) {
  main().then(
    (code) => {
      Deno.exitCode = code;
    },
    (error) => {
      const log = createLogger();
      log({ tags: ["error"], message: `Fatal error: ${error}` });
      Deno.exit(1);
    },
  );
}
