import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  computeModelSelection,
  detectScenarioFromProgress,
  findReworkScenarios,
  getModel,
  parseImplementedCount,
  parseTotalCount,
  updateEscalationState,
  validateProgressStatuses,
} from "../src/model.ts";

// parseImplementedCount tests

Deno.test("parseImplementedCount counts WORK_COMPLETE rows", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1.1 | WORK_COMPLETE | done |",
    "| 1.2 |          |      |",
    "| 1.3 | VERIFIED | yep  |",
  ].join("\n");
  const r = parseImplementedCount(content);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value, 2);
});

Deno.test("parseImplementedCount returns 0 when none implemented", () => {
  const r = parseImplementedCount(
    "| # | Status |\n| -- | -- |\n| 1.1 |          |      |",
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value, 0);
});

// parseTotalCount tests

Deno.test("parseTotalCount counts all scenario rows", () => {
  const content = [
    "| #    | Status |",
    "| ---- | ------ |",
    "| 1.1  | WORK_COMPLETE |",
    "| 1.2  |          |",
  ].join("\n");
  const r = parseTotalCount(content);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value, 2);
});

Deno.test("parseTotalCount excludes OBSOLETE rows", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1.1 | VERIFIED |",
    "| 1.2 | OBSOLETE |",
    "| 1.3 |          |",
  ].join("\n");
  const r = parseTotalCount(content);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value, 2);
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
  const result = detectScenarioFromProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | COMPLETED |",
  );
  assertEquals(result, { ok: true, value: undefined });
});

Deno.test("detectScenarioFromProgress with NEEDS_REWORK", () => {
  const result = detectScenarioFromProgress(
    "| # | Status |\n| -- | -- |\n| 3.1 | NEEDS_REWORK | some notes",
  );
  assertEquals(result, { ok: true, value: "3.1" });
});

Deno.test("detectScenarioFromProgress finds first NEEDS_REWORK", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1.1 | COMPLETED |",
    "| 2.1 | NEEDS_REWORK | fix it",
    "| 3.1 | NEEDS_REWORK | also fix",
  ].join("\n");
  const result = detectScenarioFromProgress(content);
  assertEquals(result, { ok: true, value: "2.1" });
});

Deno.test("detectScenarioFromProgress empty content", () => {
  assertEquals(detectScenarioFromProgress(""), { ok: true, value: undefined });
});

// findReworkScenarios tests

Deno.test("findReworkScenarios finds all rework scenario numbers", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1.1 | WORK_COMPLETE |",
    "| 2.1 | NEEDS_REWORK | fix it |",
    "| 3.1 | VERIFIED |",
    "| 5.1 | NEEDS_REWORK | broken |",
  ].join("\n");
  const r = findReworkScenarios(content);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value, ["2.1", "5.1"]);
});

Deno.test("findReworkScenarios returns empty for no rework", () => {
  const r = findReworkScenarios(
    "| # | Status |\n| -- | -- |\n| 1.1 | WORK_COMPLETE |",
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value, []);
});

Deno.test("findReworkScenarios returns empty for empty content", () => {
  const r = findReworkScenarios("");
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value, []);
});

// updateEscalationState tests

Deno.test("updateEscalationState adds new rework scenarios at level 1", () => {
  const result = updateEscalationState({
    current: {},
    reworkScenarios: ["3.1", "7.2"],
  });
  assertEquals(result, { "3.1": 1, "7.2": 1 });
});

Deno.test("updateEscalationState bumps existing scenarios capped at 1", () => {
  const result = updateEscalationState({
    current: { "3.1": 1, "7.2": 1 },
    reworkScenarios: ["3.1", "7.2"],
  });
  assertEquals(result, { "3.1": 1, "7.2": 1 });
});

Deno.test("updateEscalationState caps at level 1", () => {
  const result = updateEscalationState({
    current: { "3.1": 1 },
    reworkScenarios: ["3.1"],
  });
  assertEquals(result, { "3.1": 1 });
});

Deno.test("updateEscalationState removes cleared scenarios", () => {
  const result = updateEscalationState({
    current: { "3.1": 1, "7.2": 1 },
    reworkScenarios: ["3.1"],
  });
  assertEquals(result, { "3.1": 1 });
});

Deno.test("updateEscalationState handles mix of new, bump, and clear", () => {
  const result = updateEscalationState({
    current: { "1.1": 1, "5.1": 1 },
    reworkScenarios: ["1.1", "9.1"],
  });
  assertEquals(result, { "1.1": 1, "9.1": 1 });
});

// computeModelSelection tests

Deno.test("computeModelSelection claude level 0 coder mode", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |";
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
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | WORK_COMPLETE |";
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
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |";
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
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |";
  const result = computeModelSelection({ content, agent: "codex" });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "general");
    assertEquals(result.value.model, "gpt-5.1-codex-max");
    assertEquals(result.value.effort, undefined);
  }
});

Deno.test("computeModelSelection codex above threshold uses strong", () => {
  const content =
    "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |\n| 1.2 | NEEDS_REWORK |";
  const result = computeModelSelection({ content, agent: "codex" });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "strong");
    assertEquals(result.value.model, "gpt-5.3-codex");
    assertEquals(result.value.effort, undefined);
  }
});

Deno.test("computeModelSelection no rework uses fast", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | COMPLETED |";
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
  const content =
    "| # | Status |\n| -- | -- |\n| 5.1 | NEEDS_REWORK |\n| 5.2 | NEEDS_REWORK |";
  const result = computeModelSelection({ content, agent: "codex" });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "strong");
    assertEquals(result.value.model, "gpt-5.3-codex");
    assertEquals(result.value.targetScenario, "5.1");
    assertEquals(result.value.effort, undefined);
  }
});

// validateProgressStatuses tests

Deno.test("validateProgressStatuses returns empty for all valid statuses", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1.1 | WIP |",
    "| 1.2 | WORK_COMPLETE |",
    "| 1.3 | VERIFIED |",
    "| 1.4 | NEEDS_REWORK |",
    "| 1.5 | OBSOLETE |",
  ].join("\n");
  const r = validateProgressStatuses(content);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value, []);
});

Deno.test("validateProgressStatuses detects invalid statuses", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1.1 | VERIFIED |",
    "| 1.2 | COMPLETE |",
    "| 1.3 | DONE |",
  ].join("\n");
  const r = validateProgressStatuses(content);
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.value, [
      { scenario: "1.2", status: "COMPLETE" },
      { scenario: "1.3", status: "DONE" },
    ]);
  }
});

Deno.test("validateProgressStatuses ignores rows without status", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 |          |";
  const r = validateProgressStatuses(content);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.value, []);
});

Deno.test("computeModelSelection claude without escalation level falls through to codex path", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |";
  const result = computeModelSelection({ content, agent: "claude" });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.mode, "general");
    assertEquals(result.value.model, "sonnet");
    assertEquals(result.value.effort, undefined);
  }
});

// resolveModelSelection tests

import {
  readEscalationState,
  resolveModelSelection,
  writeEscalationState,
} from "../src/model.ts";
import type { Logger } from "../src/types.ts";
import { ESCALATION_FILE } from "../src/constants.ts";
import { noopLog } from "./fixtures.ts";

const writeTempProgress = async (content: string): Promise<string> => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/progress.md`;
  await Deno.writeTextFile(path, `<!-- END_DEMO -->\n${content}`);
  return path;
};

// readEscalationState / writeEscalationState tests

Deno.test("readEscalationState returns {} when file missing", async () => {
  let existed = false;
  try {
    await Deno.rename(ESCALATION_FILE, ESCALATION_FILE + ".bak");
    existed = true;
  } catch { /* file doesn't exist */ }
  try {
    const result = await readEscalationState(noopLog);
    assertEquals(result, {});
  } finally {
    if (existed) {
      await Deno.rename(ESCALATION_FILE + ".bak", ESCALATION_FILE);
    }
  }
});

Deno.test("readEscalationState reads valid state", async () => {
  const original = await Deno.readTextFile(ESCALATION_FILE).catch(() => null);
  try {
    await Deno.mkdir(".ralph", { recursive: true });
    await Deno.writeTextFile(ESCALATION_FILE, '{"3":1}');
    const result = await readEscalationState(noopLog);
    assertEquals(result, { "3": 1 });
  } finally {
    if (original !== null) {
      await Deno.writeTextFile(ESCALATION_FILE, original);
    } else {
      await Deno.remove(ESCALATION_FILE).catch(() => {});
    }
  }
});

Deno.test("writeEscalationState persists state", async () => {
  const original = await Deno.readTextFile(ESCALATION_FILE).catch(() => null);
  try {
    await writeEscalationState({ "5": 1 }, noopLog);
    const content = JSON.parse(await Deno.readTextFile(ESCALATION_FILE));
    assertEquals(content, { "5": 1 });
  } finally {
    if (original !== null) {
      await Deno.writeTextFile(ESCALATION_FILE, original);
    } else {
      await Deno.remove(ESCALATION_FILE).catch(() => {});
    }
  }
});

Deno.test("resolveModelSelection returns defaults for missing file", async () => {
  const result = await resolveModelSelection({
    agent: "claude",
    log: noopLog,
    progressFile: "/tmp/nonexistent-ralph-progress-test.md",
  });
  assertEquals(result.mode, "fast");
});

Deno.test("resolveModelSelection returns defaults for file without END_DEMO", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/progress.md`;
  await Deno.writeTextFile(path, "no sigil here");
  const result = await resolveModelSelection({
    agent: "claude",
    log: noopLog,
    progressFile: path,
  });
  assertEquals(result.mode, "fast");
});

Deno.test("resolveModelSelection claude resolves with rework scenarios", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK | fix |\n| 1.2 | VERIFIED | done |",
  );
  const result = await resolveModelSelection({
    agent: "claude",
    log: noopLog,
    progressFile: path,
    minLevel: 0,
  });
  assertEquals(result.targetScenario, "1.1");
});

Deno.test("resolveModelSelection claude verifier mode", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | WORK_COMPLETE | done |\n| 1.2 | VERIFIED | done |",
  );
  const result = await resolveModelSelection({
    agent: "claude",
    log: noopLog,
    progressFile: path,
    minLevel: 0,
  });
  assertEquals(result.model, "opus");
});

Deno.test("resolveModelSelection claude scopes to actionable scenario", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | VERIFIED | done |\n| 1.2 |          |      |",
  );
  const result = await resolveModelSelection({
    agent: "claude",
    log: noopLog,
    progressFile: path,
    minLevel: 0,
  });
  assertEquals(result.targetScenario, "1.2");
});

Deno.test("resolveModelSelection codex resolves with rework", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK | fix |",
  );
  const result = await resolveModelSelection({
    agent: "codex",
    log: noopLog,
    progressFile: path,
  });
  assertEquals(result.mode, "general");
});

Deno.test("resolveModelSelection codex no rework uses fast", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | VERIFIED | done |",
  );
  const result = await resolveModelSelection({
    agent: "codex",
    log: noopLog,
    progressFile: path,
  });
  assertEquals(result.mode, "fast");
});

Deno.test("resolveModelSelection codex above threshold uses strong", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK | fix |\n| 1.2 | NEEDS_REWORK | fix |",
  );
  const result = await resolveModelSelection({
    agent: "codex",
    log: noopLog,
    progressFile: path,
  });
  assertEquals(result.mode, "strong");
});

Deno.test("resolveModelSelection claude with minLevel 1 escalates", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK | fix |\n| 1.2 | VERIFIED | done |",
  );
  const result = await resolveModelSelection({
    agent: "claude",
    log: noopLog,
    progressFile: path,
    minLevel: 1,
  });
  assertEquals(result.model, "opus");
  assertEquals(result.mode, "strong");
});

Deno.test("resolveModelSelection claude logs status message for rework", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK | fix |",
  );
  const messages: string[] = [];
  const log: Logger = (opts) => {
    messages.push(opts.message);
  };
  await resolveModelSelection({
    agent: "claude",
    log,
    progressFile: path,
    minLevel: 0,
  });
  assertEquals(
    messages.some((m) => m.includes("NEEDS_REWORK")),
    true,
  );
});

Deno.test("resolveModelSelection claude logs status for no rework", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 |          |      |",
  );
  const messages: string[] = [];
  const log: Logger = (opts) => {
    messages.push(opts.message);
  };
  await resolveModelSelection({
    agent: "claude",
    log,
    progressFile: path,
    minLevel: 0,
  });
  assertEquals(
    messages.some((m) => m.includes("implemented")),
    true,
  );
});

Deno.test("resolveModelSelection codex logs status for rework", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK | fix |",
  );
  const messages: string[] = [];
  const log: Logger = (opts) => {
    messages.push(opts.message);
  };
  await resolveModelSelection({
    agent: "codex",
    log,
    progressFile: path,
  });
  assertEquals(
    messages.some((m) => m.includes("NEEDS_REWORK")),
    true,
  );
});

Deno.test("resolveModelSelection codex logs status for no rework", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | VERIFIED | done |",
  );
  const messages: string[] = [];
  const log: Logger = (opts) => {
    messages.push(opts.message);
  };
  await resolveModelSelection({
    agent: "codex",
    log,
    progressFile: path,
  });
  assertEquals(
    messages.some((m) => m.includes("implemented")),
    true,
  );
});
