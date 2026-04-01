import type { Logger, Result, ValidationResult } from "./types.ts";
import type { ValidationHookDeps } from "./ports/types.ts";
import { defaultValidationHookDeps } from "./ports/impl.ts";
import { err, ok } from "./types.ts";
import {
  nonInteractiveEnv,
  RALPH_OUTPUT_FILE_VAR,
  VALIDATE_OUTPUT_DIR,
  VALIDATE_SCRIPT,
  VALIDATE_TEMPLATE,
} from "./constants.ts";

export const ensureValidationHook = async (
  log: Logger,
  deps: ValidationHookDeps = defaultValidationHookDeps,
): Promise<Result<void, string>> => {
  try {
    if (await deps.exists(VALIDATE_SCRIPT)) return ok(undefined);

    await deps.writeTextFile(VALIDATE_SCRIPT, VALIDATE_TEMPLATE);
    await deps.chmod(VALIDATE_SCRIPT, 0o755);
    log({
      tags: ["info", "hook"],
      message:
        `Created ${VALIDATE_SCRIPT}. Fill in your validation logic and re-run.`,
    });
    return err(
      `${VALIDATE_SCRIPT} created — fill in validation logic before re-running.`,
    );
  } catch (error) {
    return err(`Failed to ensure validation hook: ${error}`);
  }
};

export const runValidation = async ({ iterationNum, log, cwd }: {
  iterationNum: number;
  log: Logger;
  cwd?: string;
}): Promise<ValidationResult> => {
  const outputDir = cwd ? `${cwd}/${VALIDATE_OUTPUT_DIR}` : VALIDATE_OUTPUT_DIR;
  await Deno.mkdir(outputDir, { recursive: true });
  const outputPath = `${outputDir}/iteration-${iterationNum}.log`;
  const file = await Deno.open(outputPath, {
    write: true,
    create: true,
    truncate: true,
  });

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stripAnsi = (text: string): string =>
    // deno-lint-ignore no-control-regex
    text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

  const tee = (dest: typeof Deno.stdout) =>
    new WritableStream<Uint8Array>({
      write(chunk: Uint8Array): void {
        dest.writeSync(chunk);
        file.writeSync(encoder.encode(stripAnsi(decoder.decode(chunk))));
      },
    });

  const tmpOutputPath = await Deno.makeTempFile({
    prefix: "ralph-validate-",
    suffix: ".log",
  });

  try {
    const child = new Deno.Command("bash", {
      args: [VALIDATE_SCRIPT],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      cwd,
      env: { ...nonInteractiveEnv(), [RALPH_OUTPUT_FILE_VAR]: tmpOutputPath },
    }).spawn();

    await Promise.all([
      child.stdout.pipeTo(tee(Deno.stdout)),
      child.stderr.pipeTo(tee(Deno.stderr)),
    ]);
    const { code } = await child.status;

    // If the script wrote to the tmp file, use it instead of the stdio capture.
    const tmpContent = await Deno.readTextFile(tmpOutputPath).catch(() => "");
    file.close();
    if (tmpContent.trim().length > 0) {
      await Deno.writeTextFile(outputPath, stripAnsi(tmpContent));
    }

    await Deno.remove(tmpOutputPath).catch(() => {});

    return code === 0
      ? (log({
        tags: ["info", "validate"],
        message: `Validation passed (iteration ${iterationNum})`,
      }),
        { status: "passed" })
      : (log({
        tags: ["error", "validate"],
        message:
          `Validation failed (iteration ${iterationNum}), see ${outputPath}`,
      }),
        { status: "failed", outputPath });
  } catch (error) {
    /* c8 ignore start — defensive crash handler */
    file.close();
    await Deno.remove(tmpOutputPath).catch(() => {});
    log({
      tags: ["error", "validate"],
      message: `Validation crashed (iteration ${iterationNum}): ${error}`,
    });
    return { status: "failed", outputPath };
  } /* c8 ignore stop */
};
