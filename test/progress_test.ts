import { assertEquals } from "jsr:@std/assert";
import { parseScenarioCount } from "../src/progress.ts";

Deno.test("parseScenarioCount counts data rows in scenario table", () => {
  const content = [
    "| # | Category | Description |",
    "| - | -------- | ----------- |",
    "| 1 | CLI | some desc |",
    "| 2 | Loop | another desc |",
    "| 3 | UX | third desc |",
  ].join("\n");
  assertEquals(parseScenarioCount(content), 3);
});

Deno.test("parseScenarioCount returns 0 for empty content", () => {
  assertEquals(parseScenarioCount(""), 0);
});

Deno.test("parseScenarioCount ignores header rows", () => {
  const content = [
    "| # | Category |",
    "| - | -------- |",
  ].join("\n");
  assertEquals(parseScenarioCount(content), 0);
});

Deno.test("parseScenarioCount handles multi-digit scenario numbers", () => {
  const content = [
    "| 1  | CLI | desc |",
    "| 10 | UX  | desc |",
    "| 20 | UX  | desc |",
  ].join("\n");
  assertEquals(parseScenarioCount(content), 3);
});
