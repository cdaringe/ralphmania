import type {
  Agent,
  EscalationLevel,
  IterationResult,
  Logger,
  ModelSelection,
  Result,
} from "./types.ts";
import { err, extractSDKText, ok } from "./types.ts";
import {
  COMPLETION_MARKER,
  nonInteractiveEnv,
  RALPH_RECEIPTS_DIRNAME,
  TIMEOUT_MS,
} from "./constants.ts";
import { blue, cyan, green, magenta, yellow } from "./colors.ts";
import { getModel } from "./model.ts";
import { buildCommandSpec } from "./command.ts";
import type { HookContext, Plugin } from "./plugin.ts";
import {
  initialWorkerState,
  isWorkerTerminal,
  workerTransition,
} from "./worker-machine.ts";
import type { AgentRunDeps } from "./worker-machine.ts";

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
export const pipeStream = async ({ stream, output, marker }: {
  stream: ReadableStream<Uint8Array>;
  output: { write: (data: Uint8Array) => Promise<number> };
  marker?: string;
}): Promise<boolean> => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let found = false;
  let matchIndex = 0;
  try {
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true });
      await output.write(encoder.encode(text));
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
  } catch {
    // Stream closed or aborted
  }
  return found;
};

// Re-export from worker-machine for backward compatibility.
export { resolveWorkerModelSelection } from "./worker-machine.ts";

/* c8 ignore start — real subprocess execution, tested via integration */
/**
 * Execute an agent subprocess — the I/O boundary of the worker pipeline.
 * This is the default {@link AgentRunDeps.execute} implementation.
 */
export const executeAgent: AgentRunDeps["execute"] = async (
  { spec, agent, selection, iterationNum, signal, log, cwd, workerIndex }:
    Parameters<
      AgentRunDeps["execute"]
    >[0],
): Promise<IterationResult> => {
  const combinedSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(TIMEOUT_MS),
  ]);

  try {
    const child = new Deno.Command(spec.command, {
      args: spec.args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      cwd,
      env: {
        ...nonInteractiveEnv(),
        ...(selection.effort
          ? { CLAUDE_CODE_EFFORT_LEVEL: selection.effort }
          : {}),
      },
      signal: combinedSignal,
    }).spawn();

    const prefix = workerIndex !== undefined
      ? workerPrefix(workerIndex, selection.targetScenario)
      : undefined;

    const rawStdout = agent === "claude"
      ? child.stdout.pipeThrough(ndjsonResultTransform())
      : child.stdout;

    // Apply per-line prefix for terminal output only; disk writes (validation
    // logs) bypass this transform so on-disk content stays prefix-free.
    const stdoutStream = prefix
      ? rawStdout.pipeThrough(linePrefixTransform(prefix))
      : rawStdout;
    const stderrStream = prefix
      ? child.stderr.pipeThrough(linePrefixTransform(prefix))
      : child.stderr;

    const [status, foundAllCompleteSigil] = await Promise.all([
      child.status,
      pipeStream({
        stream: stdoutStream,
        output: Deno.stdout,
        marker: COMPLETION_MARKER,
      }),
      pipeStream({ stream: stderrStream, output: Deno.stderr }),
    ]);

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
    if (error instanceof DOMException && error.name === "AbortError") {
      log({
        tags: ["error"],
        message: `TIMEOUT: iteration ${iterationNum} exceeded 60 minutes`,
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
  },
): Promise<IterationResult> => {
  let current: import("./worker-machine.ts").WorkerState = initialWorkerState({
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
