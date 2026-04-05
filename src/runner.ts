import type {
  EscalationLevel,
  IterationResult,
  Logger,
  ModelLadder,
  Result,
} from "./types.ts";
import type { AgentInputBus } from "./gui/input-bus.ts";
import { resetWorkerLog, writeWorkerLine } from "./gui/log-dir.ts";
import { err, ok } from "./types.ts";
import {
  COMPLETION_MARKER,
  formatDuration,
  RALPH_RECEIPTS_DIRNAME,
  TIMEOUT_MS,
  WORKER_IDLE_TIMEOUT_MS,
} from "./constants.ts";
import { blue, cyan, green, magenta, yellow } from "./colors.ts";
import { selectFromLadder } from "./model.ts";
import type { HookContext, Plugin } from "./plugin.ts";
import { createIdleWatchdog } from "./idle-watchdog.ts";
import {
  initialWorkerState,
  isWorkerTerminal,
  workerTransition,
} from "./machines/worker-machine.ts";
import type { AgentRunDeps } from "./ports/types.ts";

const WORKER_COLORS: ReadonlyArray<(s: string) => string> = [
  green,
  yellow,
  cyan,
  magenta,
  blue,
];

/**
 * Build a fixed-width colored prefix string for a worker's stdio output.
 * Format: `[wN/sNN] ` -- worker index + scenario number.
 */
export const workerPrefix = (
  workerIndex: number,
  scenario: string | undefined,
): string => {
  const color = WORKER_COLORS[workerIndex % WORKER_COLORS.length];
  const sPart = scenario ?? "--";
  return color(`[w${workerIndex}/s${sPart}]`) + " ";
};

/**
 * TransformStream that prepends `prefix` to the start of every line in the
 * byte stream. Applies ONLY when writing to the terminal -- disk writes bypass
 * this transform to keep logs clean.
 */
export const linePrefixTransform = (
  prefix: string,
): TransformStream<Uint8Array, Uint8Array> => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineStart = true;
  return new TransformStream({
    transform(
      chunk: Uint8Array,
      controller: TransformStreamDefaultController<Uint8Array>,
    ): void {
      const text = decoder.decode(chunk, { stream: true });
      let result = "";
      for (const char of text) {
        if (lineStart) {
          result += prefix;
          lineStart = false;
        }
        result += char;
        if (char === "\n") {
          lineStart = true;
        }
      }
      if (result) {
        controller.enqueue(encoder.encode(result));
      }
    },
  });
};

/**
 * Read a byte stream, decode it, and forward each chunk to `output`.
 *
 * @returns `true` if any chunk contained the optional `marker` string.
 */
export const pipeStream = async ({
  stream,
  output,
  marker,
  onLine,
  onActivity,
}: {
  stream: ReadableStream<Uint8Array>;
  output: { write: (data: Uint8Array) => Promise<number> };
  marker?: string;
  /** Called with each non-empty line for GUI streaming. */
  onLine?: (line: string) => void;
  /** Called whenever new output bytes are observed on the stream. */
  onActivity?: () => void;
}): Promise<boolean> => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let found = false;
  let matchIndex = 0;
  let lineBuffer = "";
  try {
    for await (const chunk of stream) {
      if (chunk.length > 0) onActivity?.();
      const text = decoder.decode(chunk, { stream: true });
      await output.write(encoder.encode(text));
      // Emit complete lines to the GUI callback
      if (onLine) {
        lineBuffer += text;
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trimEnd();
          if (trimmed.length > 0) onLine(trimmed);
        }
      }
      if (marker && !found) {
        for (const ch of text) {
          matchIndex = ch === marker[matchIndex]
            ? matchIndex + 1
            : ch === marker[0]
            ? 1
            : 0;
          if (matchIndex === marker.length) {
            found = true;
            break;
          }
        }
      }
    }
  } catch (error: unknown) {
    // Stream closed or aborted -- expected during cancellation.
    const isAbort = error instanceof DOMException &&
      error.name === "AbortError";
    const isResourceClosed = error instanceof TypeError &&
      String(error).includes("resource closed");
    if (!isAbort && !isResourceClosed) {
      throw error;
    }
  }
  // Flush remaining line buffer
  if (onLine && lineBuffer.trimEnd().length > 0) {
    onLine(lineBuffer.trimEnd());
  }
  return found;
};

// Re-export from worker-machine for backward compatibility.
export { resolveWorkerModelSelection } from "./machines/worker-machine.ts";

/* c8 ignore start -- real pi-mono session execution, tested via integration */
/**
 * Execute a pi-mono agent session -- the I/O boundary of the worker pipeline.
 * This is the default AgentRunDeps.execute implementation.
 */
export const executeAgent: AgentRunDeps["execute"] = async (
  {
    config,
    prompt,
    selection,
    iterationNum,
    signal,
    log,
    workerIndex,
    agentInputBus,
  }: Parameters<AgentRunDeps["execute"]>[0],
): Promise<IterationResult> => {
  const workerId = selection.targetScenario;

  // Reset GUI log file for this worker.
  if (workerId !== undefined) {
    await resetWorkerLog(workerId).catch(() => {});
  }

  const prefix = workerIndex !== undefined
    ? workerPrefix(workerIndex, workerId)
    : undefined;
  const enc = new TextEncoder();

  const hardTimeoutMs = TIMEOUT_MS;
  const idleTimeoutMs = WORKER_IDLE_TIMEOUT_MS;
  const watchdog = createIdleWatchdog(signal, { hardTimeoutMs, idleTimeoutMs });

  const onLine = async (text: string): Promise<void> => {
    const prefixed = prefix ? `${prefix}${text}` : text;
    Deno.stdout.writeSync(enc.encode(prefixed + "\n"));
    if (workerId !== undefined) {
      await writeWorkerLine(workerId, {
        type: "log",
        level: "info",
        tags: ["info", "agent-stream", workerId],
        message: text,
        ts: Date.now(),
        workerId,
      });
    }
  };

  // Register on input bus for GUI interactive steer/followUp.
  if (agentInputBus && workerId) {
    agentInputBus.registerSession(workerId, async (text, mode) => {
      await onLine(
        `[${mode} queued] "${text.substring(0, 60)}${
          text.length > 60 ? "..." : ""
        }"`,
      );
    });
  }

  // Close input bus registration when any abort fires.
  const cleanupBus = (): void => {
    if (agentInputBus && workerId) agentInputBus.unregister(workerId);
  };
  watchdog.signal.addEventListener("abort", cleanupBus, { once: true });
  signal.addEventListener("abort", cleanupBus, { once: true });

  try {
    const { createAgentSession } = await import(
      "@mariozechner/pi-coding-agent"
    );
    const model = config.customModel
      ? await (await import("./custom-model.ts")).resolveCustomModel(
        config.customModel,
      )
      : await (await import("./resolve-model.ts")).resolveModel(
        config.provider,
        config.model,
      );

    const { session } = await createAgentSession({
      model,
      cwd: config.workingDir,
      ...(config.thinkingLevel ? { thinkingLevel: config.thinkingLevel } : {}),
    });

    let foundCompletionMarker = false;

    // Subscribe to session events for output streaming.
    session.subscribe(
      // deno-lint-ignore no-explicit-any
      (event: any) => {
        watchdog.touch();
        const text = event.type === "message_update" &&
            event.assistantMessageEvent?.type === "text_delta"
          ? event.assistantMessageEvent.delta
          : undefined;
        if (text) {
          onLine(text);
          if (text.includes(COMPLETION_MARKER)) {
            foundCompletionMarker = true;
          }
        }
      },
    );

    // Wire up GUI input bus for steer/followUp.
    if (agentInputBus && workerId) {
      agentInputBus.registerSession(workerId, async (text, mode) => {
        watchdog.touch();
        session.prompt(text, { streamingBehavior: mode });
        await onLine(`[${mode} sent] "${text.substring(0, 60)}..."`);
      });
    }

    await session.prompt(prompt);

    cleanupBus();
    watchdog.stop();

    if (signal.aborted || watchdog.timedOut() !== undefined) {
      log({
        tags: ["error"],
        message: watchdog.timedOut() === "idle"
          ? `TIMEOUT: iteration ${iterationNum} produced no new output for ${
            formatDuration(idleTimeoutMs)
          }`
          : `TIMEOUT: iteration ${iterationNum} exceeded ${
            formatDuration(hardTimeoutMs)
          }`,
      });
      return { status: "timeout" };
    }

    return foundCompletionMarker
      ? (log({
        tags: ["info"],
        message: `specification complete after ${iterationNum} iterations.`,
      }),
        { status: "complete" })
      : (log({
        tags: ["info"],
        message: `Iteration ${iterationNum} complete.`,
      }),
        { status: "continue" });
  } catch (error) {
    cleanupBus();
    watchdog.stop();
    if (
      (error instanceof DOMException && error.name === "AbortError") ||
      signal.aborted ||
      watchdog.signal.aborted
    ) {
      log({
        tags: ["error"],
        message: watchdog.timedOut() === "idle"
          ? `TIMEOUT: iteration ${iterationNum} produced no new output for ${
            formatDuration(idleTimeoutMs)
          }`
          : `TIMEOUT: iteration ${iterationNum} exceeded ${
            formatDuration(hardTimeoutMs)
          }`,
      });
      return { status: "timeout" };
    }
    throw error;
  }
};

/** Default agent deps using real pi-mono session execution. */
const defaultAgentDeps: AgentRunDeps = { execute: executeAgent };
/* c8 ignore stop */

/**
 * Run a single agent iteration. Drives the worker state machine through
 * model resolution -> prompt building -> session config -> agent execution.
 */
export const runIteration = async (
  {
    iterationNum,
    ladder,
    signal,
    log,
    validationFailurePath,
    plugin,
    level,
    cwd,
    targetScenarioOverride,
    promptOverride,
    specFile,
    progressFile,
    workerIndex,
    agentInputBus,
  }: {
    iterationNum: number;
    ladder: ModelLadder;
    signal: AbortSignal;
    log: Logger;
    validationFailurePath: string | undefined;
    plugin: Plugin;
    level: EscalationLevel | undefined;
    cwd?: string;
    targetScenarioOverride?: string;
    promptOverride?: string;
    specFile?: string;
    progressFile?: string;
    workerIndex?: number;
    agentInputBus?: AgentInputBus;
  },
): Promise<IterationResult> => {
  let current: import("./machines/worker-machine.ts").WorkerState =
    initialWorkerState({
      iterationNum,
      ladder,
      level,
      targetScenarioOverride,
      promptOverride,
      validationFailurePath,
      specFile,
      progressFile,
    });

  while (!isWorkerTerminal(current)) {
    current = await workerTransition(current, {
      plugin,
      log,
      signal,
      cwd,
      workerIndex,
      agentDeps: defaultAgentDeps,
      agentInputBus,
    });
  }

  return current.result;
};

export const RECEIPTS_PROMPT =
  `Update ${RALPH_RECEIPTS_DIRNAME}/{index.html,assets} with videos &/or markdown notes
evidencing completion of every scenario.

1. For user scenarios with e2e tests a receipt SHALL include a video of the playwright test passing and a description of how the test evidences completion.
2. For requirements that do not have an e2e test a receipt SHALL include a markdown write-up with snippets of code evidence on how the requirement is met.
3. A status SHALL be placed at the top of each receipt indicating if the scenario is VERIFIED or NEEDS_REWORK based on the validation results and your review of the evidence.
4. A short intro SHALL describe how the scenario's goals are achieved.
5. The summary markdown for each VERIFIED scenario SHALL be inlined and collapsed (e.g., inside a <details> element).

Requirements:

1. Markdown SHALL be rendered
2. Videos SHALL be embedded and playable from the receipt.`;

/* c8 ignore start -- real pi-mono session execution */
export const updateReceipts = async (
  { ladder, plugin, log }: {
    ladder: ModelLadder;
    plugin: Plugin;
    log: Logger;
  },
): Promise<Result<undefined, string>> => {
  const prompt = RECEIPTS_PROMPT;
  const ctx: HookContext = { ladder, log, iterationNum: -1 };
  const rawSelection = selectFromLadder({ ladder, mode: "coder" });
  const selection = plugin.onModelSelected
    ? await plugin.onModelSelected({ selection: rawSelection, ctx })
    : rawSelection;

  try {
    const { createAgentSession } = await import(
      "@mariozechner/pi-coding-agent"
    );
    const { resolveModel } = await import("./resolve-model.ts");
    const model = await resolveModel(selection.provider, selection.model);
    const { session } = await createAgentSession({
      model,
      cwd: Deno.cwd(),
      ...(selection.thinkingLevel
        ? { thinkingLevel: selection.thinkingLevel }
        : {}),
    });

    const enc = new TextEncoder();
    session.subscribe(
      // deno-lint-ignore no-explicit-any
      (event: any) => {
        const text = event.type === "message_update" &&
            event.assistantMessageEvent?.type === "text_delta"
          ? event.assistantMessageEvent.delta
          : undefined;
        if (text) Deno.stdout.writeSync(enc.encode(text));
      },
    );

    await session.prompt(prompt);
    return ok(undefined);
  } catch (error) {
    return err(`Failed to generate receipts: ${error}`);
  }
};
/* c8 ignore stop */
