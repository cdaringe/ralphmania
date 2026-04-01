import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { updateProgressRow } from "../src/parsers/progress-update.ts";

const SAMPLE_PROGRESS = `<!-- END_DEMO -->

# Progress

| #          | Status       | Summary                                                | Rework Notes                                   |
| ---------- | ------------ | ------------------------------------------------------ | ---------------------------------------------- |
| ARCH.1     | VERIFIED     | [Hexagonal architecture](docs/scenarios/ARCH.1.md)     |                                                |
| 2          | WIP          | [CLI flags](docs/scenarios/2.md)                       |                                                |
| GUI.a      | VERIFIED     | [Realtime GUI](docs/scenarios/GUI.a.md)                |                                                |
`;

Deno.test("updateProgressRow — updates status and rework notes for matching row", () => {
  const result = updateProgressRow(SAMPLE_PROGRESS, {
    scenarioId: "ARCH.1",
    status: "NEEDS_REWORK",
    reworkNotes: "Missing port abstraction",
  });
  assertEquals(result.isOk(), true);
  if (!result.isOk()) return;
  const lines = result.value.split("\n");
  const arch1Line = lines.find((l) => l.includes("ARCH.1"));
  assertEquals(arch1Line?.includes("NEEDS_REWORK"), true);
  assertEquals(arch1Line?.includes("Missing port abstraction"), true);
  // Other rows unchanged.
  const row2 = lines.find((l) => l.includes("| 2 "));
  assertEquals(row2?.includes("WIP"), true);
  const guiRow = lines.find((l) => l.includes("GUI.a"));
  assertEquals(guiRow?.includes("VERIFIED"), true);
});

Deno.test("updateProgressRow — preserves non-table content exactly", () => {
  const result = updateProgressRow(SAMPLE_PROGRESS, {
    scenarioId: "2",
    status: "NEEDS_REWORK",
    reworkNotes: "Broken flags",
  });
  assertEquals(result.isOk(), true);
  if (!result.isOk()) return;
  assertEquals(result.value.startsWith("<!-- END_DEMO -->"), true);
  assertEquals(result.value.includes("# Progress"), true);
});

Deno.test("updateProgressRow — returns error for unknown scenario", () => {
  const result = updateProgressRow(SAMPLE_PROGRESS, {
    scenarioId: "NOPE",
    status: "NEEDS_REWORK",
    reworkNotes: "",
  });
  assertEquals(result.isOk(), false);
  if (result.isOk()) return;
  assertEquals(result.error.includes("NOPE"), true);
});

Deno.test("updateProgressRow — returns error for content with no table", () => {
  const result = updateProgressRow("# Just a heading\nSome text\n", {
    scenarioId: "1",
    status: "NEEDS_REWORK",
    reworkNotes: "",
  });
  assertEquals(result.isOk(), false);
});

Deno.test("updateProgressRow — handles reordered columns", () => {
  const reordered = `| Status | # | Summary | Rework Notes |
| ------ | - | ------- | ------------ |
| WIP    | X | test    |              |
`;
  const result = updateProgressRow(reordered, {
    scenarioId: "X",
    status: "NEEDS_REWORK",
    reworkNotes: "Fix it",
  });
  assertEquals(result.isOk(), true);
  if (!result.isOk()) return;
  assertEquals(result.value.includes("NEEDS_REWORK"), true);
  assertEquals(result.value.includes("Fix it"), true);
});
