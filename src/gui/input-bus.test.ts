import { assert, assertEquals } from "jsr:@std/assert@^1";
import { createAgentInputBus } from "./input-bus.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeCollector = (): {
  stream: WritableStream<Uint8Array>;
  collected: () => Uint8Array;
} => {
  const chunks: Uint8Array[] = [];
  const stream = new WritableStream<Uint8Array>({
    write(chunk): void {
      chunks.push(chunk);
    },
  });
  return {
    stream,
    collected: () => {
      const total = chunks.reduce((acc, c) => acc + c.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return out;
    },
  };
};

// ---------------------------------------------------------------------------
// send — no worker registered
// ---------------------------------------------------------------------------

Deno.test("AgentInputBus: send to unregistered worker returns err", async () => {
  const bus = createAgentInputBus();
  const result = await bus.send("w0", "hello");
  assert(result.isErr());
  assert(result.error.failureMessage.includes("No active worker"));
});

// ---------------------------------------------------------------------------
// register + send
// ---------------------------------------------------------------------------

Deno.test("AgentInputBus: send to registered worker returns ok", async () => {
  const bus = createAgentInputBus();
  const { stream, collected } = makeCollector();
  bus.register("w0", stream);

  const result = await bus.send("w0", "hello\n");
  assert(result.isOk());
  assertEquals(new TextDecoder().decode(collected()), "hello\n");
});

Deno.test("AgentInputBus: multiple workers are independent", async () => {
  const bus = createAgentInputBus();
  const a = makeCollector();
  const b = makeCollector();
  bus.register("w0", a.stream);
  bus.register("w1", b.stream);

  await bus.send("w0", "to-zero\n");
  await bus.send("w1", "to-one\n");

  assertEquals(new TextDecoder().decode(a.collected()), "to-zero\n");
  assertEquals(new TextDecoder().decode(b.collected()), "to-one\n");
});

// ---------------------------------------------------------------------------
// unregister
// ---------------------------------------------------------------------------

Deno.test("AgentInputBus: send after unregister returns err", async () => {
  const bus = createAgentInputBus();
  const { stream } = makeCollector();
  bus.register("w0", stream);
  bus.unregister("w0");
  const result = await bus.send("w0", "nope");
  assert(result.isErr());
});

Deno.test("AgentInputBus: unregister of unknown worker is a no-op", () => {
  const bus = createAgentInputBus();
  bus.unregister("nonexistent");
});

// ---------------------------------------------------------------------------
// send on errored/closed stream
// ---------------------------------------------------------------------------

Deno.test("AgentInputBus: send on errored stream returns err with message", async () => {
  const bus = createAgentInputBus();
  const stream = new WritableStream<Uint8Array>({
    write(): void {
      throw new Error("pipe broken");
    },
  });
  bus.register("w0", stream);
  const result = await bus.send("w0", "data");
  assert(result.isErr());
  assert(result.error.failureMessage.includes("pipe broken"));
});

// ---------------------------------------------------------------------------
// registerSession — SDK session mode
// ---------------------------------------------------------------------------

Deno.test("AgentInputBus: registerSession sends via session sender", async () => {
  const bus = createAgentInputBus();
  const received: string[] = [];
  bus.registerSession("SC.1", async (text) => {
    received.push(text);
  });
  const result = await bus.send("SC.1", "feedback\n");
  assert(result.isOk());
  assertEquals(received, ["feedback\n"]);
});

Deno.test("AgentInputBus: session sender error returns err with message", async () => {
  const bus = createAgentInputBus();
  bus.registerSession("SC.1", async () => {
    throw new Error("session closed");
  });
  const result = await bus.send("SC.1", "msg");
  assert(result.isErr());
  assert(result.error.failureMessage.includes("session closed"));
});

Deno.test("AgentInputBus: unregister session clears entry", async () => {
  const bus = createAgentInputBus();
  bus.registerSession("SC.1", async () => {});
  bus.unregister("SC.1");
  const result = await bus.send("SC.1", "msg");
  assert(result.isErr());
});
