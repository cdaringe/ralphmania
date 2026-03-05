import { assertEquals } from "jsr:@std/assert";
import {
  extractNdjsonResult,
  ndjsonResultTransform,
  pipeStream,
} from "./runner.ts";

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

Deno.test("extractNdjsonResult extracts .result from valid JSON", () => {
  assertEquals(
    extractNdjsonResult('{"result":"hello","type":"message"}'),
    "hello",
  );
});

Deno.test("extractNdjsonResult returns raw line when no .result", () => {
  const line = '{"type":"progress","count":5}';
  assertEquals(extractNdjsonResult(line), line);
});

Deno.test("extractNdjsonResult returns raw line on invalid JSON", () => {
  assertEquals(extractNdjsonResult("not json at all"), "not json at all");
});

Deno.test("extractNdjsonResult returns raw line for non-string result", () => {
  const line = '{"result":42}';
  assertEquals(extractNdjsonResult(line), line);
});

Deno.test("ndjsonResultTransform extracts results from NDJSON stream", async () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const input = [
    '{"result":"hello "}\n',
    '{"type":"status"}\n',
    '{"result":"world"}\n',
  ].join("");

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const chunks: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(decoder.decode(chunk));
    },
  });

  await stream.pipeThrough(ndjsonResultTransform()).pipeTo(writable);
  const output = chunks.join("");
  assertEquals(output.includes("hello "), true);
  assertEquals(output.includes('{"type":"status"}'), true);
  assertEquals(output.includes("world"), true);
});

Deno.test("ndjsonResultTransform handles split chunks", async () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"resu'));
      controller.enqueue(encoder.encode('lt":"split"}\n'));
      controller.close();
    },
  });

  const chunks: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(decoder.decode(chunk));
    },
  });

  await stream.pipeThrough(ndjsonResultTransform()).pipeTo(writable);
  assertEquals(chunks.join(""), "split");
});
