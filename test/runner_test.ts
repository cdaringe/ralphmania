import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.11";
import {
  extractNdjsonResult,
  linePrefixTransform,
  ndjsonResultTransform,
  pipeStream,
  RECEIPTS_PROMPT,
  supportsInteractiveAgentInput,
  workerPrefix,
} from "../src/runner.ts";

Deno.test("pipeStream pipes data and detects marker", async () => {
  const data = new TextEncoder().encode(
    "hello <promise>COMPLETE</promise> world",
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.enqueue(data);
      controller.close();
    },
  });
  const written: Uint8Array[] = [];
  const output = {
    write: (d: Uint8Array): Promise<number> => {
      written.push(d);
      return Promise.resolve(d.length);
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
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.enqueue(data);
      controller.close();
    },
  });
  const output = {
    write: (d: Uint8Array): Promise<number> => Promise.resolve(d.length),
  };
  const found = await pipeStream({ stream, output, marker: "NOTFOUND" });
  assertEquals(found, false);
});

Deno.test("pipeStream handles missing marker param", async () => {
  const data = new TextEncoder().encode("test data");
  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.enqueue(data);
      controller.close();
    },
  });
  const output = {
    write: (d: Uint8Array): Promise<number> => Promise.resolve(d.length),
  };
  const found = await pipeStream({ stream, output });
  assertEquals(found, false);
});

Deno.test("pipeStream handles multiple chunks", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.enqueue(encoder.encode("chunk1 "));
      controller.enqueue(encoder.encode("chunk2 MARKER "));
      controller.enqueue(encoder.encode("chunk3"));
      controller.close();
    },
  });
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  const output = {
    write: (d: Uint8Array): Promise<number> => {
      chunks.push(decoder.decode(d));
      return Promise.resolve(d.length);
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
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.enqueue(encoder.encode("before " + marker.slice(0, mid)));
      controller.enqueue(encoder.encode(marker.slice(mid) + " after"));
      controller.close();
    },
  });
  const output = {
    write: (d: Uint8Array): Promise<number> => Promise.resolve(d.length),
  };
  const found = await pipeStream({ stream, output, marker });
  assertEquals(found, true);
});

Deno.test("pipeStream handles empty stream", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.close();
    },
  });
  const output = {
    write: (d: Uint8Array): Promise<number> => Promise.resolve(d.length),
  };
  const found = await pipeStream({ stream, output, marker: "anything" });
  assertEquals(found, false);
});

Deno.test("pipeStream calls onActivity for each non-empty chunk", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.enqueue(encoder.encode("a"));
      controller.enqueue(new Uint8Array());
      controller.enqueue(encoder.encode("b"));
      controller.close();
    },
  });
  let activityCount = 0;
  const output = {
    write: (d: Uint8Array): Promise<number> => Promise.resolve(d.length),
  };
  await pipeStream({
    stream,
    output,
    onActivity: () => {
      activityCount++;
    },
  });
  assertEquals(activityCount, 2);
});

Deno.test("supportsInteractiveAgentInput only enables live input for claude", () => {
  assertEquals(supportsInteractiveAgentInput("claude"), true);
  assertEquals(supportsInteractiveAgentInput("codex"), false);
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
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const chunks: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk: Uint8Array): void {
      chunks.push(decoder.decode(chunk));
    },
  });

  await stream.pipeThrough(ndjsonResultTransform()).pipeTo(writable);
  const output = chunks.join("");
  assertEquals(output.includes("hello "), true);
  assertEquals(output.includes("[system: init]"), true);
  assertEquals(output.includes("world"), true);
});

Deno.test("RECEIPTS_PROMPT requires intro for each scenario", () => {
  assertStringIncludes(
    RECEIPTS_PROMPT,
    "A short intro SHALL describe how the scenario's goals are achieved",
  );
});

Deno.test("RECEIPTS_PROMPT requires inlined collapsed summary markdown", () => {
  assertStringIncludes(
    RECEIPTS_PROMPT,
    "inlined and collapsed",
  );
  assertStringIncludes(RECEIPTS_PROMPT, "<details>");
});

Deno.test("RECEIPTS_PROMPT targets fastest model receipts directory", () => {
  assertStringIncludes(RECEIPTS_PROMPT, ".ralph/receipts");
});

Deno.test("ndjsonResultTransform handles split chunks", async () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const line =
    '{"type":"result","subtype":"success","result":"split","is_error":false}\n';
  const mid = Math.floor(line.length / 2);

  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.enqueue(encoder.encode(line.slice(0, mid)));
      controller.enqueue(encoder.encode(line.slice(mid)));
      controller.close();
    },
  });

  const chunks: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk: Uint8Array): void {
      chunks.push(decoder.decode(chunk));
    },
  });

  await stream.pipeThrough(ndjsonResultTransform()).pipeTo(writable);
  assertEquals(chunks.join(""), "split\n");
});

// ---------------------------------------------------------------------------
// workerPrefix
// ---------------------------------------------------------------------------

Deno.test("workerPrefix produces fixed-length text prefix for worker 0 scenario 33", () => {
  // In non-TTY test env colors.ts strips ANSI codes, so we get plain text.
  const prefix = workerPrefix(0, "33");
  assertStringIncludes(prefix, "[w0/s33]");
  assertStringIncludes(prefix, " "); // trailing space
});

Deno.test("workerPrefix shows string scenario as-is", () => {
  const prefix = workerPrefix(1, "4");
  assertStringIncludes(prefix, "s4");
});

Deno.test("workerPrefix uses -- for undefined scenario", () => {
  const prefix = workerPrefix(0, undefined);
  assertStringIncludes(prefix, "s--");
});

Deno.test("workerPrefix cycles colors across worker indices", () => {
  // Just verify all produce non-empty strings — color codes vary by TTY.
  for (let i = 0; i < 5; i++) {
    const prefix = workerPrefix(i, "1");
    assertEquals(typeof prefix, "string");
    assertEquals(prefix.length > 0, true);
  }
});

// ---------------------------------------------------------------------------
// linePrefixTransform
// ---------------------------------------------------------------------------

const prefixTransformOutput = async (
  input: string,
  prefix: string,
): Promise<string> => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const chunks: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk: Uint8Array): void {
      chunks.push(decoder.decode(chunk));
    },
  });
  await stream.pipeThrough(linePrefixTransform(prefix)).pipeTo(writable);
  return chunks.join("");
};

Deno.test("linePrefixTransform prepends prefix to single line", async () => {
  const out = await prefixTransformOutput("hello world\n", "[W] ");
  assertEquals(out, "[W] hello world\n");
});

Deno.test("linePrefixTransform prepends prefix to every line", async () => {
  const out = await prefixTransformOutput("line1\nline2\nline3\n", "[W] ");
  assertEquals(out, "[W] line1\n[W] line2\n[W] line3\n");
});

Deno.test("linePrefixTransform handles line without trailing newline", async () => {
  const out = await prefixTransformOutput("no newline", "[W] ");
  assertEquals(out, "[W] no newline");
});

Deno.test("linePrefixTransform handles empty string", async () => {
  const out = await prefixTransformOutput("", "[W] ");
  assertEquals(out, "");
});

Deno.test("linePrefixTransform works across multiple chunks", async () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.enqueue(encoder.encode("line1\n"));
      controller.enqueue(encoder.encode("line"));
      controller.enqueue(encoder.encode("2\nline3\n"));
      controller.close();
    },
  });
  const chunks: string[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk: Uint8Array): void {
      chunks.push(decoder.decode(chunk));
    },
  });
  await stream.pipeThrough(linePrefixTransform("[W] ")).pipeTo(writable);
  const out = chunks.join("");
  assertEquals(out, "[W] line1\n[W] line2\n[W] line3\n");
});

Deno.test("linePrefixTransform does not add prefix to disk output (no transform applied)", async () => {
  // Disk writes go directly via pipeStream without linePrefixTransform.
  // Verify a raw stream written without the transform has no prefix.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      controller.enqueue(encoder.encode("raw log line\n"));
      controller.close();
    },
  });
  const written: string[] = [];
  const decoder = new TextDecoder();
  await pipeStream({
    stream,
    output: {
      write: (d: Uint8Array): Promise<number> => {
        written.push(decoder.decode(d));
        return Promise.resolve(d.length);
      },
    },
  });
  assertEquals(written.join(""), "raw log line\n");
});
