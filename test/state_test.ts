import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  clearLoopCheckpoint,
  readLoopCheckpoint,
  writeLoopCheckpoint,
} from "../src/state.ts";

Deno.test("readLoopCheckpoint returns undefined when file missing", async () => {
  await clearLoopCheckpoint();
  const result = await readLoopCheckpoint();
  assertEquals(result, undefined);
});

Deno.test("write then read round-trips checkpoint", async () => {
  const checkpoint = {
    iterationsUsed: 5,
    step: "done" as const,
    validationFailurePath: "/tmp/f.log",
  };
  await writeLoopCheckpoint(checkpoint);
  const result = await readLoopCheckpoint();
  assertEquals(result, checkpoint);
  await clearLoopCheckpoint();
});

Deno.test("clearLoopCheckpoint removes file", async () => {
  await writeLoopCheckpoint({
    iterationsUsed: 1,
    step: "agent" as const,
    validationFailurePath: undefined,
  });
  await clearLoopCheckpoint();
  const result = await readLoopCheckpoint();
  assertEquals(result, undefined);
});

Deno.test("readLoopCheckpoint returns undefined for invalid step", async () => {
  await Deno.mkdir(".ralph", { recursive: true });
  await Deno.writeTextFile(
    ".ralph/loop-state.json",
    JSON.stringify({ iterationsUsed: 1, step: "bogus" }),
  );
  const result = await readLoopCheckpoint();
  assertEquals(result, undefined);
  await clearLoopCheckpoint();
});

Deno.test("readLoopCheckpoint omits non-string validationFailurePath", async () => {
  await Deno.mkdir(".ralph", { recursive: true });
  await Deno.writeTextFile(
    ".ralph/loop-state.json",
    JSON.stringify({
      iterationsUsed: 2,
      step: "agent",
      validationFailurePath: 42,
    }),
  );
  const result = await readLoopCheckpoint();
  assertEquals(result, {
    iterationsUsed: 2,
    step: "agent",
    validationFailurePath: undefined,
  });
  await clearLoopCheckpoint();
});

Deno.test("readLoopCheckpoint returns undefined for missing fields", async () => {
  await Deno.mkdir(".ralph", { recursive: true });
  await Deno.writeTextFile(
    ".ralph/loop-state.json",
    JSON.stringify({ foo: 1 }),
  );
  const result = await readLoopCheckpoint();
  assertEquals(result, undefined);
  await clearLoopCheckpoint();
});

Deno.test("readLoopCheckpoint returns undefined for malformed JSON", async () => {
  await Deno.mkdir(".ralph", { recursive: true });
  await Deno.writeTextFile(".ralph/loop-state.json", "not json");
  const result = await readLoopCheckpoint();
  await Deno.remove(".ralph/loop-state.json").catch(() => {});
  // .catch(() => undefined) in readLoopCheckpoint swallows JSON.parse errors
  assertEquals(result, undefined);
});
