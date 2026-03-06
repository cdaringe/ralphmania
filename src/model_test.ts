import { assertEquals } from "jsr:@std/assert";
import {
  computeModelSelection,
  detectScenarioFromProgress,
  getModel,
  parseImplementedCount,
  parseTotalCount,
} from "./model.ts";

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

// computeModelSelection tests

Deno.test("computeModelSelection below threshold uses general", () => {
  const content = "| 1 | NEEDS_REWORK |";
  const result = computeModelSelection(content, "claude");
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "general");
    assertEquals(result.value.model, "sonnet");
  }
});

Deno.test("computeModelSelection above threshold uses strong", () => {
  const content = "| 1 | NEEDS_REWORK |\n| 2 | NEEDS_REWORK |";
  const result = computeModelSelection(content, "claude");
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "strong");
    assertEquals(result.value.model, "opus");
  }
});

Deno.test("computeModelSelection no rework uses fast", () => {
  const content = "| 1 | COMPLETED |";
  const result = computeModelSelection(content, "codex");
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "fast");
    assertEquals(result.value.model, "gpt-5.1-codex");
    assertEquals(result.value.targetScenario, undefined);
  }
});

Deno.test("computeModelSelection codex above threshold", () => {
  const content = "| 5 | NEEDS_REWORK |\n| 6 | NEEDS_REWORK |";
  const result = computeModelSelection(content, "codex");
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "strong");
    assertEquals(result.value.model, "gpt-5.3-codex");
    assertEquals(result.value.targetScenario, 5);
  }
});
