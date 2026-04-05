import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { parseCliArgs } from "../src/cli.ts";
import { DEFAULT_MODEL_LADDER } from "../src/constants.ts";

Deno.test("parseCliArgs with valid args", async () => {
  const result = await parseCliArgs(["--iterations", "5"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.ladder, DEFAULT_MODEL_LADDER);
    assertEquals(result.value.iterations, 5);
    assertEquals(result.value.pluginPath, undefined);
  }
});

Deno.test("parseCliArgs with short flags", async () => {
  const result = await parseCliArgs(["-i", "3"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.iterations, 3);
    assertEquals(result.value.ladder, DEFAULT_MODEL_LADDER);
  }
});

Deno.test("parseCliArgs with default ladder", async () => {
  const result = await parseCliArgs(["--iterations", "1"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.ladder.coder.provider, "anthropic");
    assertEquals(
      result.value.ladder.coder.model,
      DEFAULT_MODEL_LADDER.coder.model,
    );
    assertEquals(
      result.value.ladder.verifier.model,
      DEFAULT_MODEL_LADDER.verifier.model,
    );
    assertEquals(
      result.value.ladder.escalated.model,
      DEFAULT_MODEL_LADDER.escalated.model,
    );
  }
});

Deno.test("parseCliArgs with --coder override", async () => {
  const result = await parseCliArgs(["-i", "1", "--coder", "openai/gpt-4o"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.ladder.coder.provider, "openai");
    assertEquals(result.value.ladder.coder.model, "gpt-4o");
    // Other roles stay at defaults
    assertEquals(
      result.value.ladder.verifier.model,
      DEFAULT_MODEL_LADDER.verifier.model,
    );
    assertEquals(
      result.value.ladder.escalated.model,
      DEFAULT_MODEL_LADDER.escalated.model,
    );
  }
});

Deno.test("parseCliArgs with colon-form --coder override", async () => {
  const result = await parseCliArgs([
    "-i",
    "1",
    "--coder",
    "groq:llama-3.3-70b-versatile",
  ]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.ladder.coder.provider, "groq");
    assertEquals(result.value.ladder.coder.model, "llama-3.3-70b-versatile");
  }
});

Deno.test("parseCliArgs with unknown provider returns error", async () => {
  const result = await parseCliArgs(["-i", "1", "--coder", "ollama:gemma:4eb"]);
  assertEquals(result.isErr(), true);
});

Deno.test("parseCliArgs with --verifier override", async () => {
  const result = await parseCliArgs(["-i", "1", "--verifier", "openai/gpt-4o"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.ladder.verifier.provider, "openai");
    assertEquals(result.value.ladder.verifier.model, "gpt-4o");
  }
});

Deno.test("parseCliArgs with --escalated override", async () => {
  const result = await parseCliArgs(["-i", "1", "--escalated", "openai/o1"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.ladder.escalated.provider, "openai");
    assertEquals(result.value.ladder.escalated.model, "o1");
  }
});

Deno.test("parseCliArgs with plugin path", async () => {
  const result = await parseCliArgs(["-i", "1", "-p", "./my-plugin.ts"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.pluginPath, "./my-plugin.ts");
  }
});

Deno.test("parseCliArgs with long plugin flag", async () => {
  const result = await parseCliArgs(["-i", "1", "--plugin", "./plugin.ts"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.pluginPath, "./plugin.ts");
  }
});

Deno.test("parseCliArgs missing iterations", async () => {
  const result = await parseCliArgs([]);
  assertEquals(result.isErr(), true);
});

Deno.test("parseCliArgs iterations < 1", async () => {
  const result = await parseCliArgs(["-i", "0"]);
  assertEquals(result.isErr(), true);
});

Deno.test("parseCliArgs negative iterations", async () => {
  const result = await parseCliArgs(["-i", "-1"]);
  assertEquals(result.isErr(), true);
});

Deno.test("parseCliArgs with --level", async () => {
  const result = await parseCliArgs(["-i", "5", "--level", "1"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.level, 1);
  }
});

Deno.test("parseCliArgs with -l shorthand", async () => {
  const result = await parseCliArgs(["-i", "5", "-l", "0"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.level, 0);
  }
});

Deno.test("parseCliArgs level defaults to undefined", async () => {
  const result = await parseCliArgs(["-i", "5"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.level, undefined);
  }
});

Deno.test("parseCliArgs invalid level returns error", async () => {
  const result = await parseCliArgs(["-i", "5", "-l", "9"]);
  assertEquals(result.isErr(), true);
});

Deno.test("parseCliArgs level 4 returns error", async () => {
  const result = await parseCliArgs(["-i", "5", "-l", "4"]);
  assertEquals(result.isErr(), true);
});

Deno.test("parseCliArgs --help returns error", async () => {
  const result = await parseCliArgs(["--help"]);
  assertEquals(result.isErr(), true);
});

Deno.test("parseCliArgs -h returns error", async () => {
  const result = await parseCliArgs(["-h"]);
  assertEquals(result.isErr(), true);
});

Deno.test("parseCliArgs default parallel is 2", async () => {
  const result = await parseCliArgs(["-i", "5"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.parallel, 2);
  }
});

Deno.test("parseCliArgs custom parallel", async () => {
  const result = await parseCliArgs(["-i", "5", "-P", "4"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.parallel, 4);
  }
});

Deno.test("parseCliArgs gui defaults to false", async () => {
  const result = await parseCliArgs(["-i", "5"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.gui, false);
  }
});

Deno.test("parseCliArgs --gui enables gui", async () => {
  const result = await parseCliArgs(["-i", "5", "--gui"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.gui, true);
  }
});

Deno.test("parseCliArgs guiPort defaults to 8420", async () => {
  const result = await parseCliArgs(["-i", "5"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.guiPort, 8420);
  }
});

Deno.test("parseCliArgs --gui-port sets custom port", async () => {
  const result = await parseCliArgs(["-i", "5", "--gui-port", "9999"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.guiPort, 9999);
  }
});

Deno.test("parseCliArgs resetWorktrees defaults to false", async () => {
  const result = await parseCliArgs(["-i", "5"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.resetWorktrees, false);
  }
});

Deno.test("parseCliArgs --reset-worktrees sets resetWorktrees to true", async () => {
  const result = await parseCliArgs(["-i", "5", "--reset-worktrees"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.resetWorktrees, true);
  }
});

Deno.test("parseCliArgs invalid coder spec returns error", async () => {
  const result = await parseCliArgs(["-i", "5", "--coder", "no-slash"]);
  assertEquals(result.isErr(), true);
});
