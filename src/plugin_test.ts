import { assertEquals } from "jsr:@std/assert";
import { loadPlugin, noopPlugin } from "./plugin.ts";
import type { Logger } from "./types.ts";

const testLog: Logger = () => {};

Deno.test("loadPlugin returns noop when no path given", async () => {
  const result = await loadPlugin({ pluginPath: undefined, log: testLog });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value, noopPlugin);
  }
});

Deno.test("loadPlugin returns error for invalid path", async () => {
  const result = await loadPlugin({
    pluginPath: "./nonexistent-plugin-abc123.ts",
    log: testLog,
  });
  assertEquals(result.ok, false);
});
