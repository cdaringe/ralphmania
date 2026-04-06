/**
 * Synthetic spec and progress content for simulation mode.
 *
 * Generates realistic-looking markdown that the orchestrator's parsers
 * can consume without hitting disk.
 *
 * @module
 */

/** Generate a synthetic specification.md for N scenarios. */
export const generateSimSpec = (scenarioCount: number): string => {
  const scenarios = Array.from({ length: scenarioCount }, (_, i) => {
    const id = i + 1;
    return `### Scenario ${id}: Feature ${id}\n\nImplement feature ${id} with full test coverage.`;
  });

  return `# Simulated Specification

END_DEMO

## Scenarios

${scenarios.join("\n\n")}
`;
};

/** Generate scenario IDs for N scenarios (matches parseScenarioIds output). */
export const generateSimScenarioIds = (
  scenarioCount: number,
): readonly string[] =>
  Array.from({ length: scenarioCount }, (_, i) => `${i + 1}`);

/**
 * Generate a progress.md table with given statuses.
 * Keys are scenario IDs, values are status strings.
 */
export const generateSimProgress = (
  statuses: ReadonlyMap<string, string>,
): string => {
  const rows = [...statuses.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, status]) =>
      `| ${id} | ${status} | docs/scenarios/feature-${id}.md | |`
    );

  return `# Progress

END_DEMO

| # | Status | Summary | Rework Notes |
|---|--------|---------|--------------|
${rows.join("\n")}
`;
};
