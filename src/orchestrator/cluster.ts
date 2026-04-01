/**
 * Conflict-aware scenario clustering for parallel dispatch.
 *
 * Provides logic to group scenarios by their Area metadata and select
 * at most one scenario per cluster per parallel batch, avoiding work
 * that would likely touch the same files or share the same topic.
 *
 * @module
 */

import type { Logger } from "../types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A named group of scenario IDs that are likely to conflict. */
export type Cluster = {
  readonly id: string;
  readonly scenarios: readonly string[];
};

/** Dependencies for the clustering function. */
export type ClusterDeps = {
  readonly runFastCall: (prompt: string) => Promise<string>;
};

// ---------------------------------------------------------------------------
// Spec area parsing
// ---------------------------------------------------------------------------

/**
 * Parse the Area column from a markdown spec table.
 * Expected format: `| # | Area | Scenario |`
 * Returns a Map from scenario ID to area name.
 */
export const parseSpecAreas = (specContent: string): Map<string, string> => {
  const areaMap = new Map<string, string>();
  const lines = specContent.split("\n");
  let inTable = false;
  let headerFound = false;
  let areaColIndex = -1;
  let idColIndex = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      if (inTable && headerFound) {
        // Table ended
        inTable = false;
        headerFound = false;
        areaColIndex = -1;
        idColIndex = -1;
      }
      continue;
    }

    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

    if (!headerFound) {
      // Look for header row with # and Area columns
      const lowerCells = cells.map((c) => c.toLowerCase());
      if (lowerCells.includes("#") && lowerCells.includes("area")) {
        idColIndex = lowerCells.indexOf("#");
        areaColIndex = lowerCells.indexOf("area");
        inTable = true;
        headerFound = true;
      }
      continue;
    }

    // Skip separator rows (like | --- | --- |)
    if (cells.every((c) => /^[-:]+$/.test(c))) {
      continue;
    }

    if (inTable && idColIndex >= 0 && areaColIndex >= 0) {
      const id = cells[idColIndex];
      const area = cells[areaColIndex];
      if (id && area) {
        areaMap.set(id, area);
      }
    }
  }

  return areaMap;
};

// ---------------------------------------------------------------------------
// Clustering prompt
// ---------------------------------------------------------------------------

/**
 * Build a prompt asking a fast model to cluster scenarios by conflict likelihood.
 * The model should return ONLY valid JSON.
 */
export const buildClusteringPrompt = (
  scenarioIds: string[],
  areaMap: Map<string, string>,
): string => {
  const scenarioList = scenarioIds
    .map((id) => {
      const area = areaMap.get(id);
      return area ? `- ${id} (Area: ${area})` : `- ${id}`;
    })
    .join("\n");

  return `You are a conflict-detection agent. Given the following scenarios and their areas, group them into clusters where each cluster contains scenarios that are likely to touch the same files or share the same topic. Scenarios in the same Area should generally be in the same cluster.

Scenarios:
${scenarioList}

Respond with ONLY valid JSON in this exact format:
{"clusters":[{"id":"AreaName","scenarios":["id1","id2"]}]}

Every scenario must appear in exactly one cluster. Do not include any other text, explanation, or markdown.`;
};

// ---------------------------------------------------------------------------
// Parse model response
// ---------------------------------------------------------------------------

type ClusteringResponseShape = {
  readonly clusters: ReadonlyArray<
    { readonly id: string; readonly scenarios: readonly string[] }
  >;
};

/**
 * Extract and parse JSON clusters from a model response.
 * Tries the full text first, then looks for a `{...}` block.
 * Returns null if no valid clusters found.
 */
export const parseClusteringResponse = (text: string): Cluster[] | null => {
  const tryParse = (raw: string): Cluster[] | null => {
    try {
      const parsed = JSON.parse(raw) as ClusteringResponseShape;
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.clusters)
      ) {
        const clusters: Cluster[] = parsed.clusters.map((c) => ({
          id: String(c.id),
          scenarios: Array.isArray(c.scenarios) ? c.scenarios.map(String) : [],
        }));
        return clusters;
      }
    } catch {
      // ignore parse errors
    }
    return null;
  };

  // Try whole text
  const direct = tryParse(text);
  if (direct !== null) return direct;

  // Try to find a JSON object in the text
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    const embedded = tryParse(match[0]);
    if (embedded !== null) return embedded;
  }

  return null;
};

// ---------------------------------------------------------------------------
// Pure area-based fallback clustering
// ---------------------------------------------------------------------------

/**
 * Group scenarios by their Area tag, with unrecognized scenarios grouped as "Unknown".
 */
export const clusterByArea = (
  scenarioIds: string[],
  areaMap: Map<string, string>,
): Cluster[] => {
  const byArea = new Map<string, string[]>();

  for (const id of scenarioIds) {
    const area = areaMap.get(id) ?? "Unknown";
    const existing = byArea.get(area);
    if (existing) {
      existing.push(id);
    } else {
      byArea.set(area, [id]);
    }
  }

  const clusters: Cluster[] = [];
  for (const [area, scenarios] of byArea) {
    clusters.push({ id: area, scenarios });
  }

  return clusters;
};

// ---------------------------------------------------------------------------
// Batch selection
// ---------------------------------------------------------------------------

/**
 * Pick one scenario per cluster in priority order (as given by orderedIds),
 * up to the given parallelism limit.
 */
export const selectBatchFromClusters = (
  clusters: Cluster[],
  orderedIds: readonly string[],
  parallelism: number,
): string[] => {
  const batch: string[] = [];
  const usedClusters = new Set<string>();

  // Build a map from scenario ID to its cluster ID for fast lookup
  const scenarioToCluster = new Map<string, string>();
  for (const cluster of clusters) {
    for (const id of cluster.scenarios) {
      scenarioToCluster.set(id, cluster.id);
    }
  }

  for (const id of orderedIds) {
    if (batch.length >= parallelism) break;
    const clusterId = scenarioToCluster.get(id);
    if (clusterId === undefined) {
      // Not in any cluster — include it (safety net)
      batch.push(id);
      continue;
    }
    if (!usedClusters.has(clusterId)) {
      usedClusters.add(clusterId);
      batch.push(id);
    }
  }

  return batch;
};

// ---------------------------------------------------------------------------
// Main clustering function
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cluster cache — skip LLM call when scenario set hasn't changed
// ---------------------------------------------------------------------------

let cachedKey: string | undefined;
let cachedClusters: Cluster[] | undefined;

const cacheKey = (ids: readonly string[]): string => ids.slice().sort().join(",");

/** Clear the cluster cache (useful for testing). */
export const clearClusterCache = (): void => {
  cachedKey = undefined;
  cachedClusters = undefined;
};

/**
 * Main entry point. Tries the fast model for clustering; falls back to
 * area-based clustering if the model fails or returns incomplete coverage.
 * Results are cached — repeated calls with the same scenario set skip the LLM.
 */
export const clusterScenarios = async ({
  scenarioIds,
  specContent,
  log,
  deps,
}: {
  readonly scenarioIds: string[];
  readonly specContent: string;
  readonly log: Logger;
  readonly deps: ClusterDeps;
}): Promise<Cluster[]> => {
  // Edge cases: 0 or 1 scenario — no clustering needed
  if (scenarioIds.length <= 1) {
    return scenarioIds.map((id) => ({ id, scenarios: [id] }));
  }

  // Return cached result if the scenario set hasn't changed.
  const key = cacheKey(scenarioIds);
  if (key === cachedKey && cachedClusters !== undefined) {
    log({
      tags: ["debug", "orchestrator"],
      message: `Reusing cached clustering for ${scenarioIds.length} scenarios`,
    });
    return cachedClusters;
  }

  const areaMap = parseSpecAreas(specContent);
  const prompt = buildClusteringPrompt(scenarioIds, areaMap);

  try {
    const response = await deps.runFastCall(prompt);
    const parsed = parseClusteringResponse(response);

    if (parsed !== null) {
      // Validate coverage: every input scenario must appear in exactly one cluster
      const covered = new Set<string>();
      for (const cluster of parsed) {
        for (const id of cluster.scenarios) {
          covered.add(id);
        }
      }

      const allCovered = scenarioIds.every((id) => covered.has(id));
      if (allCovered) {
        log({
          tags: ["info", "orchestrator"],
          message:
            `Clustered ${scenarioIds.length} scenarios into ${parsed.length} conflict groups via fast model`,
        });
        cachedKey = key;
        cachedClusters = parsed;
        return parsed;
      }

      log({
        tags: ["info", "orchestrator"],
        message:
          `Fast model clustering had incomplete coverage, falling back to area-based clustering`,
      });
    } else {
      log({
        tags: ["info", "orchestrator"],
        message:
          `Fast model returned unparseable response, falling back to area-based clustering`,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({
      tags: ["info", "orchestrator"],
      message:
        `Fast model clustering failed (${message}), falling back to area-based clustering`,
    });
  }

  const fallback = clusterByArea(scenarioIds, areaMap);
  cachedKey = key;
  cachedClusters = fallback;
  return fallback;
};
