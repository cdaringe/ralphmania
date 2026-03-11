import { assertEquals } from "jsr:@std/assert";
import { loadPlugin, noopPlugin, resolvePlugin } from "./plugin.ts";
import type { Plugin } from "./plugin.ts";
import type { Logger } from "./types.ts";

const testLog: Logger = () => {};

const writeTempPlugin = async (content: string): Promise<string> => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/plugin.ts`;
  await Deno.writeTextFile(path, content);
  return path;
};

// -- resolvePlugin unit tests --

Deno.test("resolvePlugin picks named 'plugin' export", () => {
  const hook: Plugin["onPromptBuilt"] = ({ prompt }) => prompt;
  const mod = { plugin: { onPromptBuilt: hook } };
  const result = resolvePlugin(mod);
  assertEquals(typeof result.onPromptBuilt, "function");
});

Deno.test("resolvePlugin returns empty plugin when no 'plugin' export", () => {
  const mod = { foo: "bar", baz: 42 };
  const result = resolvePlugin(mod);
  assertEquals(result, {});
});

Deno.test("resolvePlugin returns empty plugin for null 'plugin' export", () => {
  const mod = { plugin: null };
  const result = resolvePlugin(mod);
  assertEquals(result, {});
});

// -- loadPlugin integration tests with real plugin files --

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

Deno.test("loadPlugin loads named 'plugin' export from real file", async () => {
  const path = await writeTempPlugin(`
export const plugin = {
  onPromptBuilt({ prompt }) { return prompt + " [named]"; },
};
`);
  const result = await loadPlugin({ pluginPath: path, log: testLog });
  assertEquals(result.ok, true);
  if (result.ok) {
    const modified = result.value.onPromptBuilt?.({
      prompt: "hello",
      selection: {
        model: "x",
        mode: "general",
        targetScenario: undefined,
        effort: undefined,
      },
      ctx: { agent: "claude", log: testLog, iterationNum: 1 },
    });
    assertEquals(modified, "hello [named]");
  }
});

Deno.test("loadPlugin returns empty plugin for module with no 'plugin' export", async () => {
  const path = await writeTempPlugin(`
export const unrelated = "nothing here";
`);
  const result = await loadPlugin({ pluginPath: path, log: testLog });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.onPromptBuilt, undefined);
  }
});
