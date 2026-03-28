#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env
/**
 * Ralphmania runs an AI agent in an agentic loop, iterating until a
 * `specification.md` is fully implemented and validated.
 *
 * ```sh
 * deno run -A mod.ts --iterations 10 --agent claude
 * deno run -A mod.ts --iterations 10 --agent codex
 * deno run -A mod.ts --iterations 10 --plugin ./my-plugin.ts
 * deno run -A mod.ts serve receipts --open
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
  LoopCheckpoint,
  LoopState,
  ModelSelection,
  Result,
  ToolMode,
  ValidationResult,
} from "./src/types.ts";
export { err, ok, VALID_AGENTS } from "./src/types.ts";

import type { Agent, EscalationLevel } from "./src/types.ts";
import { createLogger } from "./src/logger.ts";
import { createCli, parseCliArgsInteractive } from "./src/cli.ts";
import { serveReceipts } from "./src/serve.ts";
import { ensureValidationHook } from "./src/validation.ts";
import { updateReceipts } from "./src/runner.ts";
import { loadPlugin } from "./src/plugin.ts";
import { getModel, isAllVerified } from "./src/model.ts";
import { DEFAULT_FILE_PATHS, parseScenarioIds } from "./src/progress.ts";
import type { FilePaths } from "./src/progress.ts";
export type { FilePaths } from "./src/progress.ts";
import {
  CLAUDE_CODER,
  CLAUDE_ESCALATED,
  CLAUDE_VERIFIER,
} from "./src/constants.ts";
import { ensureProgressFile } from "./src/progress.ts";
import { bold, cyan, dim, green, magenta, yellow } from "./src/colors.ts";
import { runParallelLoop } from "./src/orchestrator.ts";
import { computeExitCode } from "./src/exit.ts";

const printBanner = (
  { agent, iterations, level, parallel }: {
    agent: Agent;
    iterations: number;
    level: EscalationLevel | undefined;
    parallel: number;
  },
): void => {
  const line = dim("─".repeat(46));
  const encoder = new TextEncoder();
  const w = (s: string): void => {
    Deno.stdout.writeSync(encoder.encode(s));
  };

  w(`\n${line}\n`);
  w(`  ${bold(magenta("ralphmania"))} ${dim(`v${version}`)}\n`);
  w(`${line}\n`);
  w(`  ${dim("agent")}        ${bold(cyan(agent))}\n`);
  w(`  ${dim("iterations")}   ${bold(yellow(String(iterations)))}\n`);
  w(`  ${dim("level")}        ${bold(yellow(String(level ?? "auto")))}\n`);
  w(`  ${dim("parallel")}     ${bold(yellow(String(parallel)))}\n`);
  w(`\n`);
  w(`  ${bold("Model Ladder")}\n`);

  const roles = agent === "claude"
    ? [
      { label: "coder", ...CLAUDE_CODER },
      { label: "verifier", ...CLAUDE_VERIFIER },
      { label: "escalated", ...CLAUDE_ESCALATED },
    ].map(({ label, model, mode, effort }) => ({
      label,
      model,
      desc: `(${mode}, effort: ${effort})`,
    }))
    : ([
      { label: "fast", desc: "(default build)" },
      { label: "general", desc: "(rework escalation)" },
      { label: "strong", desc: "(heavy rework)" },
    ] as const).map(({ label, desc }) => ({
      label,
      model: getModel({ agent, mode: label }),
      desc,
    }));

  roles.forEach(({ label, model, desc }) => {
    w(`  ${dim(label)} ${green("→")} ${model} ${dim(desc)}\n`);
  });

  w(`${line}\n\n`);
};

const main = async (): Promise<number> => {
  const log = createLogger();
  const parsed = await parseCliArgsInteractive(Deno.args, version);

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

  const configHookResult = plugin.onConfigResolved
    ? await plugin.onConfigResolved({
      agent: parsed.value.agent,
      iterations: parsed.value.iterations,
      log,
    })
    : undefined;

  const agent = configHookResult?.agent ?? parsed.value.agent;
  const iterations = configHookResult?.iterations ?? parsed.value.iterations;
  const { level, parallel } = parsed.value;
  const filePaths: FilePaths = {
    specFile: configHookResult?.specFile ?? DEFAULT_FILE_PATHS.specFile,
    progressFile: configHookResult?.progressFile ??
      DEFAULT_FILE_PATHS.progressFile,
  };

  printBanner({ agent, iterations, level, parallel });

  const shutdownController = new AbortController();
  const onSigint = (): void => {
    log({
      tags: ["error"],
      message: "Interrupted (ctrl+c again to force exit)",
    });
    shutdownController.abort();
    Deno.removeSignalListener("SIGINT", onSigint);
    Deno.addSignalListener("SIGINT", () => Deno.exit(130));
  };
  Deno.addSignalListener("SIGINT", onSigint);

  await ensureProgressFile(log, filePaths);

  const hookResult = await ensureValidationHook(log);
  if (!hookResult.ok) {
    log({ tags: ["error"], message: hookResult.error });
    return 1;
  }

  const specContent = await Deno.readTextFile(filePaths.specFile).catch(
    () => "",
  );
  const expectedScenarioIds = parseScenarioIds(specContent);

  const iterationsUsed = await runParallelLoop({
    agent,
    iterations,
    parallelism: parallel,
    expectedScenarioIds,
    signal: shutdownController.signal,
    log,
    plugin,
    level,
    specFile: filePaths.specFile,
    progressFile: filePaths.progressFile,
  });

  if (iterationsUsed === 130) return 130;

  const finalContent = await Deno.readTextFile(filePaths.progressFile).catch(
    () => "",
  );
  const finalSection = finalContent.split("END_DEMO")[1] ?? "";
  const allDone = isAllVerified(finalSection, expectedScenarioIds);

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
    : undefined;

  receiptsResult && !receiptsResult.ok &&
    log({ tags: ["error"], message: receiptsResult.error });

  !allDone &&
    log({
      tags: ["info"],
      message:
        `${iterationsUsed} iterations completed without completion marker.`,
    });

  return computeExitCode(allDone);
};

if (import.meta.main) {
  const cli = createCli(version);

  // Root command and explicit `run` subcommand: run the agentic loop
  const runAction = async (): Promise<void> => {
    Deno.exitCode = await main();
  };
  cli.action(runAction);
  cli.getCommand("run")?.action(runAction);

  // Subcommand: serve receipts
  const serveCmd = cli.getCommand("serve");
  const receiptsCmd = serveCmd?.getCommand("receipts");
  receiptsCmd?.action(
    // deno-lint-ignore no-explicit-any
    async (options: any) => {
      await serveReceipts({
        open: options.open as boolean,
        port: options.port as number,
      }).catch((error) => {
        const log = createLogger();
        log({ tags: ["error"], message: `Fatal error: ${error}` });
        Deno.exit(1);
      });
    },
  );

  await cli.parse(Deno.args).catch((error) => {
    const log = createLogger();
    log({ tags: ["error"], message: `Fatal error: ${error}` });
    Deno.exit(1);
  });
}
