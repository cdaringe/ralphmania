import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { parseProgressRows } from "../src/parsers/progress-rows.ts";

Deno.test("parseProgressRows parses float scenario IDs", () => {
  const content = [
    "| 18.1 | WIP | first scenario |",
    "| 18.2 | VERIFIED | second scenario |",
    "| 18.3 |          | not started |",
  ].join("\n");
  const result = parseProgressRows(content);
  assertEquals(result.isOk(), true);
  if (!result.isOk()) return;
  assertEquals(result.value.length, 3);
  assertEquals(result.value[0].scenario, "18.1");
  assertEquals(result.value[0].status, "WIP");
  assertEquals(result.value[1].scenario, "18.2");
  assertEquals(result.value[1].status, "VERIFIED");
  assertEquals(result.value[2].scenario, "18.3");
  assertEquals(result.value[2].status, "");
});

Deno.test("parseProgressRows parses integer scenario IDs", () => {
  const result = parseProgressRows("| 1 | WIP | desc |");
  assertEquals(result.isOk(), true);
  if (!result.isOk()) return;
  assertEquals(result.value.length, 1);
  assertEquals(result.value[0].scenario, "1");
});

Deno.test("parseProgressRows parses mixed int and float IDs", () => {
  const content = [
    "| 1   | VERIFIED | done |",
    "| 1.1 | WIP | sub-scenario |",
    "| 2   | WORK_COMPLETE | done |",
    "| 2.1 | NEEDS_REWORK | fix it | rework notes |",
  ].join("\n");
  const result = parseProgressRows(content);
  assertEquals(result.isOk(), true);
  if (!result.isOk()) return;
  assertEquals(result.value.map((r) => r.scenario), ["1", "1.1", "2", "2.1"]);
  assertEquals(result.value[3].reworkNotes, "rework notes");
});

Deno.test("parseProgressRows skips header and separator rows", () => {
  const content = [
    "| #    | Status   | Summary |",
    "| ---- | -------- | ------- |",
    "| 3.1  | WIP      | desc    |",
  ].join("\n");
  const result = parseProgressRows(content);
  assertEquals(result.isOk(), true);
  if (!result.isOk()) return;
  assertEquals(result.value.length, 1);
  assertEquals(result.value[0].scenario, "3.1");
});

Deno.test("parseProgressRows returns empty for non-table content", () => {
  const r1 = parseProgressRows("just some text");
  assertEquals(r1.isOk(), true);
  if (r1.isOk()) assertEquals(r1.value, []);

  const r2 = parseProgressRows("");
  assertEquals(r2.isOk(), true);
  if (r2.isOk()) assertEquals(r2.value, []);
});

Deno.test("parseProgressRows skips header with various column names", () => {
  const content = [
    "| Scenario | Status | Description | Notes |",
    "| -------- | ------ | ----------- | ----- |",
    "| 1        | WIP    | something   |       |",
  ].join("\n");
  const result = parseProgressRows(content);
  assertEquals(result.isOk(), true);
  if (!result.isOk()) return;
  assertEquals(result.value.length, 1);
  assertEquals(result.value[0].scenario, "1");
  assertEquals(result.value[0].status, "WIP");
});

Deno.test("parseProgressRows handles separator with colons for alignment", () => {
  const content = [
    "| # | Status | Summary |",
    "| :-- | :------: | ------: |",
    "| 5 | VERIFIED | aligned |",
  ].join("\n");
  const result = parseProgressRows(content);
  assertEquals(result.isOk(), true);
  if (!result.isOk()) return;
  assertEquals(result.value.length, 1);
  assertEquals(result.value[0].scenario, "5");
});
