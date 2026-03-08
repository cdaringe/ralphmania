import { assertEquals } from "jsr:@std/assert";
import { parseCliArgs } from "./cli.ts";

Deno.test("parseCliArgs with valid args", () => {
  const result = parseCliArgs(["--iterations", "5", "--agent", "claude"]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.agent, "claude");
    assertEquals(result.value.iterations, 5);
    assertEquals(result.value.pluginPath, undefined);
  }
});

Deno.test("parseCliArgs with short flags", () => {
  const result = parseCliArgs(["-i", "3", "-a", "codex"]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.agent, "codex");
    assertEquals(result.value.iterations, 3);
  }
});

Deno.test("parseCliArgs with default agent", () => {
  const result = parseCliArgs(["--iterations", "1"]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.agent, "claude");
  }
});

Deno.test("parseCliArgs with plugin path", () => {
  const result = parseCliArgs(["-i", "1", "-p", "./my-plugin.ts"]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.pluginPath, "./my-plugin.ts");
  }
});

Deno.test("parseCliArgs with long plugin flag", () => {
  const result = parseCliArgs(["-i", "1", "--plugin", "./plugin.ts"]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.pluginPath, "./plugin.ts");
  }
});

Deno.test("parseCliArgs missing iterations", () => {
  const result = parseCliArgs(["--agent", "claude"]);
  assertEquals(result.ok, false);
});

Deno.test("parseCliArgs invalid agent", () => {
  const result = parseCliArgs(["-i", "5", "-a", "gpt"]);
  assertEquals(result.ok, false);
});

Deno.test("parseCliArgs iterations < 1", () => {
  const result = parseCliArgs(["-i", "0"]);
  assertEquals(result.ok, false);
});

Deno.test("parseCliArgs negative iterations", () => {
  const result = parseCliArgs(["-i", "-1"]);
  assertEquals(result.ok, false);
});

Deno.test("parseCliArgs with --level", () => {
  const result = parseCliArgs(["-i", "5", "--level", "1"]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.level, 1);
  }
});

Deno.test("parseCliArgs with -l shorthand", () => {
  const result = parseCliArgs(["-i", "5", "-l", "0"]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.level, 0);
  }
});

Deno.test("parseCliArgs level defaults to undefined", () => {
  const result = parseCliArgs(["-i", "5"]);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.level, undefined);
  }
});

Deno.test("parseCliArgs invalid level returns error", () => {
  const result = parseCliArgs(["-i", "5", "-l", "9"]);
  assertEquals(result.ok, false);
});

Deno.test("parseCliArgs level 4 returns error", () => {
  const result = parseCliArgs(["-i", "5", "-l", "4"]);
  assertEquals(result.ok, false);
});

Deno.test("parseCliArgs --help returns usage", () => {
  const result = parseCliArgs(["--help"]);
  assertEquals(result.ok, false);
});

Deno.test("parseCliArgs -h returns usage", () => {
  const result = parseCliArgs(["-h"]);
  assertEquals(result.ok, false);
});
