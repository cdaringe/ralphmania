import type { Logger, Result, ValidationResult } from "./types.ts";
import { err, ok } from "./types.ts";
import {
  nonInteractiveEnv,
  VALIDATE_OUTPUT_DIR,
  VALIDATE_SCRIPT,
  VALIDATE_TEMPLATE,
} from "./constants.ts";

export const ensureValidationHook = async (
  log: Logger,
): Promise<Result<void, string>> => {
  const exists = await Deno.stat(VALIDATE_SCRIPT).then(() => true, () => false);
  if (exists) return ok(undefined);

  await Deno.writeTextFile(VALIDATE_SCRIPT, VALIDATE_TEMPLATE);
  await Deno.chmod(VALIDATE_SCRIPT, 0o755);
  log({
    tags: ["info", "hook"],
    message:
      `Created ${VALIDATE_SCRIPT}. Fill in your validation logic and re-run.`,
  });
  return err(
    `${VALIDATE_SCRIPT} created — fill in validation logic before re-running.`,
  );
};

export const runValidation = async ({ iterationNum, log }: {
  iterationNum: number;
  log: Logger;
}): Promise<ValidationResult> => {
  await Deno.mkdir(VALIDATE_OUTPUT_DIR, { recursive: true });
  const outputPath = `${VALIDATE_OUTPUT_DIR}/iteration-${iterationNum}.log`;
  const file = await Deno.open(outputPath, {
    write: true,
    create: true,
    truncate: true,
  });

  const tee = (dest: typeof Deno.stdout) =>
    new WritableStream<Uint8Array>({
      write(chunk) {
        dest.writeSync(chunk);
        file.writeSync(chunk);
      },
    });

  const child = new Deno.Command("bash", {
    args: [VALIDATE_SCRIPT],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: nonInteractiveEnv(),
  }).spawn();

  await Promise.all([
    child.stdout.pipeTo(tee(Deno.stdout)),
    child.stderr.pipeTo(tee(Deno.stderr)),
  ]);
  const { code } = await child.status;
  file.close();

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
};
