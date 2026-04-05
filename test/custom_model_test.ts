import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  extractContextWindow,
  hasVisionCapability,
  resolveCustomModel,
} from "../src/custom-model.ts";
import { LOCAL_MODEL_COMPAT_DEFAULTS } from "../src/types.ts";

// ---------------------------------------------------------------------------
// Pure unit tests (no network)
// ---------------------------------------------------------------------------

Deno.test("extractContextWindow: finds .context_length key", () => {
  assertEquals(
    extractContextWindow({ "gemma4.context_length": 131072 }),
    131072,
  );
});

Deno.test("extractContextWindow: returns default when missing", () => {
  assertEquals(extractContextWindow({}), 8192);
});

Deno.test("extractContextWindow: picks first matching key", () => {
  assertEquals(
    extractContextWindow({
      "llama.context_length": 4096,
      "llama.embedding_length": 4096,
    }),
    4096,
  );
});

Deno.test("hasVisionCapability: true when .vision. keys present", () => {
  assertEquals(
    hasVisionCapability({
      "gemma4.vision.block_count": 16,
      "gemma4.block_count": 35,
    }),
    true,
  );
});

Deno.test("hasVisionCapability: false when no .vision. keys", () => {
  assertEquals(
    hasVisionCapability({
      "gemma4.block_count": 35,
      "gemma4.context_length": 131072,
    }),
    false,
  );
});

Deno.test("resolveCustomModel: openai-compatible uses provided metadata", async () => {
  const model = await resolveCustomModel({
    kind: "openai-compatible",
    baseUrl: "http://localhost:8080/v1/",
    model: "my-local-model",
    contextWindow: 4096,
  });
  assertEquals(model.id, "my-local-model");
  assertEquals(model.baseUrl, "http://localhost:8080/v1");
  assertEquals(model.contextWindow, 4096);
  assertEquals(model.maxTokens, 4096);
  assertEquals(model.api, "openai-completions");
  assertEquals(model.provider, "openai");
  assertEquals(model.input, ["text"]);
  assertEquals(model.reasoning, false);
  assertEquals(model.cost, {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  // Compat defaults applied — developer role disabled for local servers
  assertEquals(model.compat, LOCAL_MODEL_COMPAT_DEFAULTS);
});

Deno.test("resolveCustomModel: compat overrides merge with defaults", async () => {
  const model = await resolveCustomModel({
    kind: "openai-compatible",
    baseUrl: "http://localhost:8080/v1",
    model: "my-model",
    contextWindow: 4096,
    compat: { supportsDeveloperRole: true },
  });
  // The compat object should contain the merged result
  const compat = model.compat as Record<string, unknown>;
  // User override wins
  assertEquals(compat.supportsDeveloperRole, true);
  // Defaults still apply for non-overridden fields
  assertEquals(compat.supportsStore, false);
  assertEquals(compat.supportsReasoningEffort, false);
});
