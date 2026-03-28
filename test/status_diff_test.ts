import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.11";
import { computeStatusDiff, generateStatusHtml } from "../src/status-diff.ts";
import type { ProgressRow } from "../src/parsers/progress-rows.ts";

const row = (
  scenario: string,
  status: string,
  summary = "",
): ProgressRow => ({
  scenario,
  status,
  summary,
  reworkNotes: "",
});

// ---------------------------------------------------------------------------
// computeStatusDiff
// ---------------------------------------------------------------------------

Deno.test("computeStatusDiff — empty inputs yields all-empty diff", () => {
  const diff = computeStatusDiff([], []);
  assertEquals(diff.specOnly, []);
  assertEquals(diff.progressOnly, []);
  assertEquals(diff.shared, []);
});

Deno.test("computeStatusDiff — spec IDs with no progress rows → all specOnly", () => {
  const diff = computeStatusDiff(["A", "B"], []);
  assertEquals(diff.specOnly, ["A", "B"]);
  assertEquals(diff.progressOnly, []);
  assertEquals(diff.shared, []);
});

Deno.test("computeStatusDiff — progress rows with no spec IDs → all progressOnly", () => {
  const diff = computeStatusDiff([], [row("X", "VERIFIED"), row("Y", "WIP")]);
  assertEquals(diff.specOnly, []);
  assertEquals(diff.progressOnly, ["X", "Y"]);
  assertEquals(diff.shared, []);
});

Deno.test("computeStatusDiff — fully shared set", () => {
  const diff = computeStatusDiff(
    ["A"],
    [row("A", "VERIFIED", "summary text")],
  );
  assertEquals(diff.specOnly, []);
  assertEquals(diff.progressOnly, []);
  assertEquals(diff.shared, [{
    id: "A",
    status: "VERIFIED",
    summary: "summary text",
  }]);
});

Deno.test("computeStatusDiff — mixed specOnly, progressOnly, and shared", () => {
  const diff = computeStatusDiff(
    ["A", "B", "C"],
    [row("B", "WIP", "in progress"), row("D", "VERIFIED", "done")],
  );
  assertEquals(diff.specOnly, ["A", "C"]);
  assertEquals(diff.progressOnly, ["D"]);
  assertEquals(diff.shared, [{
    id: "B",
    status: "WIP",
    summary: "in progress",
  }]);
});

// ---------------------------------------------------------------------------
// generateStatusHtml
// ---------------------------------------------------------------------------

Deno.test("generateStatusHtml — verified count and total in summary", () => {
  const diff = computeStatusDiff(
    ["ARCH.1", "ARCH.2"],
    [row("ARCH.1", "VERIFIED", "done"), row("ARCH.2", "WIP", "in progress")],
  );
  const html = generateStatusHtml(diff);
  assertStringIncludes(html, "1 / 2 verified");
  assertStringIncludes(html, "ARCH.1");
  assertStringIncludes(html, "VERIFIED");
  assertStringIncludes(html, "ARCH.2");
  assertStringIncludes(html, "WIP");
  assertStringIncludes(html, "done");
});

Deno.test("generateStatusHtml — specOnly scenarios appear as NOT_STARTED", () => {
  const diff = computeStatusDiff(["NEW.1", "NEW.2"], []);
  const html = generateStatusHtml(diff);
  assertStringIncludes(html, "NEW.1");
  assertStringIncludes(html, "NEW.2");
  assertStringIncludes(html, "NOT_STARTED");
  assertStringIncludes(html, "0 / 2 verified");
});

Deno.test("generateStatusHtml — progressOnly scenarios appear as ORPHANED with note", () => {
  const diff = computeStatusDiff([], [row("OLD.1", "VERIFIED")]);
  const html = generateStatusHtml(diff);
  assertStringIncludes(html, "OLD.1");
  assertStringIncludes(html, "ORPHANED");
  assertStringIncludes(html, "1 orphaned");
});

Deno.test("generateStatusHtml — no orphaned note when progressOnly is empty", () => {
  const diff = computeStatusDiff(
    ["A.1"],
    [row("A.1", "VERIFIED", "all good")],
  );
  const html = generateStatusHtml(diff);
  assertStringIncludes(html, "1 / 1 verified");
  assertEquals(html.includes("· 0 orphaned"), false);
  assertEquals(html.includes("· 1 orphaned"), false);
});

Deno.test("generateStatusHtml — NEEDS_REWORK status renders with correct CSS class", () => {
  const diff = computeStatusDiff(
    ["S.1"],
    [row("S.1", "NEEDS_REWORK", "broken")],
  );
  const html = generateStatusHtml(diff);
  assertStringIncludes(html, "NEEDS_REWORK");
  assertStringIncludes(html, "needs-rework");
});
