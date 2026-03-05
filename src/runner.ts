import type { Agent, IterationResult, Logger, LoopState, Result, ValidationResult } from "./types.ts";
import { err, ok } from "./types.ts";
import { COMPLETION_MARKER, RALPH_RECEIPTS_DIRNAME, TIMEOUT_MS } from "./constants.ts";
import { getModel, resolveModelSelection } from "./model.ts";
import { buildCommandSpec, buildPrompt } from "./command.ts";
import { runValidation } from "./validation.ts";

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
  { iterationNum, agent, signal, log, validationFailurePath }: {
    iterationNum: number;
    agent: Agent;
    signal: AbortSignal;
    log: Logger;
    validationFailurePath: string | undefined;
  },
): Promise<IterationResult> => {
  const { model, mode, targetScenario } = await resolveModelSelection(
    agent,
    log,
  );
  const prompt = buildPrompt({
    targetScenario,
    mode,
    validationFailurePath,
  });
  const spec = buildCommandSpec({ agent, model, prompt });

  log({
    tags: ["info", "iteration"],
    message: `Starting ${iterationNum} (${model})...`,
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
      signal: combinedSignal,
    }).spawn();

    const [status, foundAllCompleteSigil] = await Promise.all([
      child.status,
      pipeStream({
        stream: child.stdout,
        output: Deno.stdout,
        marker: COMPLETION_MARKER,
      }),
      pipeStream({ stream: child.stderr, output: Deno.stderr }),
    ]);

    return status.code !== 0
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
    stdout: "piped",
    stderr: "piped",
  }).output();
  return output.code
    ? err(`Failed to update receipts with exit code ${output.code}`)
    : ok(undefined);
};

export const runLoopIteration = async (
  { state, iterationNum, agent, signal, log }: {
    state: LoopState;
    iterationNum: number;
    agent: Agent;
    signal: AbortSignal;
    log: Logger;
  },
): Promise<LoopState> => {
  const result: IterationResult = state.task === "build"
    ? await runIteration({
      iterationNum,
      agent,
      signal,
      log,
      validationFailurePath: state.validationFailurePath,
    })
    : { status: "continue" };

  const validation: ValidationResult = state.task === "build"
    ? await runValidation({ iterationNum, log })
    : { status: "skip" };

  const validationFailurePath = validation.status === "failed"
    ? validation.outputPath
    : undefined;

  const isPriorWorkOk = validation.status === "passed" &&
    result.status === "complete";

  if (!isPriorWorkOk) {
    return { validationFailurePath, task: state.task };
  }

  const receiptsResult = await updateReceipts({ agent });
  return receiptsResult.ok
    ? { validationFailurePath, task: "complete" }
    : (log({ tags: ["error"], message: receiptsResult.error }),
      { validationFailurePath, task: "produce_receipts" });
};
