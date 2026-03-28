import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  computeModelSelection,
  getModel,
  resolveModelSelection,
} from "../src/model.ts";
import type { Logger } from "../src/types.ts";
import { noopLog } from "./fixtures.ts";

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

// computeModelSelection tests

Deno.test("computeModelSelection claude level 0 coder mode", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |";
  const result = computeModelSelection({
    content,
    agent: "claude",
    escalationLevel: 0,
  });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
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
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
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
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.model, "opus");
    assertEquals(result.value.mode, "strong");
    assertEquals(result.value.effort, "high");
  }
});

Deno.test("computeModelSelection codex below threshold uses general", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |";
  const result = computeModelSelection({ content, agent: "codex" });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.mode, "general");
    assertEquals(result.value.model, "gpt-5.1-codex-max");
    assertEquals(result.value.effort, undefined);
  }
});

Deno.test("computeModelSelection codex above threshold uses strong", () => {
  const content =
    "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |\n| 1.2 | NEEDS_REWORK |";
  const result = computeModelSelection({ content, agent: "codex" });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.mode, "strong");
    assertEquals(result.value.model, "gpt-5.3-codex");
    assertEquals(result.value.effort, undefined);
  }
});

Deno.test("computeModelSelection no rework uses fast", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | COMPLETED |";
  const result = computeModelSelection({ content, agent: "codex" });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
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
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.mode, "strong");
    assertEquals(result.value.model, "gpt-5.3-codex");
    assertEquals(result.value.targetScenario, "5.1");
    assertEquals(result.value.effort, undefined);
  }
});

Deno.test("computeModelSelection claude without escalation level falls through to codex path", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |";
  const result = computeModelSelection({ content, agent: "claude" });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.mode, "general");
    assertEquals(result.value.model, "sonnet");
    assertEquals(result.value.effort, undefined);
  }
});

// resolveModelSelection tests

const writeTempProgress = async (content: string): Promise<string> => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/progress.md`;
  await Deno.writeTextFile(path, `<!-- END_DEMO -->\n${content}`);
  return path;
};

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
