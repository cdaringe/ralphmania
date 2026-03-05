import { assertEquals } from "jsr:@std/assert";
import { err, ok } from "./types.ts";

Deno.test("ok creates success result", () => {
  const result = ok(42);
  assertEquals(result, { ok: true, value: 42 });
});

Deno.test("ok wraps any value", () => {
  assertEquals(ok("hello"), { ok: true, value: "hello" });
  assertEquals(ok(undefined), { ok: true, value: undefined });
  assertEquals(ok(null), { ok: true, value: null });
});

Deno.test("err creates failure result", () => {
  const result = err("fail");
  assertEquals(result, { ok: false, error: "fail" });
});

Deno.test("err wraps any error", () => {
  assertEquals(err(404), { ok: false, error: 404 });
  assertEquals(err({ code: "NOT_FOUND" }), {
    ok: false,
    error: { code: "NOT_FOUND" },
  });
});
