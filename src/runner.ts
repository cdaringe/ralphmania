import type {
  Agent,
  EscalationLevel,
  IterationResult,
  Logger,
  LoopState,
  ModelSelection,
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
import { bold, cyan, dim, green, magenta, yellow } from "./colors.ts";

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
          controller.enqueue(encoder.encode(result + "\n"));
        }
      });
    },
    flush(controller) {
      const trimmed = buffer.trim();
      if (!trimmed) return;
      const result = extractNdjsonResult(trimmed);
      if (result !== undefined) {
        controller.enqueue(encoder.encode(result + "\n"));
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
  }: {
    iterationNum: number;
    agent: Agent;
    signal: AbortSignal;
    log: Logger;
    validationFailurePath: string | undefined;
    plugin: Plugin;
    level: EscalationLevel | undefined;
    cwd?: string;
    targetScenarioOverride?: number;
  },
): Promise<IterationResult> => {
  const ctx: HookContext = { agent, log, iterationNum };

  const rawSelection: ModelSelection = targetScenarioOverride !== undefined
    ? {
      model: getModel({ agent, mode: "general" }),
      mode: "general",
      targetScenario: targetScenarioOverride,
      effort: "high",
      actionableScenarios: [targetScenarioOverride],
    }
    : await resolveModelSelection({
      agent,
      log,
      minLevel: level,
    });
  const selection = plugin.onModelSelected
    ? await plugin.onModelSelected({ selection: rawSelection, ctx })
    : rawSelection;

  const rawPrompt = buildPrompt({
    targetScenario: selection.targetScenario,
    validationFailurePath,
    actionableScenarios: selection.actionableScenarios,
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
    message: `Starting ${iterationNum} (${selection.model}${
      selection.effort ? `, effort: ${selection.effort}` : ""
    })...`,
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
      cwd,
      env: {
        ...nonInteractiveEnv(),
        ...(selection.effort
          ? { CLAUDE_CODE_EFFORT_LEVEL: selection.effort }
          : {}),
      },
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

export const updateReceipts = async (
  { agent, plugin, log }: { agent: Agent; plugin: Plugin; log: Logger },
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

/**
 * Execute one full cycle of the agentic loop: run the agent, validate
 * the output, and advance the {@link LoopState}.
 */
export const runLoopIteration = async (
  {
    agent,
    iterationNum,
    level,
    log,
    plugin,
    signal,
    state,
    cwd,
  }: {
    agent: Agent;
    iterationNum: number;
    level: EscalationLevel | undefined;
    log: Logger;
    plugin: Plugin;
    signal: AbortSignal;
    state: LoopState;
    cwd?: string;
  },
): Promise<LoopState> => {
  log({
    tags: ["info", "phase"],
    message: `${magenta("PHASE 1")} ${cyan("AGENT EXECUTION")} ${
      dim(`(iteration ${iterationNum})`)
    }`,
  });
  const result: IterationResult = await runIteration({
    iterationNum,
    agent,
    signal,
    log,
    validationFailurePath: state.validationFailurePath,
    plugin,
    level,
    cwd,
  });

  log({
    tags: ["info", "phase"],
    message: `${magenta("PHASE 2")} ${yellow("VALIDATION")} ${
      dim(`(iteration ${iterationNum})`)
    }`,
  });
  const rawValidation: ValidationResult = await runValidation({
    iterationNum,
    log,
    cwd,
  });

  const ctx: HookContext = { agent, log, iterationNum };
  const validation = plugin.onValidationComplete
    ? await plugin.onValidationComplete({ result: rawValidation, ctx })
    : rawValidation;

  const validationFailurePath = validation.status === "failed"
    ? validation.outputPath
    : undefined;

  const isPriorWorkOk = validation.status === "passed" &&
    result.status === "complete";

  const task = isPriorWorkOk ? "complete" : "build";
  log({
    tags: ["info", "phase"],
    message: `${yellow("ITERATION " + iterationNum)} ${dim("COMPLETE")} ${
      isPriorWorkOk ? green("(done)") : cyan("(continuing)")
    }`,
  });
  return { validationFailurePath, task };
};
