import { assertEquals } from "jsr:@std/assert";
import { pipeStream } from "./runner.ts";

Deno.test("pipeStream pipes data and detects marker", async () => {
  const data = new TextEncoder().encode(
    "hello <promise>COMPLETE</promise> world",
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const written: Uint8Array[] = [];
  const output = {
    write: async (d: Uint8Array) => {
      written.push(d);
      return d.length;
    },
  };
  const found = await pipeStream({
    stream,
    output,
    marker: "<promise>COMPLETE</promise>",
  });
  assertEquals(found, true);
  assertEquals(written.length > 0, true);
});

Deno.test("pipeStream returns false when marker not found", async () => {
  const data = new TextEncoder().encode("hello world");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const output = {
    write: async (d: Uint8Array) => d.length,
  };
  const found = await pipeStream({ stream, output, marker: "NOTFOUND" });
  assertEquals(found, false);
});

Deno.test("pipeStream handles missing marker param", async () => {
  const data = new TextEncoder().encode("test data");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const output = {
    write: async (d: Uint8Array) => d.length,
  };
  const found = await pipeStream({ stream, output });
  assertEquals(found, false);
});

Deno.test("pipeStream handles multiple chunks", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("chunk1 "));
      controller.enqueue(encoder.encode("chunk2 MARKER "));
      controller.enqueue(encoder.encode("chunk3"));
      controller.close();
    },
  });
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  const output = {
    write: async (d: Uint8Array) => {
      chunks.push(decoder.decode(d));
      return d.length;
    },
  };
  const found = await pipeStream({ stream, output, marker: "MARKER" });
  assertEquals(found, true);
  assertEquals(chunks.length, 3);
});

Deno.test("pipeStream handles empty stream", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
  const output = {
    write: async (d: Uint8Array) => d.length,
  };
  const found = await pipeStream({ stream, output, marker: "anything" });
  assertEquals(found, false);
});
