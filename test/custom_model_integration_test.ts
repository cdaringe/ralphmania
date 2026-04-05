import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.11";
import { LOCAL_MODEL_COMPAT_DEFAULTS } from "../src/types.ts";
import {
  extractContextWindow,
  isOllamaReachable,
  OLLAMA_DEFAULT_BASE,
  queryOllamaShow,
  queryOllamaTags,
  resolveCustomModel,
} from "../src/custom-model.ts";

// ---------------------------------------------------------------------------
// Ollama integration tests — skipped when ollama is not running
// ---------------------------------------------------------------------------

const ollamaAvailable = await isOllamaReachable();

Deno.test({
  name: "ollama integration: /api/tags returns validated model list",
  ignore: !ollamaAvailable,
  fn: async () => {
    const tags = await queryOllamaTags(OLLAMA_DEFAULT_BASE);
    assertEquals(Array.isArray(tags.models), true);
    for (const m of tags.models) {
      assertEquals(typeof m.name, "string");
      assertEquals(typeof m.model, "string");
      assertEquals(typeof m.size, "number");
      assertEquals(typeof m.digest, "string");
      assertEquals(typeof m.modified_at, "string");
      assertEquals(typeof m.details.format, "string");
    }
  },
});

Deno.test({
  name: "ollama integration: /api/show returns validated model metadata",
  ignore: !ollamaAvailable,
  sanitizeResources: false,
  fn: async () => {
    const tags = await queryOllamaTags(OLLAMA_DEFAULT_BASE);
    if (tags.models.length === 0) {
      throw new Error("No ollama models installed — pull at least one model");
    }
    const modelName = tags.models[0].name;
    const show = await queryOllamaShow(OLLAMA_DEFAULT_BASE, modelName);

    assertEquals(typeof show.model_info, "object");
    assertEquals(show.model_info !== null, true);
    assertEquals(typeof show.details, "object");
    assertEquals(typeof show.details?.family, "string");

    const info = show.model_info ?? {};
    const contextKeys = Object.keys(info).filter((k) =>
      k.endsWith(".context_length")
    );
    assertEquals(
      contextKeys.length > 0,
      true,
      `Expected at least one .context_length key in model_info, got keys: ${
        Object.keys(info).slice(0, 10).join(", ")
      }...`,
    );

    const contextWindow = extractContextWindow(info);
    assertEquals(typeof contextWindow, "number");
    assertEquals(contextWindow > 0, true);
  },
});

Deno.test({
  name: "ollama integration: /api/show rejects unknown model",
  ignore: !ollamaAvailable,
  fn: async () => {
    await assertRejects(
      () => queryOllamaShow(OLLAMA_DEFAULT_BASE, "nonexistent-model-xyz-999"),
      Error,
      "Ollama /api/show failed",
    );
  },
});

Deno.test({
  name: "ollama integration: resolveCustomModel builds valid Model from ollama",
  ignore: !ollamaAvailable,
  fn: async () => {
    const tags = await queryOllamaTags(OLLAMA_DEFAULT_BASE);
    if (tags.models.length === 0) {
      throw new Error("No ollama models installed");
    }
    const modelName = tags.models[0].name;
    const model = await resolveCustomModel({
      kind: "ollama",
      model: modelName,
    });

    assertEquals(model.id, modelName);
    assertEquals(model.name, modelName);
    assertEquals(model.provider, "openai");
    assertEquals(model.api, "openai-completions");
    assertEquals(model.baseUrl, `${OLLAMA_DEFAULT_BASE}/v1`);
    assertEquals(model.reasoning, false);
    assertEquals(typeof model.contextWindow, "number");
    assertEquals(model.contextWindow > 0, true);
    assertEquals(typeof model.maxTokens, "number");
    assertEquals(model.maxTokens > 0, true);
    assertEquals(model.input.includes("text"), true);
    assertEquals(model.cost, {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    // Compat defaults — developer role disabled for local ollama
    assertEquals(model.compat, LOCAL_MODEL_COMPAT_DEFAULTS);
  },
});

Deno.test({
  name: "ollama integration: resolveCustomModel respects custom baseUrl",
  ignore: !ollamaAvailable,
  fn: async () => {
    const tags = await queryOllamaTags(OLLAMA_DEFAULT_BASE);
    if (tags.models.length === 0) {
      throw new Error("No ollama models installed");
    }
    const modelName = tags.models[0].name;
    const model = await resolveCustomModel({
      kind: "ollama",
      baseUrl: "http://127.0.0.1:11434/",
      model: modelName,
    });
    assertEquals(model.baseUrl, "http://127.0.0.1:11434/v1");
  },
});

Deno.test({
  name: "ollama integration: resolveCustomModel unknown model throws",
  ignore: !ollamaAvailable,
  fn: async () => {
    await assertRejects(
      () =>
        resolveCustomModel({
          kind: "ollama",
          model: "nonexistent-model-xyz-999",
        }),
      Error,
      "Ollama /api/show failed",
    );
  },
});

Deno.test({
  name: "ollama integration: every installed model resolves successfully",
  ignore: !ollamaAvailable,
  fn: async () => {
    const tags = await queryOllamaTags(OLLAMA_DEFAULT_BASE);
    for (const entry of tags.models) {
      const model = await resolveCustomModel({
        kind: "ollama",
        model: entry.name,
      });
      assertEquals(model.id, entry.name);
      assertEquals(
        model.contextWindow > 0,
        true,
        `${entry.name} contextWindow must be > 0`,
      );
      assertEquals(
        model.input.includes("text"),
        true,
        `${entry.name} must support text input`,
      );
    }
  },
});
