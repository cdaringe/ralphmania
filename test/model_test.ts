import { assertEquals } from "jsr:@std/assert";
import {
  computeModelSelection,
  detectScenarioFromProgress,
  findReworkScenarios,
  getModel,
  parseImplementedCount,
  parseTotalCount,
  updateEscalationState,
} from "../src/model.ts";

// parseImplementedCount tests

Deno.test("parseImplementedCount counts COMPLETE rows", () => {
  const content = [
    "| 1  | COMPLETE | done |",
    "| 2  |          |      |",
    "| 3  | VERIFIED | yep  |",
  ].join("\n");
  assertEquals(parseImplementedCount(content), 2);
});

Deno.test("parseImplementedCount returns 0 when none implemented", () => {
  assertEquals(parseImplementedCount("| 1  |          |      |"), 0);
});

// parseTotalCount tests

Deno.test("parseTotalCount counts all scenario rows", () => {
  const content = [
    "| #  | Status |",
    "| -- | ------ |",
    "| 1  | COMPLETE |",
    "| 2  |          |",
  ].join("\n");
  assertEquals(parseTotalCount(content), 2);
});

// getModel tests

Deno.test("getModel claude fast", () => {
  assertEquals(getModel({ agent: "claude", mode: "fast" }), "haiku");
});

Deno.test("getModel claude general", () => {
  assertEquals(getModel({ agent: "claude", mode: "general" }), "sonnet");
});

Deno.test("getModel claude strong", () => {
  assertEquals(getModel({ agent: "claude", mode: "strong" }), "opus");
});

Deno.test("getModel codex fast", () => {
  assertEquals(getModel({ agent: "codex", mode: "fast" }), "gpt-5.1-codex");
});

Deno.test("getModel codex general", () => {
  assertEquals(
    getModel({ agent: "codex", mode: "general" }),
    "gpt-5.1-codex-max",
  );
});

Deno.test("getModel codex strong", () => {
  assertEquals(getModel({ agent: "codex", mode: "strong" }), "gpt-5.3-codex");
});

// detectScenarioFromProgress tests

Deno.test("detectScenarioFromProgress without NEEDS_REWORK", () => {
  const result = detectScenarioFromProgress("| 1 | COMPLETED |");
  assertEquals(result, { ok: true, value: undefined });
});

Deno.test("detectScenarioFromProgress with NEEDS_REWORK", () => {
  const result = detectScenarioFromProgress(
    "| 3 | NEEDS_REWORK | some notes",
  );
  assertEquals(result, { ok: true, value: 3 });
});

Deno.test("detectScenarioFromProgress finds first NEEDS_REWORK", () => {
  const content = [
    "| 1 | COMPLETED |",
    "| 2 | NEEDS_REWORK | fix it",
    "| 3 | NEEDS_REWORK | also fix",
  ].join("\n");
  const result = detectScenarioFromProgress(content);
  assertEquals(result, { ok: true, value: 2 });
});

Deno.test("detectScenarioFromProgress empty content", () => {
  assertEquals(detectScenarioFromProgress(""), { ok: true, value: undefined });
});

// findReworkScenarios tests

Deno.test("findReworkScenarios finds all rework scenario numbers", () => {
  const content = [
    "| 1 | COMPLETE |",
    "| 2 | NEEDS_REWORK | fix it |",
    "| 3 | VERIFIED |",
    "| 5 | NEEDS_REWORK | broken |",
  ].join("\n");
  assertEquals(findReworkScenarios(content), [2, 5]);
});

Deno.test("findReworkScenarios returns empty for no rework", () => {
  assertEquals(findReworkScenarios("| 1 | COMPLETE |"), []);
});

Deno.test("findReworkScenarios returns empty for empty content", () => {
  assertEquals(findReworkScenarios(""), []);
});

// updateEscalationState tests

Deno.test("updateEscalationState adds new rework scenarios at level 1", () => {
  const result = updateEscalationState({
    current: {},
    reworkScenarios: [3, 7],
  });
  assertEquals(result, { "3": 1, "7": 1 });
});

Deno.test("updateEscalationState bumps existing scenarios capped at 1", () => {
  const result = updateEscalationState({
    current: { "3": 1, "7": 1 },
    reworkScenarios: [3, 7],
  });
  assertEquals(result, { "3": 1, "7": 1 });
});

Deno.test("updateEscalationState caps at level 1", () => {
  const result = updateEscalationState({
    current: { "3": 1 },
    reworkScenarios: [3],
  });
  assertEquals(result, { "3": 1 });
});

Deno.test("updateEscalationState removes cleared scenarios", () => {
  const result = updateEscalationState({
    current: { "3": 1, "7": 1 },
    reworkScenarios: [3],
  });
  assertEquals(result, { "3": 1 });
});

Deno.test("updateEscalationState handles mix of new, bump, and clear", () => {
  const result = updateEscalationState({
    current: { "1": 1, "5": 1 },
    reworkScenarios: [1, 9],
  });
  assertEquals(result, { "1": 1, "9": 1 });
});

// computeModelSelection tests

Deno.test("computeModelSelection claude level 0 coder mode", () => {
  const content = "| 1 | NEEDS_REWORK |";
  const result = computeModelSelection({
    content,
    agent: "claude",
    escalationLevel: 0,
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.model, "sonnet");
    assertEquals(result.value.mode, "general");
    assertEquals(result.value.effort, "high");
  }
});

Deno.test("computeModelSelection claude level 0 verifier mode", () => {
  const content = "| 1 | COMPLETE |";
  const result = computeModelSelection({
    content,
    agent: "claude",
    escalationLevel: 0,
    isVerifierMode: true,
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.model, "opus");
    assertEquals(result.value.mode, "general");
    assertEquals(result.value.effort, "low");
  }
});

Deno.test("computeModelSelection claude level 1 escalated", () => {
  const content = "| 1 | NEEDS_REWORK |";
  const result = computeModelSelection({
    content,
    agent: "claude",
    escalationLevel: 1,
  });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.model, "opus");
    assertEquals(result.value.mode, "strong");
    assertEquals(result.value.effort, "high");
  }
});

Deno.test("computeModelSelection codex below threshold uses general", () => {
  const content = "| 1 | NEEDS_REWORK |";
  const result = computeModelSelection({ content, agent: "codex" });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "general");
    assertEquals(result.value.model, "gpt-5.1-codex-max");
    assertEquals(result.value.effort, undefined);
  }
});

Deno.test("computeModelSelection codex above threshold uses strong", () => {
  const content = "| 1 | NEEDS_REWORK |\n| 2 | NEEDS_REWORK |";
  const result = computeModelSelection({ content, agent: "codex" });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "strong");
    assertEquals(result.value.model, "gpt-5.3-codex");
    assertEquals(result.value.effort, undefined);
  }
});

Deno.test("computeModelSelection no rework uses fast", () => {
  const content = "| 1 | COMPLETED |";
  const result = computeModelSelection({ content, agent: "codex" });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "fast");
    assertEquals(result.value.model, "gpt-5.1-codex");
    assertEquals(result.value.targetScenario, undefined);
    assertEquals(result.value.effort, undefined);
  }
});

Deno.test("computeModelSelection codex above threshold", () => {
  const content = "| 5 | NEEDS_REWORK |\n| 6 | NEEDS_REWORK |";
  const result = computeModelSelection({ content, agent: "codex" });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "strong");
    assertEquals(result.value.model, "gpt-5.3-codex");
    assertEquals(result.value.targetScenario, 5);
    assertEquals(result.value.effort, undefined);
  }
});

Deno.test("computeModelSelection claude without escalation level falls through to codex path", () => {
  const content = "| 1 | NEEDS_REWORK |";
  const result = computeModelSelection({ content, agent: "claude" });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "general");
    assertEquals(result.value.model, "sonnet");
    assertEquals(result.value.effort, undefined);
  }
});
