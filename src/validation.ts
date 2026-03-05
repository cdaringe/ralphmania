import type { Logger, Result, ValidationResult } from "./types.ts";
import { err, ok } from "./types.ts";
import {
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
  const decoder = new TextDecoder();

  const output = await new Deno.Command("bash", {
    args: [VALIDATE_SCRIPT],
    stdout: "piped",
    stderr: "piped",
  }).output();

  const content = [
    "--- stdout ---",
    decoder.decode(output.stdout),
    "--- stderr ---",
    decoder.decode(output.stderr),
    `--- exit code: ${output.code} ---`,
  ].join("\n");
  await Deno.writeTextFile(outputPath, content);

  return output.code === 0
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
