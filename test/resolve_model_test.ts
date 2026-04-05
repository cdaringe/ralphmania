import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.11";
import { resolveModel } from "../src/resolve-model.ts";

Deno.test("resolveModel: known provider/model returns a model object", async () => {
  const model = await resolveModel("anthropic", "claude-3-5-haiku-20241022");
  assertEquals(model.provider, "anthropic");
  assertEquals(typeof model.id, "string");
});

Deno.test("resolveModel: unknown provider throws descriptive error", async () => {
  const err = await assertRejects(
    () => resolveModel("ollama", "gemma4:e2b"),
    Error,
  );
  assertEquals(
    (err as Error).message.includes(
      'Unknown provider/model: "ollama/gemma4:e2b"',
    ),
    true,
  );
  assertEquals(
    (err as Error).message.includes("Registered providers:"),
    true,
  );
});

Deno.test("resolveModel: known provider but unknown model throws", async () => {
  const err = await assertRejects(
    () => resolveModel("anthropic", "nonexistent-model-999"),
    Error,
  );
  assertEquals(
    (err as Error).message.includes("Unknown provider/model"),
    true,
  );
});
