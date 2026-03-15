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

import type { Agent, EscalationLevel } from "./src/types.ts";
import { createLogger } from "./src/logger.ts";
import { parseCliArgsInteractive } from "./src/cli.ts";
import { parseServeArgs, serveReceipts } from "./src/serve.ts";
import { ensureValidationHook } from "./src/validation.ts";
import { updateReceipts } from "./src/runner.ts";
import { loadPlugin } from "./src/plugin.ts";
import { getModel, isAllVerified } from "./src/model.ts";
import {
  CLAUDE_CODER,
  CLAUDE_ESCALATED,
  CLAUDE_VERIFIER,
} from "./src/constants.ts";
import { ensureProgressFile } from "./src/progress.ts";
import { bold, cyan, dim, green, magenta, yellow } from "./src/colors.ts";
import { runParallelLoop } from "./src/parallel.ts";

const printBanner = (
  { agent, iterations, level, parallel }: {
    agent: Agent;
    iterations: number;
    level: EscalationLevel | undefined;
    parallel: number;
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
  w(`  ${dim("parallel")}     ${bold(yellow(String(parallel)))}\n`);
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

  const { agent, iterations, level, parallel } = plugin.onConfigResolved
    ? {
      ...parsed.value,
      ...await plugin.onConfigResolved({
        agent: parsed.value.agent,
        iterations: parsed.value.iterations,
        log,
      }),
    }
    : parsed.value;

  printBanner({ agent, iterations, level, parallel });

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

  const iterationsUsed = await runParallelLoop({
    agent,
    iterations,
    parallelism: parallel,
    signal: shutdownController.signal,
    log,
    plugin,
    level,
  });

  if (iterationsUsed === 130) return 130;

  const finalContent = await Deno.readTextFile("./progress.md").catch(() => "");
  const finalSection = finalContent.split("END_DEMO")[1] ?? "";
  const allDone = isAllVerified(finalSection);

  await plugin.onLoopEnd?.({
    finalState: {
      validationFailurePath: undefined,
      task: allDone ? "complete" : "build",
    },
    iterationNum: iterationsUsed,
    log,
  });

  const receiptsResult = allDone
    ? (log({ tags: ["info"], message: "Generating evidence receipts..." }),
      await updateReceipts({ agent, plugin, log }))
    : null;

  receiptsResult && !receiptsResult.ok &&
    log({ tags: ["error"], message: receiptsResult.error });

  !allDone &&
    log({
      tags: ["info"],
      message:
        `${iterationsUsed} iterations completed without completion marker.`,
    });

  return 0;
};

if (import.meta.main) {
  // Handle `serve receipts [--open] [--port N]` subcommand
  if (Deno.args[0] === "serve" && Deno.args[1] === "receipts") {
    const { open, port } = parseServeArgs(Deno.args.slice(2));
    serveReceipts({ open, port }).catch((error) => {
      const log = createLogger();
      log({ tags: ["error"], message: `Fatal error: ${error}` });
      Deno.exit(1);
    });
  } else {
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
}
