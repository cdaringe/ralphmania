import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { err, extractSDKText, isSDKMessage, ok } from "../src/types.ts";

Deno.test("ok creates success result", () => {
  const result = ok(42);
  assertEquals(result.isOk(), true);
  if (result.isOk()) assertEquals(result.value, 42);
});

Deno.test("ok wraps any value", () => {
  const r1 = ok("hello");
  assertEquals(r1.isOk(), true);
  if (r1.isOk()) assertEquals(r1.value, "hello");
  const r2 = ok(undefined);
  assertEquals(r2.isOk(), true);
  if (r2.isOk()) assertEquals(r2.value, undefined);
  const r3 = ok(null);
  assertEquals(r3.isOk(), true);
  if (r3.isOk()) assertEquals(r3.value, null);
});

Deno.test("err creates failure result", () => {
  const result = err("fail");
  assertEquals(result.isErr(), true);
  if (result.isErr()) assertEquals(result.error, "fail");
});

Deno.test("err wraps any error", () => {
  const r1 = err(404);
  assertEquals(r1.isErr(), true);
  if (r1.isErr()) assertEquals(r1.error, 404);
  const r2 = err({ code: "NOT_FOUND" });
  assertEquals(r2.isErr(), true);
  if (r2.isErr()) assertEquals(r2.error, { code: "NOT_FOUND" });
});

// isSDKMessage tests

Deno.test("isSDKMessage returns true for valid types", () => {
  assertEquals(isSDKMessage({ type: "result" }), true);
  assertEquals(isSDKMessage({ type: "system" }), true);
  assertEquals(isSDKMessage({ type: "assistant" }), true);
  assertEquals(isSDKMessage({ type: "stream_event" }), true);
  assertEquals(isSDKMessage({ type: "tool_use_summary" }), true);
});

Deno.test("isSDKMessage returns false for invalid input", () => {
  assertEquals(isSDKMessage(null), false);
  assertEquals(isSDKMessage(undefined), false);
  assertEquals(isSDKMessage("string"), false);
  assertEquals(isSDKMessage({ type: "unknown" }), false);
});

// extractSDKText tests

Deno.test("extractSDKText returns undefined for non-SDK messages", () => {
  assertEquals(extractSDKText(null), undefined);
  assertEquals(extractSDKText({ type: "unknown" }), undefined);
});

Deno.test("extractSDKText extracts assistant text blocks", () => {
  const msg = {
    type: "assistant",
    session_id: "s1",
    message: {
      content: [
        { type: "text", text: "hello" },
        { type: "tool_use", id: "t1", name: "Read", input: {} },
        { type: "thinking", thinking: "hmm" },
      ],
    },
  };
  assertEquals(extractSDKText(msg), "hello\n[tool: Read]\nhmm");
});

Deno.test("extractSDKText returns undefined for empty assistant content", () => {
  const msg = {
    type: "assistant",
    session_id: "s1",
    message: {
      content: [
        { type: "text", text: "" },
        { type: "thinking", thinking: "" },
      ],
    },
  };
  assertEquals(extractSDKText(msg), undefined);
});

Deno.test("extractSDKText extracts result success", () => {
  const msg = {
    type: "result",
    subtype: "success",
    result: "done",
    is_error: false,
    duration_ms: 100,
    num_turns: 1,
    total_cost_usd: 0.01,
  };
  assertEquals(extractSDKText(msg), "done");
});

Deno.test("extractSDKText extracts result error", () => {
  const msg = {
    type: "result",
    subtype: "error_max_turns",
    is_error: true,
    errors: ["too many turns"],
  };
  assertEquals(extractSDKText(msg), "[error_max_turns] too many turns");
});

Deno.test("extractSDKText extracts system message", () => {
  assertEquals(
    extractSDKText({ type: "system", subtype: "init", session_id: "s1" }),
    "[system: init]",
  );
});

Deno.test("extractSDKText extracts tool_use_summary", () => {
  assertEquals(
    extractSDKText({ type: "tool_use_summary", summary: "Read 3 files" }),
    "Read 3 files",
  );
});

Deno.test("extractSDKText returns undefined for stream_event", () => {
  assertEquals(
    extractSDKText({ type: "stream_event", event: {} }),
    undefined,
  );
});
