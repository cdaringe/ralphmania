#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env
/**
 * Ralphmania runs an AI agent in an agentic loop, iterating until a
 * `specification.md` is fully implemented and validated.
 *
 * ```sh
 * deno run -A mod.ts --iterations 10
 * deno run -A mod.ts --iterations 10 --coder ollama/gemma4:e2b
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
  AgentSessionConfig,
  EscalationLevel,
  EscalationState,
  InputMode,
  IterationResult,
  Logger,
  LoopCheckpoint,
  LoopState,
  ModelLadder,
  ModelRoleConfig,
  ModelSelection,
  RectifyAction,
  Result,
  ThinkingLevel,
  ToolMode,
  ValidationResult,
} from "./src/types.ts";
export { err, ok } from "./src/types.ts";

import type { EscalationLevel, ModelLadder } from "./src/types.ts";
import { createLogger } from "./src/logger.ts";
import { createCli, parseCliArgsInteractive } from "./src/cli.ts";
import { serveReceipts } from "./src/serve.ts";
import { ensureValidationHook } from "./src/validation.ts";
import { updateReceipts } from "./src/runner.ts";
import { publishContainedGui } from "./src/gui/publish.ts";
import { loadPlugin } from "./src/plugin.ts";
import {
  formatDuration,
  formatModelSpec,
  parseModelSpec,
  RALPH_RECEIPTS_DIRNAME,
} from "./src/constants.ts";
import { isAllVerified } from "./src/orchestrator/progress-queries.ts";
import { DEFAULT_FILE_PATHS, parseScenarioIds } from "./src/progress.ts";
import type { FilePaths } from "./src/progress.ts";
export type { FilePaths } from "./src/progress.ts";
import { parseProgressRows } from "./src/parsers/progress-rows.ts";
import { computeStatusDiff, lookupScenarioDetail } from "./src/status-diff.ts";
import { updateProgressRow } from "./src/parsers/progress-update.ts";
import * as path from "jsr:@std/path@^1";
import { ensureProgressFile } from "./src/progress.ts";
import { bold, dim, green, magenta, yellow } from "./src/colors.ts";
import { runParallelLoop } from "./src/orchestrator/mod.ts";
import {
  pruneOrphanedBranches,
  resetAllWorktrees,
} from "./src/git/worktree.ts";
import { computeExitCode } from "./src/exit.ts";
import { createEventBus } from "./src/gui/events.ts";
import { createGuiLogger } from "./src/gui/logger.ts";
import { initLogDir, writeOrchestratorEvent } from "./src/gui/log-dir.ts";
import { startGuiServer } from "./src/gui/server.tsx";
import { createAgentInputBus } from "./src/gui/input-bus.ts";
import { createTui } from "./src/tui/mod.ts";
import type { TuiController } from "./src/tui/mod.ts";
import { defaultLoggerOutput } from "./src/ports/impl.ts";

const printBanner = (
  { ladder, iterations, level, parallel }: {
    ladder: ModelLadder;
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
  w(`  ${dim("iterations")}   ${bold(yellow(String(iterations)))}\n`);
  w(`  ${dim("level")}        ${bold(yellow(String(level ?? "auto")))}\n`);
  w(`  ${dim("parallel")}     ${bold(yellow(String(parallel)))}\n`);
  w(`\n`);
  w(`  ${bold("Model Ladder")}\n`);

  const roles = [
    { label: "coder", config: ladder.coder, desc: "(building features)" },
    { label: "verifier", config: ladder.verifier, desc: "(verification)" },
    { label: "escalated", config: ladder.escalated, desc: "(rework)" },
  ];

  roles.forEach(({ label, config, desc }) => {
    const spec = formatModelSpec(config);
    const thinking = config.thinkingLevel
      ? `, thinking: ${config.thinkingLevel}`
      : "";
    w(`  ${dim(label)} ${green("→")} ${spec} ${dim(`${desc}${thinking}`)}\n`);
  });

  w(`${line}\n\n`);
};

const main = async (): Promise<number> => {
  // Mutable output reference — allows the TUI to take over Deno.stdout
  // writes mid-run without recreating the logger or the GUI logger chain.
  let currentOutput = defaultLoggerOutput;
  const mutableOutput = {
    writeSync: (d: Uint8Array) => currentOutput.writeSync(d),
    writeErrSync: (d: Uint8Array) => currentOutput.writeErrSync(d),
  };
  let log = createLogger(mutableOutput);
  const parsed = await parseCliArgsInteractive(Deno.args, version);

  if (parsed.isErr()) {
    log({ tags: ["error"], message: parsed.error });
    return 1;
  }

  const { pluginPath } = parsed.value;

  const pluginResult = await loadPlugin({ pluginPath, log });
  if (pluginResult.isErr()) {
    log({ tags: ["error"], message: pluginResult.error });
    return 1;
  }
  const plugin = pluginResult.value;

  const configHookResult = plugin.onConfigResolved
    ? await plugin.onConfigResolved({
      ladder: parsed.value.ladder,
      iterations: parsed.value.iterations,
      level: parsed.value.level,
      parallel: parsed.value.parallel,
      gui: parsed.value.gui,
      guiPort: parsed.value.guiPort,
      resetWorktrees: parsed.value.resetWorktrees,
      log,
    })
    : undefined;

  // Apply plugin overrides to ladder if provided.
  const applyLadderOverride = (
    base: ModelLadder,
    overrides: typeof configHookResult,
  ): ModelLadder | Error => {
    if (!overrides) return base;
    const coderOverride = overrides.coder
      ? parseModelSpec(overrides.coder)
      : undefined;
    const verifierOverride = overrides.verifier
      ? parseModelSpec(overrides.verifier)
      : undefined;
    const escalatedOverride = overrides.escalated
      ? parseModelSpec(overrides.escalated)
      : undefined;
    for (
      const [role, result] of [
        ["coder", coderOverride],
        ["verifier", verifierOverride],
        ["escalated", escalatedOverride],
      ] as const
    ) {
      if (result && result.isErr()) {
        return new Error(
          `Plugin onConfigResolved returned invalid ${role}: ${result.error}`,
        );
      }
    }
    return {
      coder: coderOverride?.isOk()
        ? { ...base.coder, ...coderOverride.value }
        : base.coder,
      verifier: verifierOverride?.isOk()
        ? { ...base.verifier, ...verifierOverride.value }
        : base.verifier,
      escalated: escalatedOverride?.isOk()
        ? { ...base.escalated, ...escalatedOverride.value }
        : base.escalated,
    };
  };

  const ladderResult = applyLadderOverride(
    parsed.value.ladder,
    configHookResult,
  );
  if (ladderResult instanceof Error) {
    log({ tags: ["error"], message: ladderResult.message });
    Deno.exit(1);
  }
  const ladder = ladderResult;
  const iterations = configHookResult?.iterations ?? parsed.value.iterations;
  const level = configHookResult?.level ?? parsed.value.level;
  const parallel = configHookResult?.parallel ?? parsed.value.parallel;
  const gui = configHookResult?.gui ?? parsed.value.gui;
  const guiPort = configHookResult?.guiPort ?? parsed.value.guiPort;
  const resetWorktrees = configHookResult?.resetWorktrees ??
    parsed.value.resetWorktrees;

  if (resetWorktrees) {
    const resetResult = await resetAllWorktrees({ log });
    if (resetResult.isErr()) {
      log({ tags: ["error"], message: resetResult.error });
      return 1;
    }
  }

  // Always prune orphaned ralph/worker-* branches on boot (cheap, safe).
  await pruneOrphanedBranches({ log });

  const filePaths: FilePaths = {
    specFile: configHookResult?.specFile ?? DEFAULT_FILE_PATHS.specFile,
    progressFile: configHookResult?.progressFile ??
      DEFAULT_FILE_PATHS.progressFile,
  };

  printBanner({ ladder, iterations, level, parallel });

  const guiController = new AbortController();
  let guiFinished: Promise<void> | undefined;
  // Event bus is always created so both --gui (web) and TUI can use it.
  const bus = createEventBus();
  let agentInputBus: import("./src/gui/input-bus.ts").AgentInputBus | undefined;
  if (gui) {
    agentInputBus = createAgentInputBus();
    await initLogDir();
    // Bridge: bus events → orchestrator log file for SSE file-tailing
    bus.subscribe((event) => {
      writeOrchestratorEvent(event);
    });
    const readSpecAndProgress = async () => {
      const [specRaw, progressRaw] = await Promise.all([
        Deno.readTextFile(filePaths.specFile).catch(() => ""),
        Deno.readTextFile(filePaths.progressFile).catch(() => ""),
      ]);
      const specIds = parseScenarioIds(specRaw);
      const specResult = parseProgressRows(specRaw);
      const specRows = specResult.isOk() ? specResult.value : [];
      const progressResult = parseProgressRows(progressRaw);
      const progressRows = progressResult.isOk() ? progressResult.value : [];
      return { specIds, specRows, progressRows };
    };
    guiFinished = startGuiServer({
      port: guiPort,
      log,
      signal: guiController.signal,
      agentInputBus,
      statusProvider: async () => {
        const { specIds, progressRows } = await readSpecAndProgress();
        return computeStatusDiff(specIds, progressRows);
      },
      scenarioDetailProvider: async (id) => {
        const { specRows, progressRows } = await readSpecAndProgress();
        return lookupScenarioDetail(id, specRows, progressRows);
      },
      progressRowUpdater: async (update) => {
        const raw = await Deno.readTextFile(filePaths.progressFile);
        const result = updateProgressRow(raw, update);
        if (!result.isOk()) return { ok: false, error: result.error };
        await Deno.writeTextFile(filePaths.progressFile, result.value);
        return { ok: true };
      },
    }).then((h) => h.finished);
  }
  // Always bridge logger → event bus so both TUI and web GUI receive events.
  log = createGuiLogger(log, bus);

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

  // Declared outside the try so finally can access them.
  let tui: TuiController | undefined;
  let progressPollId: number | undefined;

  try {
    const hookResult = await ensureValidationHook(log);
    if (hookResult.isErr()) {
      log({ tags: ["error"], message: hookResult.error });
      return 1;
    }

    const specContent = await Deno.readTextFile(filePaths.specFile).catch(
      () => "",
    );
    const expectedScenarioIds = parseScenarioIds(specContent);
    const loopStartedAt = Date.now();

    // ── TUI setup ──────────────────────────────────────────────────────────
    // Activate the terminal UI when stdout is a TTY and the web GUI is off.
    if (Deno.stdout.isTerminal() && !gui) {
      tui = createTui({
        bus,
        total: expectedScenarioIds.length,
        signal: shutdownController.signal,
      });
      // Route logger output through the TUI so the status bar is maintained.
      currentOutput = tui.loggerOutput;
      // Poll progress.md every 4 s to update the "verified" counter.
      const activeTui = tui;
      progressPollId = setInterval(async () => {
        const raw = await Deno.readTextFile(filePaths.progressFile).catch(
          () => "",
        );
        const section = raw.split("END_DEMO")[1] ?? "";
        const rows = parseProgressRows(section);
        if (rows.isOk()) {
          activeTui.setVerified(
            rows.value.filter((r) => r.status === "VERIFIED").length,
          );
        }
      }, 4_000);
      // Start keyboard handler (raw stdin for 0-9 worker filter keys).
      tui.startKeyboardHandler().catch(() => {});
    }

    const iterationsUsed = await runParallelLoop({
      ladder,
      iterations,
      parallelism: parallel,
      expectedScenarioIds,
      signal: shutdownController.signal,
      log,
      plugin,
      level,
      specFile: filePaths.specFile,
      progressFile: filePaths.progressFile,
      agentInputBus,
    });

    if (iterationsUsed === 130) return 130;

    const elapsed = formatDuration(Date.now() - loopStartedAt);

    const finalContent = await Deno.readTextFile(filePaths.progressFile).catch(
      () => "",
    );
    const finalSection = finalContent.split("END_DEMO")[1] ?? "";
    const allDoneResult = isAllVerified(finalSection, expectedScenarioIds);
    const allDone = allDoneResult.isOk() && allDoneResult.value;

    // Completion summary
    const finalRows = parseProgressRows(finalSection);
    const verified = finalRows.isOk()
      ? finalRows.value.filter((r) => r.status === "VERIFIED").length
      : 0;
    const total = expectedScenarioIds.length;
    log({
      tags: ["info"],
      message:
        `Loop finished: ${verified}/${total} verified, ${iterationsUsed} iteration(s), ${elapsed}`,
    });

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
        await updateReceipts({ ladder, plugin, log }))
      : undefined;

    receiptsResult && receiptsResult.isErr() &&
      log({ tags: ["error"], message: receiptsResult.error });

    if (allDone && import.meta.url.startsWith("file:")) {
      const guiOutDir = path.join(RALPH_RECEIPTS_DIRNAME, "gui");
      const guiResult = await publishContainedGui({ outDir: guiOutDir, log });
      if (guiResult.isErr()) {
        log({
          tags: ["error"],
          message: `GUI publish failed: ${guiResult.error}`,
        });
      } else {
        log({
          tags: ["info"],
          message: `GUI bundle published to ${guiOutDir}`,
        });
      }
    }

    !allDone &&
      log({
        tags: ["info"],
        message:
          `${iterationsUsed} iterations completed without completion marker.`,
      });

    return computeExitCode(allDone);
  } finally {
    guiController.abort();
    await guiFinished?.catch(() => {});
    clearInterval(progressPollId);
    tui?.cleanup();
  }
};

if (import.meta.main) {
  const cli = createCli(version, {
    onRun: async () => {
      Deno.exitCode = await main();
    },
    // deno-lint-ignore no-explicit-any
    onServeReceipts: async (options: any) => {
      await serveReceipts({
        open: options.open as boolean,
        port: options.port as number,
      }).catch((error) => {
        const log = createLogger();
        log({ tags: ["error"], message: `Fatal error: ${error}` });
        Deno.exit(1);
      });
    },
  });

  await cli.parse(Deno.args).catch((error) => {
    const log = createLogger();
    log({ tags: ["error"], message: `Fatal error: ${error}` });
    Deno.exit(1);
  });
}
