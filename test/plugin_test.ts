import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { loadPlugin, noopPlugin, resolvePlugin } from "../src/plugin.ts";
import type { Plugin } from "../src/plugin.ts";
import type { Logger } from "../src/types.ts";
import { DEFAULT_MODEL_LADDER } from "../src/constants.ts";

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
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value, noopPlugin);
  }
});

Deno.test("loadPlugin returns error for invalid path", async () => {
  const result = await loadPlugin({
    pluginPath: "./nonexistent-plugin-abc123.ts",
    log: testLog,
  });
  assertEquals(result.isErr(), true);
});

Deno.test("loadPlugin loads named 'plugin' export from real file", async () => {
  const path = await writeTempPlugin(`
export const plugin = {
  onPromptBuilt({ prompt }) { return prompt + " [named]"; },
};
`);
  const result = await loadPlugin({ pluginPath: path, log: testLog });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    const modified = result.value.onPromptBuilt?.({
      prompt: "hello",
      selection: {
        provider: "anthropic",
        model: "test-model",
        mode: "coder",
        targetScenario: undefined,
        thinkingLevel: undefined,
        actionableScenarios: [],
      },
      ctx: { ladder: DEFAULT_MODEL_LADDER, log: testLog, iterationNum: 1 },
    });
    assertEquals(modified, "hello [named]");
  }
});

Deno.test("loadPlugin returns empty plugin for module with no 'plugin' export", async () => {
  const path = await writeTempPlugin(`
export const unrelated = "nothing here";
`);
  const result = await loadPlugin({ pluginPath: path, log: testLog });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value.onPromptBuilt, undefined);
  }
});

Deno.test("loadPlugin loads plugin from file:// URL", async () => {
  const path = await writeTempPlugin(`
export const plugin = {
  onPromptBuilt({ prompt }) { return prompt + " [url]"; },
};
`);
  const fileUrl = `file://${path}`;
  const result = await loadPlugin({ pluginPath: fileUrl, log: testLog });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(typeof result.value.onPromptBuilt, "function");
  }
});

const defaultConfigOpts = {
  ladder: DEFAULT_MODEL_LADDER,
  iterations: 5,
  level: undefined,
  parallel: 2,
  gui: false,
  guiPort: 8420,
  resetWorktrees: false,
  log: testLog,
};

Deno.test("onConfigResolved can return custom specFile and progressFile", async () => {
  const path = await writeTempPlugin(`
export const plugin = {
  onConfigResolved({ ladder, iterations }) {
    return { iterations, specFile: "custom/spec.md", progressFile: "custom/progress.md" };
  },
};
`);
  const result = await loadPlugin({ pluginPath: path, log: testLog });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    const resolved = await result.value.onConfigResolved?.(defaultConfigOpts);
    assertEquals(resolved?.specFile, "custom/spec.md");
    assertEquals(resolved?.progressFile, "custom/progress.md");
    assertEquals(resolved?.iterations, 5);
  }
});

Deno.test("onConfigResolved can override gui, parallel, and level", async () => {
  const path = await writeTempPlugin(`
export const plugin = {
  onConfigResolved() {
    return { gui: true, guiPort: 9999, parallel: 4, level: 1 };
  },
};
`);
  const result = await loadPlugin({ pluginPath: path, log: testLog });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    const resolved = await result.value.onConfigResolved?.(defaultConfigOpts);
    assertEquals(resolved?.gui, true);
    assertEquals(resolved?.guiPort, 9999);
    assertEquals(resolved?.parallel, 4);
    assertEquals(resolved?.level, 1);
  }
});

Deno.test("onConfigResolved can return coder/verifier/escalated model overrides", async () => {
  const path = await writeTempPlugin(`
export const plugin = {
  onConfigResolved() {
    return { coder: "openai/gpt-4o", verifier: "openai/gpt-4o", escalated: "openai/o1" };
  },
};
`);
  const result = await loadPlugin({ pluginPath: path, log: testLog });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    const resolved = await result.value.onConfigResolved?.(defaultConfigOpts);
    assertEquals(resolved?.coder, "openai/gpt-4o");
    assertEquals(resolved?.verifier, "openai/gpt-4o");
    assertEquals(resolved?.escalated, "openai/o1");
  }
});

Deno.test("onConfigResolved supports colon-form model overrides", async () => {
  const path = await writeTempPlugin(`
export const plugin = {
  onConfigResolved() {
    return { coder: "ollama:gemma:4eb", gui: true, iterations: 50 };
  },
};
`);
  const result = await loadPlugin({ pluginPath: path, log: testLog });
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    const resolved = await result.value.onConfigResolved?.(defaultConfigOpts);
    assertEquals(resolved?.coder, "ollama:gemma:4eb");
    assertEquals(resolved?.gui, true);
    assertEquals(resolved?.iterations, 50);
  }
});
