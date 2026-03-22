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

Deno.test(
  "specification.validate.sh uses deno fmt --check (not bare deno fmt)",
  async (): Promise<void> => {
    const script = await Deno.readTextFile("specification.validate.sh");
    assertEquals(
      script.includes("deno fmt --check"),
      true,
      "specification.validate.sh must invoke 'deno fmt --check'",
    );
    // Bare `deno fmt` (without --check) silently auto-fixes instead of gating.
    const lines = script.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed === "deno fmt" ||
        (trimmed.startsWith("deno fmt ") && !trimmed.includes("--check"))
      ) {
        throw new Error(
          `specification.validate.sh contains '${trimmed}' — use 'deno fmt --check' instead`,
        );
      }
    }
  },
);
