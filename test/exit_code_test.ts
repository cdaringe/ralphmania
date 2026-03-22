import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { computeExitCode } from "../src/exit.ts";

Deno.test("computeExitCode returns 0 when all scenarios are VERIFIED", () => {
  assertEquals(computeExitCode(true), 0);
});

Deno.test("computeExitCode returns 1 when iterations exhausted without completion", () => {
  assertEquals(computeExitCode(false), 1);
});
