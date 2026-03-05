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
