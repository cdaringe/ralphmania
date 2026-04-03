import type {
  Agent,
  EscalationLevel,
  IterationResult,
  Logger,
  ModelSelection,
  Result,
} from "./types.ts";
import type { AgentInputBus } from "./gui/input-bus.ts";
import { resetWorkerLog, writeWorkerLine } from "./gui/log-dir.ts";
import { err, ok } from "./types.ts";
import { extractSDKText } from "./agents/claude/sdk-text.ts";
import {
  COMPLETION_MARKER,
  formatDuration,
  nonInteractiveEnv,
  RALPH_RECEIPTS_DIRNAME,
  TIMEOUT_MS,
  WORKER_IDLE_TIMEOUT_MS,
} from "./constants.ts";
import { blue, cyan, green, magenta, yellow } from "./colors.ts";
import { getModel } from "./model.ts";
import { buildCommandSpec } from "./command.ts";
import type { HookContext, Plugin } from "./plugin.ts";
import { createIdleWatchdog } from "./idle-watchdog.ts";
import {
  initialWorkerState,
  isWorkerTerminal,
  workerTransition,
} from "./machines/worker-machine.ts";
import type { AgentRunDeps } from "./ports/types.ts";

/**
 * Parse an NDJSON line from `claude --output-format=stream-json` and extract
 * displayable text. Returns `undefined` for events with no user-facing content.
 *
 * @see {@link https://platform.claude.com/docs/en/agent-sdk/typescript#message-types}
 */
export const extractNdjsonResult = (line: string): string | undefined => {
  try {
    return extractSDKText(JSON.parse(line));
  } catch {
    return line;
  }
};

/** TransformStream that extracts `.result` from each NDJSON line. */
export const ndjsonResultTransform = (): TransformStream<
  Uint8Array,
  Uint8Array
> => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return new TransformStream({
    transform(
      chunk: Uint8Array,
      controller: TransformStreamDefaultController<Uint8Array>,
    ): void {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const result = extractNdjsonResult(trimmed);
        if (result !== undefined) {
          controller.enqueue(encoder.encode(result + "\n"));
        }
      });
    },
    flush(controller: TransformStreamDefaultController<Uint8Array>): void {
      const trimmed = buffer.trim();
      if (!trimmed) return;
      const result = extractNdjsonResult(trimmed);
      if (result !== undefined) {
        controller.enqueue(encoder.encode(result + "\n"));
      }
    },
  });
};

const WORKER_COLORS: ReadonlyArray<(s: string) => string> = [
  green,
  yellow,
  cyan,
  magenta,
  blue,
];

/**
 * Build a fixed-width colored prefix string for a worker's stdio output.
 * Format: `[wN/sNN] ` — worker index + zero-padded scenario number.
 * Colors cycle through {@link WORKER_COLORS} so each worker is visually
 * distinct. Only colored when writing to a TTY (controlled by colors.ts).
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
 * byte stream. Applies ONLY when writing to the terminal — disk writes bypass
 * this transform to keep logs clean (scenario 33).
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
    // Stream closed or aborted — expected during cancellation.
    // Log unexpected errors so they don't vanish silently.
    const isAbort = error instanceof DOMException &&
      error.name === "AbortError";
    const isResourceClosed = error instanceof TypeError &&
      String(error).includes("resource closed");
    if (!isAbort && !isResourceClosed) {
      console.error("[pipeStream] unexpected error:", error);
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

/** Only backends with a true multi-turn session API should accept live input. */
export const supportsInteractiveAgentInput = (
  agent: import("./types.ts").Agent,
): boolean => agent === "claude";

/* c8 ignore start — real subprocess execution, tested via integration */
/**
 * Execute an agent — the I/O boundary of the worker pipeline.
 * This is the default {@link AgentRunDeps.execute} implementation.
 *
 * For claude: uses the Agent SDK session API for interactive multi-turn input.
 * For other agents: uses a subprocess with stdin disabled.
 */
export const executeAgent: AgentRunDeps["execute"] = async (
  {
    spec,
    agent,
    selection,
    iterationNum,
    signal,
    log,
    cwd,
    workerIndex,
    agentInputBus,
  }: Parameters<
    AgentRunDeps["execute"]
  >[0],
): Promise<IterationResult> => {
  const workerId = selection.targetScenario;

  // Reset GUI log file for this worker.
  if (workerId !== undefined) {
    await resetWorkerLog(workerId).catch(() => {});
  }

  // Claude uses the Agent SDK for interactive multi-turn sessions.
  if (agent === "claude") {
    const { executeClaudeSession } = await import(
      "./agents/claude/sdk-session.ts"
    );
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    const prefix = workerIndex !== undefined
      ? workerPrefix(workerIndex, workerId)
      : undefined;
    const enc = new TextEncoder();

    return executeClaudeSession({
      prompt: spec.args[spec.args.length - 1],
      model: selection.model,
      effort: selection.effort,
      iterationNum,
      signal,
      log,
      cwd: cwd ?? Deno.cwd(),
      workerId,
      agentInputBus,
      deps: {
        query: (qOpts) => {
          const ac = new AbortController();
          qOpts.signal.addEventListener("abort", () => ac.abort(), {
            once: true,
          });
          // Merge initial prompt + follow-up input into a single async
          // iterable that the SDK's V1 query consumes as multi-turn input.
          const userMsg = (text: string) => ({
            type: "user" as const,
            message: {
              role: "user" as const,
              content: [{ type: "text" as const, text }],
            },
            parent_tool_use_id: null,
          });
          // deno-lint-ignore explicit-function-return-type
          async function* promptStream() {
            yield userMsg(qOpts.prompt);
            for await (const text of qOpts.inputMessages) {
              yield userMsg(text);
            }
          }
          return query({
            prompt: promptStream(),
            options: {
              model: qOpts.model,
              cwd: qOpts.cwd,
              // deno-lint-ignore no-explicit-any
              permissionMode: "bypassPermissions" as any,
              allowedTools: [
                "Bash",
                "Read",
                "Write",
                "Edit",
                "Glob",
                "Grep",
              ],
              ...(qOpts.effort
                ? { effort: qOpts.effort as "low" | "medium" | "high" }
                : {}),
              abortController: ac,
            },
          });
        },
        onLine: async (text) => {
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
        },
      },
    });
  }

  // Non-claude agents use a subprocess with optional stdin piping.
  return executeSubprocess({
    spec,
    selection,
    iterationNum,
    signal,
    log,
    cwd,
    workerIndex,
    workerId,
    agentInputBus: supportsInteractiveAgentInput(agent)
      ? agentInputBus
      : undefined,
  });
};

/** Subprocess executor for non-claude agents (codex, etc.). */
const executeSubprocess = async (
  {
    spec,
    selection,
    iterationNum,
    signal,
    log,
    cwd,
    workerIndex,
    workerId,
    agentInputBus,
  }: {
    spec: import("./types.ts").CommandSpec;
    selection: import("./types.ts").ModelSelection;
    iterationNum: number;
    signal: AbortSignal;
    log: import("./types.ts").Logger;
    cwd: string | undefined;
    workerIndex: number | undefined;
    workerId: string | undefined;
    agentInputBus: import("./gui/input-bus.ts").AgentInputBus | undefined;
  },
): Promise<IterationResult> => {
  const hardTimeoutMs = TIMEOUT_MS;
  const idleTimeoutMs = WORKER_IDLE_TIMEOUT_MS;
  const watchdog = createIdleWatchdog(signal, {
    hardTimeoutMs,
    idleTimeoutMs,
  });

  try {
    const useInputBus = agentInputBus !== undefined &&
      workerIndex !== undefined && workerId !== undefined;
    const child = new Deno.Command(spec.command, {
      args: spec.args,
      stdin: useInputBus ? "piped" : "null",
      stdout: "piped",
      stderr: "piped",
      cwd,
      env: {
        ...nonInteractiveEnv(),
        ...(selection.effort
          ? { CLAUDE_CODE_EFFORT_LEVEL: selection.effort }
          : {}),
      },
      signal: watchdog.signal,
    }).spawn();

    if (useInputBus) {
      agentInputBus.register(workerId, child.stdin);
    }

    const prefix = workerIndex !== undefined
      ? workerPrefix(workerIndex, selection.targetScenario)
      : undefined;

    const guiOnLine = workerId !== undefined
      ? (line: string): void => {
        writeWorkerLine(workerId, {
          type: "log",
          level: "info",
          tags: ["info", "agent-stream", workerId],
          message: line,
          ts: Date.now(),
          workerId,
        });
      }
      : undefined;

    // Tee raw streams: one copy for GUI (clean), one for terminal (prefixed).
    const [rawStdoutForTerminal, rawStdoutForGui] = guiOnLine
      ? child.stdout.tee()
      : [child.stdout, undefined];
    const [rawStderrForTerminal, rawStderrForGui] = guiOnLine
      ? child.stderr.tee()
      : [child.stderr, undefined];

    const stdoutStream = prefix
      ? rawStdoutForTerminal.pipeThrough(linePrefixTransform(prefix))
      : rawStdoutForTerminal;
    const stderrStream = prefix
      ? rawStderrForTerminal.pipeThrough(linePrefixTransform(prefix))
      : rawStderrForTerminal;

    const nullOutput = {
      write: (_: Uint8Array): Promise<number> => Promise.resolve(0),
    };

    const [status, foundAllCompleteSigil] = await Promise.all([
      child.status,
      pipeStream({
        stream: stdoutStream,
        output: Deno.stdout,
        marker: COMPLETION_MARKER,
        onActivity: watchdog.touch,
      }),
      pipeStream({
        stream: stderrStream,
        output: Deno.stderr,
        onActivity: watchdog.touch,
      }),
      ...(rawStdoutForGui
        ? [
          pipeStream({
            stream: rawStdoutForGui,
            output: nullOutput,
            onLine: guiOnLine,
          }),
        ]
        : []),
      ...(rawStderrForGui
        ? [
          pipeStream({
            stream: rawStderrForGui,
            output: nullOutput,
            onLine: guiOnLine,
          }),
        ]
        : []),
    ]);

    if (useInputBus) agentInputBus.unregister(workerId);
    watchdog.stop();

    if (status.code !== 0) {
      log({
        tags: ["error"],
        message:
          `iteration ${iterationNum} failed with exit code ${status.code}`,
      });
      return { status: "failed", code: status.code };
    }
    if (foundAllCompleteSigil) {
      log({
        tags: ["info"],
        message: `specification complete after ${iterationNum} iterations.`,
      });
      return { status: "complete" };
    }
    log({
      tags: ["info"],
      message: `Iteration ${iterationNum} complete.`,
    });
    return { status: "continue" };
  } catch (error) {
    watchdog.stop();
    if (error instanceof DOMException && error.name === "AbortError") {
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

/** Default agent deps using real subprocess execution. */
const defaultAgentDeps: AgentRunDeps = { execute: executeAgent };
/* c8 ignore stop */

/**
 * Run a single agent iteration. Drives the worker state machine through
 * model resolution → prompt building → command building → agent execution.
 */
export const runIteration = async (
  {
    iterationNum,
    agent,
    signal,
    log,
    validationFailurePath,
    plugin,
    level,
    cwd,
    targetScenarioOverride,
    specFile,
    progressFile,
    workerIndex,
    agentInputBus,
  }: {
    iterationNum: number;
    agent: Agent;
    signal: AbortSignal;
    log: Logger;
    validationFailurePath: string | undefined;
    plugin: Plugin;
    level: EscalationLevel | undefined;
    cwd?: string;
    targetScenarioOverride?: string;
    specFile?: string;
    progressFile?: string;
    workerIndex?: number;
    agentInputBus?: AgentInputBus;
  },
): Promise<IterationResult> => {
  let current: import("./machines/worker-machine.ts").WorkerState =
    initialWorkerState({
      iterationNum,
      agent,
      level,
      targetScenarioOverride,
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

/* c8 ignore start — real subprocess execution */
export const updateReceipts = async (
  { agent, plugin, log }: { agent: Agent; plugin: Plugin; log: Logger },
): Promise<Result<undefined, string>> => {
  const prompt = RECEIPTS_PROMPT;
  const ctx: HookContext = { agent, log, iterationNum: -1 };
  const rawSelection: ModelSelection = {
    model: getModel({ agent, mode: "fast" }),
    mode: "fast",
    targetScenario: undefined,
    effort: undefined,
    actionableScenarios: [],
  };
  const selection = plugin.onModelSelected
    ? await plugin.onModelSelected({ selection: rawSelection, ctx })
    : rawSelection;
  const rawSpec = buildCommandSpec({
    agent,
    model: selection.model,
    prompt,
  });
  const spec = plugin.onCommandBuilt
    ? await plugin.onCommandBuilt({ spec: rawSpec, selection, ctx })
    : rawSpec;
  const cmdString = [spec.command, ...spec.args].join(" ");

  try {
    const child = new Deno.Command(spec.command, {
      args: spec.args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      env: nonInteractiveEnv(),
    }).spawn();

    const stdoutStream = agent === "claude"
      ? child.stdout.pipeThrough(ndjsonResultTransform())
      : child.stdout;

    const [status] = await Promise.all([
      child.status,
      pipeStream({ stream: stdoutStream, output: Deno.stdout }),
      pipeStream({ stream: child.stderr, output: Deno.stderr }),
    ]);

    return status.code
      ? err(
        `Failed to update receipts with exit code ${status.code} [${cmdString}]`,
      )
      : ok(undefined);
  } catch (error) {
    return err(`Failed to generate receipts: ${error} [${cmdString}]`);
  }
};
/* c8 ignore stop */
