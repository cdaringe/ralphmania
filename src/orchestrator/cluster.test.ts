import { assertEquals, assertNotEquals } from "jsr:@std/assert@^1";
import type { Logger } from "../types.ts";
import {
  buildClusteringPrompt,
  clearClusterCache,
  clusterByArea,
  clusterScenarios,
  parseClusteringResponse,
  parseSpecAreas,
  selectBatchFromClusters,
} from "./cluster.ts";

// ---------------------------------------------------------------------------
// parseSpecAreas
// ---------------------------------------------------------------------------

const specWithAreas = `
# Scenarios

| #      | Area         | Scenario                       |
| ------ | ------------ | ------------------------------ |
| ARCH.1 | Architecture | Some scenario                  |
| ARCH.2 | Architecture | Another scenario               |
| 1      | UX           | A UX scenario                  |
| 2      | CLI          | A CLI scenario                 |
`.trim();

Deno.test("parseSpecAreas: parses spec table areas correctly", () => {
  const result = parseSpecAreas(specWithAreas);
  assertEquals(result.get("ARCH.1"), "Architecture");
  assertEquals(result.get("ARCH.2"), "Architecture");
  assertEquals(result.get("1"), "UX");
  assertEquals(result.get("2"), "CLI");
});

Deno.test("parseSpecAreas: returns empty map for empty content", () => {
  const result = parseSpecAreas("");
  assertEquals(result.size, 0);
});

Deno.test("parseSpecAreas: handles separator row without including it", () => {
  const result = parseSpecAreas(specWithAreas);
  // No entry with key "---" from separator row
  assertEquals(result.has("---"), false);
  assertEquals(result.has("------"), false);
});

Deno.test("parseSpecAreas: returns empty map when no table present", () => {
  const noTable = "Just some text\nwithout any table";
  const result = parseSpecAreas(noTable);
  assertEquals(result.size, 0);
});

Deno.test("parseSpecAreas: handles table followed by non-table content", () => {
  const specWithTrailingText = `
| #      | Area         | Scenario     |
| ------ | ------------ | ------------ |
| ARCH.1 | Architecture | Some scenario|

Some trailing text after the table.
`.trim();
  const result = parseSpecAreas(specWithTrailingText);
  // Should still have parsed the table rows
  assertEquals(result.get("ARCH.1"), "Architecture");
});

Deno.test("parseSpecAreas: handles table without area column", () => {
  const noAreaTable = `
| #    | Status   | Notes |
| ---- | -------- | ----- |
| FOO  | VERIFIED | done  |
`.trim();
  const result = parseSpecAreas(noAreaTable);
  assertEquals(result.size, 0);
});

// ---------------------------------------------------------------------------
// buildClusteringPrompt
// ---------------------------------------------------------------------------

Deno.test("buildClusteringPrompt: contains all scenario IDs", () => {
  const ids = ["ARCH.1", "ARCH.2", "1"];
  const areaMap = new Map([
    ["ARCH.1", "Architecture"],
    ["ARCH.2", "Architecture"],
    ["1", "UX"],
  ]);
  const prompt = buildClusteringPrompt(ids, areaMap);
  assertEquals(prompt.includes("ARCH.1"), true);
  assertEquals(prompt.includes("ARCH.2"), true);
  assertEquals(prompt.includes("1"), true);
});

Deno.test("buildClusteringPrompt: contains area names", () => {
  const ids = ["ARCH.1", "1"];
  const areaMap = new Map([["ARCH.1", "Architecture"], ["1", "UX"]]);
  const prompt = buildClusteringPrompt(ids, areaMap);
  assertEquals(prompt.includes("Architecture"), true);
  assertEquals(prompt.includes("UX"), true);
});

Deno.test("buildClusteringPrompt: includes JSON format instruction", () => {
  const prompt = buildClusteringPrompt(["ARCH.1"], new Map());
  assertEquals(prompt.includes('"clusters"'), true);
  assertEquals(prompt.includes("ONLY valid JSON"), true);
});

Deno.test("buildClusteringPrompt: handles scenario with no area", () => {
  const ids = ["UNKNOWN.1"];
  const areaMap = new Map<string, string>();
  const prompt = buildClusteringPrompt(ids, areaMap);
  assertEquals(prompt.includes("UNKNOWN.1"), true);
  // Should not throw
});

// ---------------------------------------------------------------------------
// parseClusteringResponse
// ---------------------------------------------------------------------------

Deno.test("parseClusteringResponse: parses valid JSON directly", () => {
  const json = JSON.stringify({
    clusters: [
      { id: "Architecture", scenarios: ["ARCH.1", "ARCH.2"] },
      { id: "UX", scenarios: ["1"] },
    ],
  });
  const result = parseClusteringResponse(json);
  assertNotEquals(result, null);
  assertEquals(result?.length, 2);
  assertEquals(result?.[0]?.id, "Architecture");
  assertEquals(result?.[0]?.scenarios, ["ARCH.1", "ARCH.2"]);
});

Deno.test("parseClusteringResponse: extracts JSON embedded in text", () => {
  const text =
    `Here are the clusters:\n{"clusters":[{"id":"Loop","scenarios":["4","5"]}]}\nDone.`;
  const result = parseClusteringResponse(text);
  assertNotEquals(result, null);
  assertEquals(result?.length, 1);
  assertEquals(result?.[0]?.id, "Loop");
});

Deno.test("parseClusteringResponse: returns null for invalid JSON", () => {
  const result = parseClusteringResponse("not json at all");
  assertEquals(result, null);
});

Deno.test("parseClusteringResponse: returns null for empty string", () => {
  const result = parseClusteringResponse("");
  assertEquals(result, null);
});

Deno.test("parseClusteringResponse: returns null for JSON without clusters key", () => {
  const result = parseClusteringResponse('{"foo":"bar"}');
  assertEquals(result, null);
});

Deno.test("parseClusteringResponse: handles clusters with empty scenarios array", () => {
  const json = JSON.stringify({
    clusters: [{ id: "Empty", scenarios: [] }],
  });
  const result = parseClusteringResponse(json);
  assertNotEquals(result, null);
  assertEquals(result?.[0]?.scenarios.length, 0);
});

Deno.test("parseClusteringResponse: handles clusters with non-array scenarios", () => {
  // When scenarios is not an array, it falls back to empty array
  const json = '{"clusters":[{"id":"Broken","scenarios":null}]}';
  const result = parseClusteringResponse(json);
  assertNotEquals(result, null);
  assertEquals(result?.[0]?.scenarios.length, 0);
});

// ---------------------------------------------------------------------------
// clusterByArea
// ---------------------------------------------------------------------------

Deno.test("clusterByArea: groups scenarios by area", () => {
  const ids = ["ARCH.1", "ARCH.2", "1", "2"];
  const areaMap = new Map([
    ["ARCH.1", "Architecture"],
    ["ARCH.2", "Architecture"],
    ["1", "UX"],
    ["2", "UX"],
  ]);
  const clusters = clusterByArea(ids, areaMap);
  const archCluster = clusters.find((c) => c.id === "Architecture");
  const uxCluster = clusters.find((c) => c.id === "UX");
  assertNotEquals(archCluster, undefined);
  assertNotEquals(uxCluster, undefined);
  assertEquals(archCluster?.scenarios.length, 2);
  assertEquals(uxCluster?.scenarios.length, 2);
});

Deno.test("clusterByArea: scenario without area goes to Unknown cluster", () => {
  const ids = ["MYSTERY.1"];
  const areaMap = new Map<string, string>();
  const clusters = clusterByArea(ids, areaMap);
  assertEquals(clusters.length, 1);
  assertEquals(clusters[0]?.id, "Unknown");
  assertEquals(clusters[0]?.scenarios, ["MYSTERY.1"]);
});

Deno.test("clusterByArea: returns empty array for empty input", () => {
  const clusters = clusterByArea([], new Map());
  assertEquals(clusters.length, 0);
});

Deno.test("clusterByArea: each scenario in exactly one cluster", () => {
  const ids = ["A", "B", "C"];
  const areaMap = new Map([["A", "X"], ["B", "Y"], ["C", "X"]]);
  const clusters = clusterByArea(ids, areaMap);
  const allScenarios = clusters.flatMap((c) => [...c.scenarios]);
  assertEquals(allScenarios.sort(), ["A", "B", "C"].sort());
});

// ---------------------------------------------------------------------------
// selectBatchFromClusters
// ---------------------------------------------------------------------------

Deno.test("selectBatchFromClusters: picks one per cluster up to parallelism", () => {
  const clusters = [
    { id: "Architecture", scenarios: ["ARCH.1", "ARCH.2"] },
    { id: "UX", scenarios: ["1"] },
    { id: "CLI", scenarios: ["2", "3"] },
  ];
  const ordered = ["ARCH.1", "1", "2", "ARCH.2", "3"];
  const batch = selectBatchFromClusters(clusters, ordered, 3);
  assertEquals(batch.length, 3);
  assertEquals(batch.includes("ARCH.1"), true);
  assertEquals(batch.includes("1"), true);
  assertEquals(batch.includes("2"), true);
  // ARCH.2 should NOT be in the batch (Architecture cluster already used)
  assertEquals(batch.includes("ARCH.2"), false);
});

Deno.test("selectBatchFromClusters: respects parallelism limit", () => {
  const clusters = [
    { id: "A", scenarios: ["1"] },
    { id: "B", scenarios: ["2"] },
    { id: "C", scenarios: ["3"] },
  ];
  const ordered = ["1", "2", "3"];
  const batch = selectBatchFromClusters(clusters, ordered, 2);
  assertEquals(batch.length, 2);
});

Deno.test("selectBatchFromClusters: priority order is respected", () => {
  const clusters = [
    { id: "Loop", scenarios: ["4", "5", "22"] },
    { id: "Validation", scenarios: ["6", "7"] },
  ];
  // 22 comes before 4 in ordered list - 22 should be picked for Loop cluster
  const ordered = ["22", "4", "6"];
  const batch = selectBatchFromClusters(clusters, ordered, 2);
  assertEquals(batch[0], "22");
  assertEquals(batch[1], "6");
});

Deno.test("selectBatchFromClusters: handles scenario not in any cluster", () => {
  const clusters = [
    { id: "A", scenarios: ["1"] },
  ];
  // "orphan" is not in any cluster
  const ordered = ["1", "orphan"];
  const batch = selectBatchFromClusters(clusters, ordered, 3);
  assertEquals(batch.includes("orphan"), true);
});

Deno.test("selectBatchFromClusters: returns empty for empty input", () => {
  const batch = selectBatchFromClusters([], [], 5);
  assertEquals(batch.length, 0);
});

// ---------------------------------------------------------------------------
// clusterScenarios
// ---------------------------------------------------------------------------

Deno.test("clusterScenarios: 0 scenarios returns empty", async () => {
  clearClusterCache();
  const result = await clusterScenarios({
    scenarioIds: [],
    specContent: specWithAreas,
    log: () => {},
    deps: { runFastCall: () => Promise.resolve("") },
  });
  assertEquals(result, []);
});

Deno.test("clusterScenarios: 1 scenario returns single-element cluster", async () => {
  clearClusterCache();
  const result = await clusterScenarios({
    scenarioIds: ["ARCH.1"],
    specContent: specWithAreas,
    log: () => {},
    deps: { runFastCall: () => Promise.resolve("") },
  });
  assertEquals(result.length, 1);
  assertEquals(result[0]?.id, "ARCH.1");
  assertEquals(result[0]?.scenarios, ["ARCH.1"]);
});

Deno.test("clusterScenarios: fast model success path uses model clusters", async () => {
  clearClusterCache();
  const modelResponse = JSON.stringify({
    clusters: [
      { id: "Architecture", scenarios: ["ARCH.1", "ARCH.2"] },
      { id: "UX", scenarios: ["1"] },
    ],
  });
  const result = await clusterScenarios({
    scenarioIds: ["ARCH.1", "ARCH.2", "1"],
    specContent: specWithAreas,
    log: () => {},
    deps: { runFastCall: () => Promise.resolve(modelResponse) },
  });
  assertEquals(result.length, 2);
  const archCluster = result.find((c) => c.id === "Architecture");
  assertNotEquals(archCluster, undefined);
  assertEquals(archCluster?.scenarios.includes("ARCH.1"), true);
});

Deno.test("clusterScenarios: incomplete coverage falls back to area-based", async () => {
  clearClusterCache();
  // Model response only covers ARCH.1, not ARCH.2 or 1
  const incompleteResponse = JSON.stringify({
    clusters: [{ id: "Architecture", scenarios: ["ARCH.1"] }],
  });
  const logs: string[] = [];
  const result = await clusterScenarios({
    scenarioIds: ["ARCH.1", "ARCH.2", "1"],
    specContent: specWithAreas,
    log: ((opts) => {
      logs.push(opts.message);
    }) as Logger,
    deps: { runFastCall: () => Promise.resolve(incompleteResponse) },
  });
  // Should have fallen back to area-based clustering
  assertEquals(
    logs.some((m) => m.includes("falling back")),
    true,
  );
  // Area-based should cover all scenarios
  const allCovered = result.flatMap((c) => [...c.scenarios]);
  assertEquals(allCovered.includes("ARCH.1"), true);
  assertEquals(allCovered.includes("ARCH.2"), true);
  assertEquals(allCovered.includes("1"), true);
});

Deno.test("clusterScenarios: error from model falls back to area-based", async () => {
  clearClusterCache();
  const logs: string[] = [];
  const result = await clusterScenarios({
    scenarioIds: ["ARCH.1", "ARCH.2"],
    specContent: specWithAreas,
    log: ((opts) => {
      logs.push(opts.message);
    }) as Logger,
    deps: {
      runFastCall: () => Promise.reject(new Error("network failure")),
    },
  });
  assertEquals(
    logs.some((m) => m.includes("falling back") || m.includes("failed")),
    true,
  );
  const allCovered = result.flatMap((c) => [...c.scenarios]);
  assertEquals(allCovered.includes("ARCH.1"), true);
  assertEquals(allCovered.includes("ARCH.2"), true);
});

Deno.test("clusterScenarios: non-Error rejection falls back to area-based", async () => {
  clearClusterCache();
  const logs: string[] = [];
  const result = await clusterScenarios({
    scenarioIds: ["ARCH.1", "ARCH.2"],
    specContent: specWithAreas,
    log: ((opts) => {
      logs.push(opts.message);
    }) as Logger,
    deps: {
      // Reject with a non-Error value to cover the String(err) branch
      runFastCall: () => Promise.reject("string rejection"),
    },
  });
  assertEquals(
    logs.some((m) => m.includes("falling back") || m.includes("failed")),
    true,
  );
  const allCovered = result.flatMap((c) => [...c.scenarios]);
  assertEquals(allCovered.includes("ARCH.1"), true);
  assertEquals(allCovered.includes("ARCH.2"), true);
});

Deno.test("clusterScenarios: unparseable model response falls back to area-based", async () => {
  clearClusterCache();
  const logs: string[] = [];
  const result = await clusterScenarios({
    scenarioIds: ["ARCH.1", "1"],
    specContent: specWithAreas,
    log: ((opts) => {
      logs.push(opts.message);
    }) as Logger,
    deps: {
      runFastCall: () => Promise.resolve("I cannot determine clusters."),
    },
  });
  assertEquals(
    logs.some((m) => m.includes("falling back") || m.includes("unparseable")),
    true,
  );
  assertNotEquals(result.length, 0);
});
