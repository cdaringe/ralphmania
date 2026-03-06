import type {
  Agent,
  IterationResult,
  Logger,
  LoopState,
  Result,
  ValidationResult,
} from "./types.ts";
import { err, extractSDKText, ok } from "./types.ts";
import {
  COMPLETION_MARKER,
  nonInteractiveEnv,
  RALPH_RECEIPTS_DIRNAME,
  TIMEOUT_MS,
} from "./constants.ts";
import { getModel, resolveModelSelection } from "./model.ts";
import { buildCommandSpec, buildPrompt } from "./command.ts";
import { runValidation } from "./validation.ts";
import type { HookContext, Plugin } from "./plugin.ts";
import { bold, cyan, dim, green, magenta, red, yellow } from "./colors.ts";

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
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const result = extractNdjsonResult(trimmed);
        if (result !== undefined) {
          controller.enqueue(encoder.encode(result));
        }
      });
    },
    flush(controller) {
      const trimmed = buffer.trim();
      if (!trimmed) return;
      const result = extractNdjsonResult(trimmed);
      if (result !== undefined) {
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
  try {
    for await (const chunk of stream) {
      const text = decoder.decode(chunk);
      await output.write(encoder.encode(text));
      if (marker && text.includes(marker)) found = true;
    }
  } catch {
    // Stream closed or aborted
  }
  return found;
};

const runIteration = async (
  { iterationNum, agent, signal, log, validationFailurePath, plugin }: {
    iterationNum: number;
    agent: Agent;
    signal: AbortSignal;
    log: Logger;
    validationFailurePath: string | undefined;
    plugin: Plugin;
  },
): Promise<IterationResult> => {
  const ctx: HookContext = { agent, log, iterationNum };

  const rawSelection = await resolveModelSelection(agent, log);
  const selection = plugin.onModelSelected
    ? await plugin.onModelSelected({ selection: rawSelection, ctx })
    : rawSelection;

  const rawPrompt = buildPrompt({
    targetScenario: selection.targetScenario,
    mode: selection.mode,
    validationFailurePath,
  });
  const prompt = plugin.onPromptBuilt
    ? await plugin.onPromptBuilt({ prompt: rawPrompt, selection, ctx })
    : rawPrompt;

  const rawSpec = buildCommandSpec({ agent, model: selection.model, prompt });
  const spec = plugin.onCommandBuilt
    ? await plugin.onCommandBuilt({ spec: rawSpec, selection, ctx })
    : rawSpec;

  log({
    tags: ["info", "iteration"],
    message: `Starting ${iterationNum} (${selection.model})...`,
  });

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
      env: nonInteractiveEnv(),
      signal: combinedSignal,
    }).spawn();

    const stdoutStream = agent === "claude"
      ? child.stdout.pipeThrough(ndjsonResultTransform())
      : child.stdout;

    const [status, foundAllCompleteSigil] = await Promise.all([
      child.status,
      pipeStream({
        stream: stdoutStream,
        output: Deno.stdout,
        marker: COMPLETION_MARKER,
      }),
      pipeStream({ stream: child.stderr, output: Deno.stderr }),
    ]);

    const result: IterationResult = status.code !== 0
      ? (log({
        tags: ["error"],
        message:
          `iteration ${iterationNum} failed with exit code ${status.code}`,
      }),
        { status: "failed", code: status.code })
      : foundAllCompleteSigil
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

    await plugin.onIterationEnd?.({ result, ctx });
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      log({
        tags: ["error"],
        message: `TIMEOUT: iteration ${iterationNum} exceeded 60 minutes`,
      });
      const result: IterationResult = { status: "timeout" };
      await plugin.onIterationEnd?.({ result, ctx });
      return result;
    }

    throw error;
  }
};

const updateReceipts = async (
  { agent }: { agent: Agent },
): Promise<Result<undefined, string>> => {
  const prompt = `
Update ${RALPH_RECEIPTS_DIRNAME}/{index.html,assets} with videos &/or markdown notes
evidencing completion of every scenario.

1. For user scenarios with e2e tests a receipt SHALL include a video of the playwright test passing and a description of how the test evidences completion.
2. For requirements that do not have an e2e test a receipt SHALL include a markdown write-up with snippets of code evidence on how the requirement is met.
3. A status SHALL be placed at the top of each receipt indicating if the scenario is VERIFIED or NEEDS_REWORK based on the validation results and your review of the evidence.

Requirements:

1. Markdown SHALL be rendered
2. Videos SHALL be embedded and playable from the receipt.
`.trim();
  const spec = buildCommandSpec({
    agent,
    model: getModel({ agent, mode: "fast" }),
    prompt,
  });
  const output = await new Deno.Command(spec.command, {
    args: spec.args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: nonInteractiveEnv(),
  }).output();
  return output.code
    ? err(`Failed to update receipts with exit code ${output.code}`)
    : ok(undefined);
};

/**
 * Execute one full cycle of the agentic loop: run the agent, validate
 * the output, and advance the {@link LoopState}.
 */
export const runLoopIteration = async (
  { state, iterationNum, agent, signal, log, plugin }: {
    state: LoopState;
    iterationNum: number;
    agent: Agent;
    signal: AbortSignal;
    log: Logger;
    plugin: Plugin;
  },
): Promise<LoopState> => {
  const phase = (label: string) => {
    const bar = dim("━".repeat(56));
    return `\n${bar}\n  ${bold(label)}\n${bar}`;
  };

  log({
    tags: ["info", "phase"],
    message: phase(
      `${magenta("PHASE 1")} ${cyan("AGENT EXECUTION")} ${
        dim(`(iteration ${iterationNum})`)
      }`,
    ),
  });
  const result: IterationResult = state.task === "build"
    ? await runIteration({
      iterationNum,
      agent,
      signal,
      log,
      validationFailurePath: state.validationFailurePath,
      plugin,
    })
    : { status: "continue" };

  log({
    tags: ["info", "phase"],
    message: phase(
      `${magenta("PHASE 2")} ${yellow("VALIDATION")} ${
        dim(`(iteration ${iterationNum})`)
      }`,
    ),
  });
  const rawValidation: ValidationResult = state.task === "build"
    ? await runValidation({ iterationNum, log })
    : { status: "skip" };

  const ctx: HookContext = { agent, log, iterationNum };
  const validation = plugin.onValidationComplete
    ? await plugin.onValidationComplete({ result: rawValidation, ctx })
    : rawValidation;

  const validationFailurePath = validation.status === "failed"
    ? validation.outputPath
    : undefined;

  const isPriorWorkOk = validation.status === "passed" &&
    result.status === "complete";

  if (!isPriorWorkOk) {
    log({
      tags: ["info", "phase"],
      message: phase(
        `${yellow("ITERATION " + iterationNum)} ${dim("COMPLETE")} ${
          cyan("(continuing)")
        }`,
      ),
    });
    return { validationFailurePath, task: state.task };
  }

  log({
    tags: ["info", "phase"],
    message: phase(
      `${magenta("PHASE 3")} ${green("RECEIPTS")} ${
        dim(`(iteration ${iterationNum})`)
      }`,
    ),
  });
  const receiptsResult = await updateReceipts({ agent });
  log({
    tags: ["info", "phase"],
    message: phase(
      `${yellow("ITERATION " + iterationNum)} ${dim("COMPLETE")} ${
        receiptsResult.ok ? green("(done)") : red("(receipts failed)")
      }`,
    ),
  });
  return receiptsResult.ok
    ? { validationFailurePath, task: "complete" }
    : (log({ tags: ["error"], message: receiptsResult.error }),
      { validationFailurePath, task: "produce_receipts" });
};
