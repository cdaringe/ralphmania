import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { err, ok } from "../src/types.ts";

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
