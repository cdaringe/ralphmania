import { assertEquals } from "jsr:@std/assert@^1";
import { createAgentInputBus } from "./input-bus.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a WritableStream backed by a byte collector for testing. */
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

Deno.test("AgentInputBus: send to unregistered worker returns false", async () => {
  const bus = createAgentInputBus();
  const sent = await bus.send(0, "hello");
  assertEquals(sent, false);
});

// ---------------------------------------------------------------------------
// register + send
// ---------------------------------------------------------------------------

Deno.test("AgentInputBus: send to registered worker writes bytes", async () => {
  const bus = createAgentInputBus();
  const { stream, collected } = makeCollector();
  bus.register(0, stream);

  const sent = await bus.send(0, "hello\n");
  assertEquals(sent, true);
  assertEquals(new TextDecoder().decode(collected()), "hello\n");
});

Deno.test("AgentInputBus: multiple workers are independent", async () => {
  const bus = createAgentInputBus();
  const a = makeCollector();
  const b = makeCollector();
  bus.register(0, a.stream);
  bus.register(1, b.stream);

  await bus.send(0, "to-zero\n");
  await bus.send(1, "to-one\n");

  assertEquals(new TextDecoder().decode(a.collected()), "to-zero\n");
  assertEquals(new TextDecoder().decode(b.collected()), "to-one\n");
});

// ---------------------------------------------------------------------------
// unregister
// ---------------------------------------------------------------------------

Deno.test("AgentInputBus: send after unregister returns false", async () => {
  const bus = createAgentInputBus();
  const { stream } = makeCollector();
  bus.register(0, stream);
  bus.unregister(0);
  const sent = await bus.send(0, "nope");
  assertEquals(sent, false);
});

Deno.test("AgentInputBus: unregister of unknown worker is a no-op", () => {
  const bus = createAgentInputBus();
  bus.unregister(99); // must not throw
});

// ---------------------------------------------------------------------------
// send on errored/closed stream
// ---------------------------------------------------------------------------

Deno.test("AgentInputBus: send on errored stream returns false gracefully", async () => {
  const bus = createAgentInputBus();
  // Create a stream whose write callback throws so writer.write() rejects
  const stream = new WritableStream<Uint8Array>({
    write(): void {
      throw new Error("pipe broken");
    },
  });
  bus.register(0, stream);
  const sent = await bus.send(0, "data");
  assertEquals(sent, false);
});
