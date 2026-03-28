import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { parseCliArgs } from "../src/cli.ts";

Deno.test("parseCliArgs with valid args", async () => {
  const result = await parseCliArgs(["--iterations", "5", "--agent", "claude"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.agent, "claude");
    assertEquals(result.value.iterations, 5);
    assertEquals(result.value.pluginPath, undefined);
  }
});

Deno.test("parseCliArgs with short flags", async () => {
  const result = await parseCliArgs(["-i", "3", "-a", "codex"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.agent, "codex");
    assertEquals(result.value.iterations, 3);
  }
});

Deno.test("parseCliArgs with default agent", async () => {
  const result = await parseCliArgs(["--iterations", "1"]);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.agent, "claude");
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
  const result = await parseCliArgs(["--agent", "claude"]);
  assertEquals(result.isErr(), true);
});

Deno.test("parseCliArgs invalid agent", async () => {
  const result = await parseCliArgs(["-i", "5", "-a", "gpt"]);
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
