import { assert, assertEquals } from "jsr:@std/assert@^1";
import { createAgentInputBus } from "./input-bus.ts";

// ---------------------------------------------------------------------------
// send -- no worker registered
// ---------------------------------------------------------------------------

Deno.test("AgentInputBus: send to unregistered worker returns err", async () => {
  const bus = createAgentInputBus();
  const result = await bus.send("w0", "hello", "steer");
  assert(result.isErr());
  assert(result.error.failureMessage.includes("No active worker"));
});

// ---------------------------------------------------------------------------
// registerSession + send
// ---------------------------------------------------------------------------

Deno.test("AgentInputBus: send to registered session returns ok", async () => {
  const bus = createAgentInputBus();
  const received: { text: string; mode: string }[] = [];
  // deno-lint-ignore require-await
  bus.registerSession("SC.1", async (text, mode) => {
    received.push({ text, mode });
  });
  const result = await bus.send("SC.1", "feedback\n", "steer");
  assert(result.isOk());
  assertEquals(received, [{ text: "feedback\n", mode: "steer" }]);
});

Deno.test("AgentInputBus: send with followUp mode", async () => {
  const bus = createAgentInputBus();
  const received: { text: string; mode: string }[] = [];
  // deno-lint-ignore require-await
  bus.registerSession("SC.1", async (text, mode) => {
    received.push({ text, mode });
  });
  const result = await bus.send("SC.1", "more context", "followUp");
  assert(result.isOk());
  assertEquals(received, [{ text: "more context", mode: "followUp" }]);
});

Deno.test("AgentInputBus: multiple workers are independent", async () => {
  const bus = createAgentInputBus();
  const a: string[] = [];
  const b: string[] = [];
  // deno-lint-ignore require-await
  bus.registerSession("w0", async (text) => {
    a.push(text);
  });
  // deno-lint-ignore require-await
  bus.registerSession("w1", async (text) => {
    b.push(text);
  });

  await bus.send("w0", "to-zero\n", "steer");
  await bus.send("w1", "to-one\n", "steer");

  assertEquals(a, ["to-zero\n"]);
  assertEquals(b, ["to-one\n"]);
});

// ---------------------------------------------------------------------------
// unregister
// ---------------------------------------------------------------------------

Deno.test("AgentInputBus: send after unregister returns err", async () => {
  const bus = createAgentInputBus();
  bus.registerSession("w0", async () => {});
  bus.unregister("w0");
  const result = await bus.send("w0", "nope", "steer");
  assert(result.isErr());
});

Deno.test("AgentInputBus: unregister of unknown worker is a no-op", () => {
  const bus = createAgentInputBus();
  bus.unregister("nonexistent");
});

// ---------------------------------------------------------------------------
// send on errored session
// ---------------------------------------------------------------------------

Deno.test("AgentInputBus: session sender error returns err with message", async () => {
  const bus = createAgentInputBus();
  // deno-lint-ignore require-await
  bus.registerSession("SC.1", async () => {
    throw new Error("session closed");
  });
  const result = await bus.send("SC.1", "msg", "steer");
  assert(result.isErr());
  assert(result.error.failureMessage.includes("session closed"));
});

Deno.test("AgentInputBus: unregister session clears entry", async () => {
  const bus = createAgentInputBus();
  bus.registerSession("SC.1", async () => {});
  bus.unregister("SC.1");
  const result = await bus.send("SC.1", "msg", "steer");
  assert(result.isErr());
});
