import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  detectScenarioFromProgress,
  findReworkScenarios,
  orderActionableScenarios,
  parseImplementedCount,
  parseTotalCount,
  validateProgressStatuses,
} from "../src/orchestrator/progress-queries.ts";

// parseImplementedCount tests

Deno.test("parseImplementedCount counts WORK_COMPLETE rows", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1.1 | WORK_COMPLETE | done |",
    "| 1.2 |          |      |",
    "| 1.3 | VERIFIED | yep  |",
  ].join("\n");
  const r = parseImplementedCount(content);
  assertEquals(r.isOk(), true);
  if (r.isOk()) assertEquals(r.value, 2);
});

Deno.test("parseImplementedCount returns 0 when none implemented", () => {
  const r = parseImplementedCount(
    "| # | Status |\n| -- | -- |\n| 1.1 |          |      |",
  );
  assertEquals(r.isOk(), true);
  if (r.isOk()) assertEquals(r.value, 0);
});

// parseTotalCount tests

Deno.test("parseTotalCount counts all scenario rows", () => {
  const content = [
    "| #    | Status |",
    "| ---- | ------ |",
    "| 1.1  | WORK_COMPLETE |",
    "| 1.2  |          |",
  ].join("\n");
  const r = parseTotalCount(content);
  assertEquals(r.isOk(), true);
  if (r.isOk()) assertEquals(r.value, 2);
});

Deno.test("parseTotalCount excludes OBSOLETE rows", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1.1 | VERIFIED |",
    "| 1.2 | OBSOLETE |",
    "| 1.3 |          |",
  ].join("\n");
  const r = parseTotalCount(content);
  assertEquals(r.isOk(), true);
  if (r.isOk()) assertEquals(r.value, 2);
});

// detectScenarioFromProgress tests

Deno.test("detectScenarioFromProgress without NEEDS_REWORK", () => {
  const result = detectScenarioFromProgress(
    "| # | Status |\n| -- | -- |\n| 1.1 | COMPLETED |",
  );
  assertEquals(result.isOk(), true);
  if (result.isOk()) assertEquals(result.value, undefined);
});

Deno.test("detectScenarioFromProgress with NEEDS_REWORK", () => {
  const result = detectScenarioFromProgress(
    "| # | Status |\n| -- | -- |\n| 3.1 | NEEDS_REWORK | some notes",
  );
  assertEquals(result.isOk(), true);
  if (result.isOk()) assertEquals(result.value, "3.1");
});

Deno.test("detectScenarioFromProgress finds first NEEDS_REWORK", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1.1 | COMPLETED |",
    "| 2.1 | NEEDS_REWORK | fix it",
    "| 3.1 | NEEDS_REWORK | also fix",
  ].join("\n");
  const result = detectScenarioFromProgress(content);
  assertEquals(result.isOk(), true);
  if (result.isOk()) assertEquals(result.value, "2.1");
});

Deno.test("detectScenarioFromProgress empty content", () => {
  const result = detectScenarioFromProgress("");
  assertEquals(result.isOk(), true);
  if (result.isOk()) assertEquals(result.value, undefined);
});

// findReworkScenarios tests

Deno.test("findReworkScenarios finds all rework scenario numbers", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1.1 | WORK_COMPLETE |",
    "| 2.1 | NEEDS_REWORK | fix it |",
    "| 3.1 | VERIFIED |",
    "| 5.1 | NEEDS_REWORK | broken |",
  ].join("\n");
  const r = findReworkScenarios(content);
  assertEquals(r.isOk(), true);
  if (r.isOk()) assertEquals(r.value, ["2.1", "5.1"]);
});

Deno.test("findReworkScenarios returns empty for no rework", () => {
  const r = findReworkScenarios(
    "| # | Status |\n| -- | -- |\n| 1.1 | WORK_COMPLETE |",
  );
  assertEquals(r.isOk(), true);
  if (r.isOk()) assertEquals(r.value, []);
});

Deno.test("findReworkScenarios returns empty for empty content", () => {
  const r = findReworkScenarios("");
  assertEquals(r.isOk(), true);
  if (r.isOk()) assertEquals(r.value, []);
});

// validateProgressStatuses tests

Deno.test("validateProgressStatuses returns empty for all valid statuses", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1.1 | WIP |",
    "| 1.2 | WORK_COMPLETE |",
    "| 1.3 | VERIFIED |",
    "| 1.4 | NEEDS_REWORK |",
    "| 1.5 | OBSOLETE |",
  ].join("\n");
  const r = validateProgressStatuses(content);
  assertEquals(r.isOk(), true);
  if (r.isOk()) assertEquals(r.value, []);
});

Deno.test("validateProgressStatuses detects invalid statuses", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1.1 | VERIFIED |",
    "| 1.2 | COMPLETE |",
    "| 1.3 | DONE |",
  ].join("\n");
  const r = validateProgressStatuses(content);
  assertEquals(r.isOk(), true);
  if (r.isOk()) {
    assertEquals(r.value, [
      { scenario: "1.2", status: "COMPLETE" },
      { scenario: "1.3", status: "DONE" },
    ]);
  }
});

Deno.test("validateProgressStatuses ignores rows without status", () => {
  const content = "| # | Status |\n| -- | -- |\n| 1.1 |          |";
  const r = validateProgressStatuses(content);
  assertEquals(r.isOk(), true);
  if (r.isOk()) assertEquals(r.value, []);
});

// orderActionableScenarios tests

Deno.test("orderActionableScenarios: NEEDS_REWORK scenarios sort first", () => {
  const rows = [
    { scenario: "1", status: "NEEDS_REWORK", summary: "", reworkNotes: "" },
    { scenario: "2", status: "", summary: "", reworkNotes: "" },
    { scenario: "3", status: "VERIFIED", summary: "", reworkNotes: "" },
  ];
  const result = orderActionableScenarios(rows, ["1", "2", "3"]);
  assertEquals(result, ["1", "2"]);
});

Deno.test("orderActionableScenarios: excludes VERIFIED and OBSOLETE", () => {
  const rows = [
    { scenario: "1", status: "VERIFIED", summary: "", reworkNotes: "" },
    { scenario: "2", status: "OBSOLETE", summary: "", reworkNotes: "" },
    { scenario: "3", status: "", summary: "", reworkNotes: "" },
  ];
  const result = orderActionableScenarios(rows, ["1", "2", "3"]);
  assertEquals(result, ["3"]);
});

Deno.test("orderActionableScenarios: preserves spec order within each priority group", () => {
  const rows = [
    { scenario: "b", status: "NEEDS_REWORK", summary: "", reworkNotes: "" },
    { scenario: "a", status: "NEEDS_REWORK", summary: "", reworkNotes: "" },
    { scenario: "d", status: "", summary: "", reworkNotes: "" },
    { scenario: "c", status: "", summary: "", reworkNotes: "" },
  ];
  const result = orderActionableScenarios(rows, ["a", "b", "c", "d"]);
  assertEquals(result, ["a", "b", "c", "d"]);
});

Deno.test("orderActionableScenarios: returns empty when all done", () => {
  const rows = [
    { scenario: "1", status: "VERIFIED", summary: "", reworkNotes: "" },
    { scenario: "2", status: "OBSOLETE", summary: "", reworkNotes: "" },
  ];
  const result = orderActionableScenarios(rows, ["1", "2"]);
  assertEquals(result, []);
});
