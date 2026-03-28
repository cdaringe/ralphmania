import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { parseProgressRows } from "../../src/parsers/progress-rows.ts";

/** Unwrap a successful parse result or fail the test. */
const unwrap = (content: string) => {
  const result = parseProgressRows(content);
  assertEquals(
    result.isOk(),
    true,
    `Expected ok, got: ${result.isErr() && result.error}`,
  );
  if (result.isErr()) throw new Error("unreachable");
  return result.value;
};

// Basic parsing

Deno.test("parses well-formed rows", () => {
  const content = [
    "| # | Status | Summary | Notes |",
    "| -- | ------ | ------- | ----- |",
    "| 1  | VERIFIED | done | |",
    "| 2  | WIP      | wip  | |",
  ].join("\n");
  const rows = unwrap(content);
  assertEquals(rows.length, 2);
  assertEquals(rows[0], {
    scenario: "1",
    status: "VERIFIED",
    summary: "done",
    reworkNotes: "",
  });
  assertEquals(rows[1], {
    scenario: "2",
    status: "WIP",
    summary: "wip",
    reworkNotes: "",
  });
});

Deno.test("skips header and separator rows", () => {
  const content = [
    "| #  | Status   | Summary |",
    "| -- | -------- | ------- |",
    "| 1  | VERIFIED | done    |",
  ].join("\n");
  assertEquals(unwrap(content).length, 1);
});

Deno.test("returns empty array for empty content", () => {
  assertEquals(unwrap(""), []);
});

Deno.test("returns empty array for non-table content", () => {
  assertEquals(unwrap("# Progress\n\nSome text here"), []);
});

// Resilience to imperfect markdown tables

Deno.test("handles missing trailing pipe", () => {
  const rows = unwrap(
    "| # | Status | Summary |\n| -- | -- | -- |\n| 1 | VERIFIED | done",
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "VERIFIED");
  assertEquals(rows[0].summary, "done");
});

Deno.test("handles missing leading pipe on non-table lines gracefully", () => {
  const content = [
    "| # | Status | Summary |",
    "| -- | -- | -- |",
    "1 | VERIFIED | done |",
    "| 2 | WIP | wip |",
  ].join("\n");
  const rows = unwrap(content);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].scenario, "2");
});

Deno.test("handles extra whitespace in cells", () => {
  const rows = unwrap(
    "| # | Status |\n| -- | -- |\n|  1  |   VERIFIED   |   done   |    |",
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "VERIFIED");
  assertEquals(rows[0].summary, "done");
});

Deno.test("handles leading whitespace on the line", () => {
  const rows = unwrap("| # | Status |\n| -- | -- |\n  | 1 | VERIFIED | done |");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "VERIFIED");
});

Deno.test("handles empty status (unstarted scenario)", () => {
  const rows = unwrap("| # | Status |\n| -- | -- |\n| 1 |          |      |");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "");
  assertEquals(rows[0].summary, "");
});

Deno.test("handles row with only scenario and status columns", () => {
  const rows = unwrap("| # | Status |\n| -- | -- |\n| 5 | WIP |");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].scenario, "5");
  assertEquals(rows[0].status, "WIP");
  assertEquals(rows[0].summary, "");
  assertEquals(rows[0].reworkNotes, "");
});

Deno.test("handles multi-digit scenario numbers", () => {
  const rows = unwrap(
    "| # | Status |\n| -- | -- |\n| 42 | VERIFIED | done | |",
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0].scenario, "42");
});

Deno.test("handles markdown link in summary column", () => {
  const rows = unwrap(
    "| # | Status |\n| -- | -- |\n| 1 | VERIFIED | [Link text](docs/scenarios/01-foo.md) | |",
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0].summary, "[Link text](docs/scenarios/01-foo.md)");
});

Deno.test("handles rework notes with content", () => {
  const rows = unwrap(
    "| # | Status |\n| -- | -- |\n| 3 | NEEDS_REWORK | some task | fix the parsing |",
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0].reworkNotes, "fix the parsing");
});

Deno.test("skips blank lines between rows", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1 | VERIFIED | done | |",
    "",
    "| 2 | WIP | wip | |",
  ].join("\n");
  assertEquals(unwrap(content).length, 2);
});

Deno.test("skips comment-like lines", () => {
  const content = [
    "<!-- END_DEMO -->",
    "| # | Status |",
    "| -- | -- |",
    "| 1 | VERIFIED | done | |",
  ].join("\n");
  assertEquals(unwrap(content).length, 1);
});

Deno.test("handles inconsistent column counts across rows", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1 | VERIFIED | done | notes | extra |",
    "| 2 | WIP |",
  ].join("\n");
  const rows = unwrap(content);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].reworkNotes, "notes");
  assertEquals(rows[1].summary, "");
});

Deno.test("handles Windows-style line endings", () => {
  const content =
    "| # | Status |\r\n| -- | -- |\r\n| 1 | VERIFIED | done | |\r\n| 2 | WIP | wip | |";
  const rows = unwrap(content);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].status, "VERIFIED");
  assertEquals(rows[1].status, "WIP");
});

Deno.test("does not confuse separator-only rows as data", () => {
  const content = [
    "| -- | -------- | ---- | ---- |",
    "| 1  | VERIFIED | done |      |",
  ].join("\n");
  const rows = unwrap(content);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].scenario, "1");
});

Deno.test("preserves row order", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 3 | WIP | |",
    "| 1 | VERIFIED | |",
    "| 2 | NEEDS_REWORK | |",
  ].join("\n");
  const rows = unwrap(content);
  assertEquals(rows.map((r) => r.scenario), ["3", "1", "2"]);
});

Deno.test("regression: last row without trailing pipe is parsed correctly", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1  | VERIFIED",
    "| 2  |         ",
    "| 18 | VERIFIED",
  ].join("\n");
  const rows = unwrap(content);
  assertEquals(rows.length, 3);
  assertEquals(rows[0].status, "VERIFIED");
  assertEquals(rows[1].status, "");
  assertEquals(rows[2].status, "VERIFIED");
});

Deno.test("parses float scenario IDs like 18.1, 18.2", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 18.1 | VERIFIED | done |",
    "| 18.2 | WIP | wip |",
    "| 18.3 |          |      |",
  ].join("\n");
  const rows = unwrap(content);
  assertEquals(rows.length, 3);
  assertEquals(rows[0].scenario, "18.1");
  assertEquals(rows[1].scenario, "18.2");
  assertEquals(rows[2].scenario, "18.3");
});

Deno.test("parses mixed integer and float scenario IDs", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| 1   | VERIFIED | done |",
    "| 1.1 | WIP | sub |",
    "| 2   | WORK_COMPLETE | done |",
  ].join("\n");
  const rows = unwrap(content);
  assertEquals(rows.map((r) => r.scenario), ["1", "1.1", "2"]);
});

Deno.test("parses arbitrary string scenario IDs like GUI.1, FOO.1", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "| GUI.1 | VERIFIED | done |",
    "| GUI.2 | WIP      | wip  |",
    "| FOO.1 |          |      |",
  ].join("\n");
  const rows = unwrap(content);
  assertEquals(rows.length, 3);
  assertEquals(rows[0].scenario, "GUI.1");
  assertEquals(rows[1].scenario, "GUI.2");
  assertEquals(rows[2].scenario, "FOO.1");
});

Deno.test("handles real-world progress.md content after END_DEMO split", () => {
  const content = ` -->

# Progress

| #  | Status   | Summary                                                       | Rework Notes |
| -- | -------- | ------------------------------------------------------------- | ------------ |
| 1  | VERIFIED | [Interactive prompting](docs/scenarios/01-interactive.md)      |              |
| 2  |          |                                                               |              |
| 3  | WIP      | [Some feature](docs/scenarios/03-feature.md)                  |              |
| 4  | OBSOLETE | [Removed feature](docs/scenarios/04-old.md)                   |              |
`;
  const rows = unwrap(content);
  assertEquals(rows.length, 4);
  assertEquals(rows[0], {
    scenario: "1",
    status: "VERIFIED",
    summary: "[Interactive prompting](docs/scenarios/01-interactive.md)",
    reworkNotes: "",
  });
  assertEquals(rows[1].status, "");
  assertEquals(rows[2].status, "WIP");
  assertEquals(rows[3].status, "OBSOLETE");
});

Deno.test("returns error for row with empty scenario ID", () => {
  const content = [
    "| # | Status |",
    "| -- | -- |",
    "|   | WIP | oops |",
  ].join("\n");
  const result = parseProgressRows(content);
  assertEquals(result.isErr(), true);
  if (result.isErr()) {
    assertEquals(result.error.includes("empty scenario ID"), true);
  }
});
