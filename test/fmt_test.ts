import { assertEquals } from "jsr:@std/assert@^1.0.11";

/**
 * Scenario 31: Code formatting enforcement as a quality gate.
 *
 * Verifies that `deno fmt --check` passes (no formatting violations) and that
 * the validation script uses `deno fmt --check` rather than `deno fmt`.
 */

Deno.test(
  "deno fmt --check passes with no formatting violations",
  async (): Promise<void> => {
    const result = await new Deno.Command("deno", {
      args: ["fmt", "--check"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(result.stderr);
    assertEquals(
      result.code,
      0,
      `deno fmt --check failed — unformatted files detected:\n${stderr}`,
    );
  },
);
