import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.11";
import { buildCommandSpec, buildPrompt } from "../src/command.ts";
import { AUTONOMOUS_PROMPT, buildTargetedPrompt } from "../src/constants.ts";

Deno.test("buildPrompt without scenario or actionable", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: [],
  });
  assertEquals(prompt, AUTONOMOUS_PROMPT);
});

Deno.test("buildPrompt with target scenario is prescriptive", () => {
  const prompt = buildPrompt({
    targetScenario: 3,
    validationFailurePath: undefined,
    actionableScenarios: [3, 7],
  });
  assertStringIncludes(prompt, "Implement scenario 3");
  assertStringIncludes(prompt, "Do NOT work on any other scenario");
  // Should not contain autonomous "find" language
  assertEquals(prompt.includes("Find the next"), false);
  // Actionable list is omitted when target is assigned
  assertEquals(prompt.includes("Actionable scenarios"), false);
});

Deno.test("buildPrompt general mode scopes to targetScenario", () => {
  const prompt = buildPrompt({
    targetScenario: 3,
    validationFailurePath: undefined,
    actionableScenarios: [3],
  });
  assertStringIncludes(prompt, "Implement scenario 3");
  assertEquals(prompt.includes("Find the next"), false);
});

Deno.test("buildPrompt targeted omits actionable list", () => {
  const prompt = buildPrompt({
    targetScenario: 5,
    validationFailurePath: undefined,
    actionableScenarios: [5, 12, 20],
  });
  assertEquals(prompt.includes("Actionable scenarios"), false);
  assertStringIncludes(prompt, "scenario 5");
});

Deno.test("buildPrompt autonomous includes actionable list", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: [5, 12],
  });
  assertStringIncludes(prompt, "Actionable scenarios");
  assertStringIncludes(prompt, "5, 12");
  assertStringIncludes(prompt, "Find the next");
});

Deno.test("buildPrompt with validation failure", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: "/tmp/fail.log",
    actionableScenarios: [],
  });
  assertStringIncludes(prompt, "VALIDATION FAILED");
  assertStringIncludes(prompt, "/tmp/fail.log");
});

Deno.test("buildPrompt with scenario and validation failure", () => {
  const prompt = buildPrompt({
    targetScenario: 2,
    validationFailurePath: "/tmp/out.log",
    actionableScenarios: [2],
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

Deno.test("buildPrompt uses custom specFile in prompt references", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: [],
    specFile: "docs/my-spec.md",
  });
  assertStringIncludes(prompt, "@docs/my-spec.md");
  assertEquals(prompt.includes("@specification.md"), false);
});

Deno.test("buildPrompt uses custom progressFile in prompt references", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: [],
    progressFile: "docs/my-progress.md",
  });
  assertStringIncludes(prompt, "@docs/my-progress.md");
  assertEquals(prompt.includes("@progress.md"), false);
});

Deno.test("buildPrompt uses both custom specFile and progressFile", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: [],
    specFile: "custom/spec.md",
    progressFile: "custom/progress.md",
  });
  assertStringIncludes(prompt, "@custom/spec.md");
  assertStringIncludes(prompt, "@custom/progress.md");
  assertEquals(prompt.includes("@specification.md"), false);
  assertEquals(prompt.includes("@progress.md"), false);
});

Deno.test("buildPrompt keeps defaults when no custom paths given", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: [],
  });
  assertStringIncludes(prompt, "@specification.md");
  assertStringIncludes(prompt, "@progress.md");
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

Deno.test("buildTargetedPrompt includes critique for same scenario", () => {
  const prompt = buildTargetedPrompt(7);
  assertStringIncludes(prompt, "CRITIQUE scenario 7");
});

Deno.test("AUTONOMOUS_PROMPT includes completion marker check", () => {
  assertStringIncludes(AUTONOMOUS_PROMPT, "VERIFIED output");
  assertStringIncludes(AUTONOMOUS_PROMPT, "find the first complete");
});
