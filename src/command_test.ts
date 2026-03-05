import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { buildCommandSpec, buildPrompt } from "./command.ts";
import { BASE_PROMPT } from "./constants.ts";

Deno.test("buildPrompt general mode without scenario", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    mode: "general",
    validationFailurePath: undefined,
  });
  assertEquals(prompt, BASE_PROMPT);
});

Deno.test("buildPrompt strong mode with scenario", () => {
  const prompt = buildPrompt({
    targetScenario: 3,
    mode: "strong",
    validationFailurePath: undefined,
  });
  assertStringIncludes(prompt, "scenario 3");
  assertStringIncludes(prompt, "ACTUALLY");
});

Deno.test("buildPrompt general mode ignores targetScenario", () => {
  const prompt = buildPrompt({
    targetScenario: 3,
    mode: "general",
    validationFailurePath: undefined,
  });
  assertEquals(prompt, BASE_PROMPT);
});

Deno.test("buildPrompt with validation failure", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    mode: "general",
    validationFailurePath: "/tmp/fail.log",
  });
  assertStringIncludes(prompt, "VALIDATION FAILED");
  assertStringIncludes(prompt, "/tmp/fail.log");
});

Deno.test("buildPrompt strong mode with scenario and validation failure", () => {
  const prompt = buildPrompt({
    targetScenario: 2,
    mode: "strong",
    validationFailurePath: "/tmp/out.log",
  });
  assertStringIncludes(prompt, "scenario 2");
  assertStringIncludes(prompt, "VALIDATION FAILED");
  assertStringIncludes(prompt, "/tmp/out.log");
});

Deno.test("buildCommandSpec claude", () => {
  const spec = buildCommandSpec({
    agent: "claude",
    model: "sonnet",
    prompt: "test prompt",
  });
  assertEquals(spec.command, "claude");
  assertStringIncludes(spec.args.join(" "), "--model");
  assertStringIncludes(spec.args.join(" "), "sonnet");
  assertStringIncludes(spec.args.join(" "), "test prompt");
});

Deno.test("buildCommandSpec codex", () => {
  const spec = buildCommandSpec({
    agent: "codex",
    model: "gpt-5.1-codex",
    prompt: "test prompt",
  });
  assertEquals(spec.command, "codex");
  assertStringIncludes(spec.args.join(" "), "exec");
  assertStringIncludes(spec.args.join(" "), "gpt-5.1-codex");
  assertStringIncludes(spec.args.join(" "), "test prompt");
});
