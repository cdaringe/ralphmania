import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { computeModelSelection, resolveModelSelection } from "../src/model.ts";
import type { Logger } from "../src/types.ts";
import { DEFAULT_MODEL_LADDER } from "../src/constants.ts";
import { noopLog } from "./fixtures.ts";

// computeModelSelection tests

Deno.test("computeModelSelection level 0 coder mode", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |";
  const result = computeModelSelection({
    content,
    ladder: DEFAULT_MODEL_LADDER,
    escalationLevel: 0,
  });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.model, DEFAULT_MODEL_LADDER.coder.model);
    assertEquals(result.value.mode, "coder");
    assertEquals(
      result.value.thinkingLevel,
      DEFAULT_MODEL_LADDER.coder.thinkingLevel,
    );
  }
});

Deno.test("computeModelSelection level 0 verifier mode", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | WORK_COMPLETE |";
  const result = computeModelSelection({
    content,
    ladder: DEFAULT_MODEL_LADDER,
    escalationLevel: 0,
    isVerifierMode: true,
  });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.model, DEFAULT_MODEL_LADDER.verifier.model);
    assertEquals(result.value.mode, "verifier");
    assertEquals(
      result.value.thinkingLevel,
      DEFAULT_MODEL_LADDER.verifier.thinkingLevel,
    );
  }
});

Deno.test("computeModelSelection level 1 escalated", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |";
  const result = computeModelSelection({
    content,
    ladder: DEFAULT_MODEL_LADDER,
    escalationLevel: 1,
  });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.model, DEFAULT_MODEL_LADDER.escalated.model);
    assertEquals(result.value.mode, "escalated");
    assertEquals(
      result.value.thinkingLevel,
      DEFAULT_MODEL_LADDER.escalated.thinkingLevel,
    );
  }
});

Deno.test("computeModelSelection without escalation level uses rework heuristic", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |";
  const result = computeModelSelection({
    content,
    ladder: DEFAULT_MODEL_LADDER,
  });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    // rework present → escalated
    assertEquals(result.value.mode, "escalated");
    assertEquals(result.value.model, DEFAULT_MODEL_LADDER.escalated.model);
  }
});

Deno.test("computeModelSelection no rework uses coder", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | COMPLETED |";
  const result = computeModelSelection({
    content,
    ladder: DEFAULT_MODEL_LADDER,
  });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.mode, "coder");
    assertEquals(result.value.model, DEFAULT_MODEL_LADDER.coder.model);
    assertEquals(result.value.targetScenario, undefined);
  }
});

Deno.test("computeModelSelection includes provider field", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK |";
  const result = computeModelSelection({
    content,
    ladder: DEFAULT_MODEL_LADDER,
    escalationLevel: 0,
  });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.provider, "anthropic");
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
    ladder: DEFAULT_MODEL_LADDER,
    log: noopLog,
    progressFile: "/tmp/nonexistent-ralph-progress-test.md",
  });
  assertEquals(result.mode, "coder");
});

Deno.test("resolveModelSelection returns defaults for file without END_DEMO", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/progress.md`;
  await Deno.writeTextFile(path, "no sigil here");
  const result = await resolveModelSelection({
    ladder: DEFAULT_MODEL_LADDER,
    log: noopLog,
    progressFile: path,
  });
  assertEquals(result.mode, "coder");
});

Deno.test("resolveModelSelection resolves with rework scenarios", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK | fix |\n| 1.2 | VERIFIED | done |",
  );
  const result = await resolveModelSelection({
    ladder: DEFAULT_MODEL_LADDER,
    log: noopLog,
    progressFile: path,
    minLevel: 0,
  });
  assertEquals(result.targetScenario, "1.1");
});

Deno.test("resolveModelSelection verifier mode", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | WORK_COMPLETE | done |\n| 1.2 | VERIFIED | done |",
  );
  const result = await resolveModelSelection({
    ladder: DEFAULT_MODEL_LADDER,
    log: noopLog,
    progressFile: path,
    minLevel: 0,
  });
  assertEquals(result.model, DEFAULT_MODEL_LADDER.verifier.model);
});

Deno.test("resolveModelSelection scopes to actionable scenario", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | VERIFIED | done |\n| 1.2 |          |      |",
  );
  const result = await resolveModelSelection({
    ladder: DEFAULT_MODEL_LADDER,
    log: noopLog,
    progressFile: path,
    minLevel: 0,
  });
  assertEquals(result.targetScenario, "1.2");
});

Deno.test("resolveModelSelection with minLevel 1 escalates", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK | fix |\n| 1.2 | VERIFIED | done |",
  );
  const result = await resolveModelSelection({
    ladder: DEFAULT_MODEL_LADDER,
    log: noopLog,
    progressFile: path,
    minLevel: 1,
  });
  assertEquals(result.model, DEFAULT_MODEL_LADDER.escalated.model);
  assertEquals(result.mode, "escalated");
});

Deno.test("resolveModelSelection logs status message for rework", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | NEEDS_REWORK | fix |",
  );
  const messages: string[] = [];
  const log: Logger = (opts) => {
    messages.push(opts.message);
  };
  await resolveModelSelection({
    ladder: DEFAULT_MODEL_LADDER,
    log,
    progressFile: path,
    minLevel: 0,
  });
  assertEquals(
    messages.some((m) => m.includes("NEEDS_REWORK")),
    true,
  );
});

Deno.test("resolveModelSelection logs status for no rework", async () => {
  const path = await writeTempProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 |          |      |",
  );
  const messages: string[] = [];
  const log: Logger = (opts) => {
    messages.push(opts.message);
  };
  await resolveModelSelection({
    ladder: DEFAULT_MODEL_LADDER,
    log,
    progressFile: path,
    minLevel: 0,
  });
  assertEquals(
    messages.some((m) => m.includes("implemented")),
    true,
  );
});
