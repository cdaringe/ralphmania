import { assertEquals } from "jsr:@std/assert";
import { runValidation } from "./validation.ts";
import { RALPH_OUTPUT_FILE_VAR, VALIDATE_SCRIPT } from "./constants.ts";

const noop = () => {};

/**
 * Set up a temp directory with a validation script, run validation, and clean up.
 */
async function withValidationScript(
  scriptBody: string,
  fn: (cwd: string) => Promise<void>,
): Promise<void> {
  const cwd = await Deno.makeTempDir({ prefix: "ralph-test-" });
  const scriptPath = `${cwd}/${VALIDATE_SCRIPT}`;
  await Deno.writeTextFile(scriptPath, `#!/usr/bin/env bash\n${scriptBody}`);
  await Deno.chmod(scriptPath, 0o755);
  try {
    await fn(cwd);
  } finally {
    await Deno.remove(cwd, { recursive: true }).catch(() => {});
  }
}

Deno.test(
  "runValidation: uses stdio capture when RALPH_OUTPUT_FILE is not written",
  async () => {
    await withValidationScript(`echo "stdio output"\nexit 1`, async (cwd) => {
      const result = await runValidation({ iterationNum: 1, log: noop, cwd });
      assertEquals(result.status, "failed");
      if (result.status === "failed") {
        const log = await Deno.readTextFile(result.outputPath);
        assertEquals(log.includes("stdio output"), true);
      }
    });
  },
);

Deno.test(
  "runValidation: uses RALPH_OUTPUT_FILE content when script writes to it",
  async () => {
    const script = `echo "this is in stdio"\necho "custom output" > "$${RALPH_OUTPUT_FILE_VAR}"\nexit 1`;
    await withValidationScript(script, async (cwd) => {
      const result = await runValidation({ iterationNum: 1, log: noop, cwd });
      assertEquals(result.status, "failed");
      if (result.status === "failed") {
        const log = await Deno.readTextFile(result.outputPath);
        // The tmp file content should replace the stdio capture
        assertEquals(log.includes("custom output"), true);
        // stdio content should NOT be in the log
        assertEquals(log.includes("this is in stdio"), false);
      }
    });
  },
);

Deno.test(
  "runValidation: passes when script exits 0 and writes to RALPH_OUTPUT_FILE",
  async () => {
    const script =
      `echo "custom pass output" > "$${RALPH_OUTPUT_FILE_VAR}"\nexit 0`;
    await withValidationScript(script, async (cwd) => {
      const result = await runValidation({ iterationNum: 1, log: noop, cwd });
      assertEquals(result.status, "passed");
    });
  },
);

Deno.test(
  "runValidation: strips ANSI codes from RALPH_OUTPUT_FILE content",
  async () => {
    // Write ANSI escape codes to the output file
    const script =
      `printf '\\033[31mred text\\033[0m' > "$${RALPH_OUTPUT_FILE_VAR}"\nexit 1`;
    await withValidationScript(script, async (cwd) => {
      const result = await runValidation({ iterationNum: 1, log: noop, cwd });
      assertEquals(result.status, "failed");
      if (result.status === "failed") {
        const log = await Deno.readTextFile(result.outputPath);
        assertEquals(log.includes("red text"), true);
        // Should not contain ANSI escape sequences
        assertEquals(/\x1b\[/.test(log), false);
      }
    });
  },
);
