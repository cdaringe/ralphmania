#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env
/**
 * Sample usage:
 * deno run -A ralph.mts --iterations 10 --agent codex
 * deno run -A ralph.mts --iterations 10 --agent claude
 */
import type { LoopState } from "./src/types.ts";
import { createLogger } from "./src/logger.ts";
import { parseCliArgs } from "./src/cli.ts";
import { ensureValidationHook } from "./src/validation.ts";
import { runLoopIteration } from "./src/runner.ts";

const main = async (): Promise<number> => {
  const log = createLogger();
  const parsed = parseCliArgs(Deno.args);

  if (!parsed.ok) {
    log({ tags: ["error"], message: parsed.error });
    return 1;
  }

  const { agent, iterations } = parsed.value;
  log({
    tags: ["info"],
    message:
      `Starting ralph loop for ${iterations} iterations with ${agent}...`,
  });

  const shutdownController = new AbortController();
  const onSigint = () => {
    log({
      tags: ["error"],
      message: "Interrupted (ctrl+c again to force exit)",
    });
    shutdownController.abort();
    Deno.removeSignalListener("SIGINT", onSigint);
  };
  Deno.addSignalListener("SIGINT", onSigint);

  const hookResult = await ensureValidationHook(log);
  if (!hookResult.ok) {
    log({ tags: ["error"], message: hookResult.error });
    return 1;
  }

  let state: LoopState = {
    validationFailurePath: undefined,
    task: "build",
  };

  for (let i = 1; i <= iterations; i++) {
    if (shutdownController.signal.aborted) {
      log({ tags: ["error"], message: "Exiting due to signal" });
      return 130;
    }
    state = await runLoopIteration({
      state,
      iterationNum: i,
      agent,
      signal: shutdownController.signal,
      log,
    });
    if (state.task === "complete") break;
  }

  log({
    tags: ["info"],
    message:
      `All ${iterations} iterations completed without completion marker.`,
  });
  return 0;
};

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
