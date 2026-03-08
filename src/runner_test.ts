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

Deno.test("pipeStream detects marker split across two chunks", async () => {
  const encoder = new TextEncoder();
  const marker = "<promise>COMPLETE</promise>";
  const mid = Math.floor(marker.length / 2);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("before " + marker.slice(0, mid)));
      controller.enqueue(encoder.encode(marker.slice(mid) + " after"));
      controller.close();
    },
  });
  const output = {
    write: async (d: Uint8Array) => d.length,
  };
  const found = await pipeStream({ stream, output, marker });
  assertEquals(found, true);
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

Deno.test("extractNdjsonResult extracts .result from success result", () => {
  assertEquals(
    extractNdjsonResult(
      '{"type":"result","subtype":"success","result":"hello","is_error":false}',
    ),
    "hello",
  );
});

Deno.test("extractNdjsonResult extracts text from assistant message", () => {
  assertEquals(
    extractNdjsonResult(
      JSON.stringify({
        type: "assistant",
        session_id: "abc",
        message: {
          content: [
            { type: "text", text: "Hello " },
            { type: "tool_use", id: "t1", name: "Read", input: {} },
            { type: "text", text: "world" },
          ],
        },
      }),
    ),
    "Hello \n[tool: Read]\nworld",
  );
});

Deno.test("extractNdjsonResult extracts tool_use_summary", () => {
  assertEquals(
    extractNdjsonResult(
      '{"type":"tool_use_summary","summary":"Read 3 files"}',
    ),
    "Read 3 files",
  );
});

Deno.test("extractNdjsonResult extracts system events", () => {
  assertEquals(
    extractNdjsonResult('{"type":"system","subtype":"init","session_id":"x"}'),
    "[system: init]",
  );
});

Deno.test("extractNdjsonResult returns raw line on invalid JSON", () => {
  assertEquals(extractNdjsonResult("not json at all"), "not json at all");
});

Deno.test("extractNdjsonResult extracts error result", () => {
  assertEquals(
    extractNdjsonResult(
      '{"type":"result","subtype":"error_max_turns","is_error":true,"errors":["max turns"]}',
    ),
    "[error_max_turns] max turns",
  );
});

Deno.test("ndjsonResultTransform extracts results from NDJSON stream", async () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const input = [
    '{"type":"result","subtype":"success","result":"hello ","is_error":false}\n',
    '{"type":"system","subtype":"init","session_id":"abc"}\n',
    '{"type":"result","subtype":"success","result":"world","is_error":false}\n',
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
  assertEquals(output.includes("[system: init]"), true);
  assertEquals(output.includes("world"), true);
});

Deno.test("ndjsonResultTransform handles split chunks", async () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const line =
    '{"type":"result","subtype":"success","result":"split","is_error":false}\n';
  const mid = Math.floor(line.length / 2);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(line.slice(0, mid)));
      controller.enqueue(encoder.encode(line.slice(mid)));
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
  assertEquals(chunks.join(""), "split\n");
});
