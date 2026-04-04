import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.11";
import { buildPrompt, buildSessionConfig } from "../src/command.ts";
import { AUTONOMOUS_PROMPT, buildTargetedPrompt } from "../src/constants.ts";

Deno.test("buildPrompt without scenario or actionable", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: [],
  });
  const expected = AUTONOMOUS_PROMPT
    .replaceAll("{SPEC_FILE}", "specification.md")
    .replaceAll("{PROGRESS_FILE}", "progress.md");
  assertEquals(prompt, expected);
});

Deno.test("buildPrompt with target scenario is prescriptive", () => {
  const prompt = buildPrompt({
    targetScenario: "3",
    validationFailurePath: undefined,
    actionableScenarios: ["3", "7"],
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
    targetScenario: "3",
    validationFailurePath: undefined,
    actionableScenarios: ["3"],
  });
  assertStringIncludes(prompt, "Implement scenario 3");
  assertEquals(prompt.includes("Find the next"), false);
});

Deno.test("buildPrompt targeted omits actionable list", () => {
  const prompt = buildPrompt({
    targetScenario: "5",
    validationFailurePath: undefined,
    actionableScenarios: ["5", "12", "20"],
  });
  assertEquals(prompt.includes("Actionable scenarios"), false);
  assertStringIncludes(prompt, "scenario 5");
});

Deno.test("buildPrompt autonomous includes actionable list", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: ["5", "12"],
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
    targetScenario: "2",
    validationFailurePath: "/tmp/out.log",
    actionableScenarios: ["2"],
  });
  assertStringIncludes(prompt, "scenario 2");
  assertStringIncludes(prompt, "VALIDATION FAILED");
  assertStringIncludes(prompt, "/tmp/out.log");
});

Deno.test("buildPrompt uses {SPEC_FILE} and {PROGRESS_FILE} markers", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: [],
  });
  // Default substitution uses specification.md and progress.md
  assertStringIncludes(prompt, "specification.md");
  assertStringIncludes(prompt, "progress.md");
});

Deno.test("buildPrompt uses custom specFile in prompt references", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: [],
    specFile: "docs/my-spec.md",
  });
  assertStringIncludes(prompt, "docs/my-spec.md");
});

Deno.test("buildPrompt uses custom progressFile in prompt references", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: [],
    progressFile: "docs/my-progress.md",
  });
  assertStringIncludes(prompt, "docs/my-progress.md");
});

Deno.test("buildPrompt uses both custom specFile and progressFile", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: [],
    specFile: "custom/spec.md",
    progressFile: "custom/progress.md",
  });
  assertStringIncludes(prompt, "custom/spec.md");
  assertStringIncludes(prompt, "custom/progress.md");
});

Deno.test("buildPrompt keeps defaults when no custom paths given", () => {
  const prompt = buildPrompt({
    targetScenario: undefined,
    validationFailurePath: undefined,
    actionableScenarios: [],
  });
  assertStringIncludes(prompt, "specification.md");
  assertStringIncludes(prompt, "progress.md");
});

Deno.test("buildSessionConfig builds AgentSessionConfig from selection", () => {
  const config = buildSessionConfig({
    selection: {
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250514",
      mode: "coder",
      targetScenario: "1",
      thinkingLevel: "high",
      actionableScenarios: ["1"],
    },
    workingDir: "/tmp/work",
  });
  assertEquals(config.provider, "anthropic");
  assertEquals(config.model, "claude-sonnet-4-5-20250514");
  assertEquals(config.workingDir, "/tmp/work");
  assertEquals(config.thinkingLevel, "high");
});

Deno.test("buildTargetedPrompt includes critique for same scenario", () => {
  const prompt = buildTargetedPrompt("7");
  assertStringIncludes(prompt, "CRITIQUE scenario 7");
});

Deno.test("AUTONOMOUS_PROMPT includes completion marker check", () => {
  assertStringIncludes(AUTONOMOUS_PROMPT, "VERIFIED output");
  assertStringIncludes(AUTONOMOUS_PROMPT, "find the first complete");
});
