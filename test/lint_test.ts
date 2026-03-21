import { assertEquals, assertExists } from "jsr:@std/assert@^1.0.11";

/**
 * Scenario 30: Strict Deno lint rules as a quality gate.
 *
 * Verifies that deno.json has lint rules configured and that `deno lint`
 * passes with no violations.
 */

Deno.test("deno.json has lint rules configured", async (): Promise<void> => {
  const raw = await Deno.readTextFile("deno.json");
  const config = JSON.parse(raw) as {
    lint?: {
      rules?: {
        tags?: string[];
        include?: string[];
      };
    };
  };
  assertExists(config.lint, "deno.json must have a lint section");
  assertExists(config.lint.rules, "lint section must have rules");
  assertExists(
    config.lint.rules.tags,
    "lint rules must include a tags array",
  );
  assertExists(
    config.lint.rules.include,
    "lint rules must include an include array",
  );
  assertEquals(
    config.lint.rules.tags.includes("recommended"),
    true,
    "lint rules must include the 'recommended' tag",
  );
});

Deno.test("deno.json lint rules include strict type rules", async (): Promise<void> => {
  const raw = await Deno.readTextFile("deno.json");
  const config = JSON.parse(raw) as {
    lint?: { rules?: { include?: string[] } };
  };
  const rules = config.lint?.rules?.include ?? [];
  const required = [
    "explicit-function-return-type",
    "explicit-module-boundary-types",
    "no-non-null-assertion",
  ];
  for (const rule of required) {
    assertEquals(
      rules.includes(rule),
      true,
      `lint rules must include '${rule}'`,
    );
  }
});

Deno.test("deno lint passes with no violations", async (): Promise<void> => {
  const result = await new Deno.Command("deno", {
    args: ["lint"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = new TextDecoder().decode(result.stderr);
  assertEquals(
    result.code,
    0,
    `deno lint failed:\n${stderr}`,
  );
});

Deno.test("specification.validate.sh includes deno lint", async (): Promise<void> => {
  const script = await Deno.readTextFile("specification.validate.sh");
  assertEquals(
    script.includes("deno lint"),
    true,
    "specification.validate.sh must invoke 'deno lint'",
  );
});
