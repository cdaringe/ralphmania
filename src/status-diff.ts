import type { ProgressRow } from "./parsers/progress-rows.ts";

export type ScenarioStatusEntry = {
  readonly id: string;
  readonly status: string;
  readonly summary: string;
};

/**
 * Set-theoretic diff between spec scenario IDs and progress rows.
 *
 * - `specOnly`:      in spec but not yet in progress (not started)
 * - `progressOnly`:  in progress but not in spec (orphaned / removed from spec)
 * - `shared`:        present in both; status + summary come from progress
 */
export type StatusDiff = {
  readonly specOnly: readonly string[];
  readonly progressOnly: readonly string[];
  readonly shared: readonly ScenarioStatusEntry[];
};

/**
 * Compute the set difference between specification scenario IDs and progress
 * rows. Pure function — no I/O.
 */
export const computeStatusDiff = (
  specIds: readonly string[],
  progressRows: readonly ProgressRow[],
): StatusDiff => {
  const specSet = new Set(specIds);
  const progressSet = new Set(progressRows.map((r) => r.scenario));

  return {
    specOnly: specIds.filter((id) => !progressSet.has(id)),
    progressOnly: progressRows
      .filter((r) => !specSet.has(r.scenario))
      .map((r) => r.scenario),
    shared: progressRows
      .filter((r) => specSet.has(r.scenario))
      .map((r) => ({ id: r.scenario, status: r.status, summary: r.summary })),
  };
};

/**
 * Generate a self-contained HTML page displaying overall status from a diff.
 * Pure function — no I/O.
 */
export const generateStatusHtml = (diff: StatusDiff): string => {
  const totalInSpec = diff.specOnly.length + diff.shared.length;
  const verifiedCount = diff.shared.filter((e) => e.status === "VERIFIED")
    .length;
  const orphanedNote = diff.progressOnly.length > 0
    ? ` · ${diff.progressOnly.length} orphaned`
    : "";

  const rows = [
    ...diff.shared.map((e) =>
      `<tr><td class="id">${e.id}</td>` +
      `<td class="status ${
        e.status.toLowerCase().replace(/_/g, "-")
      }">${e.status}</td>` +
      `<td>${e.summary}</td></tr>`
    ),
    ...diff.specOnly.map((id) =>
      `<tr><td class="id">${id}</td>` +
      `<td class="status not-started">NOT_STARTED</td>` +
      `<td>—</td></tr>`
    ),
    ...diff.progressOnly.map((id) =>
      `<tr><td class="id">${id}</td>` +
      `<td class="status orphaned">ORPHANED</td>` +
      `<td>—</td></tr>`
    ),
  ].join("\n      ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ralphmania — Overall Status</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;background:#f8f8f8;color:#222}
    h1{font-size:1.5rem;margin-bottom:.25rem}
    .summary{font-size:1rem;color:#555;margin-bottom:1.5rem}
    table{width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}
    th{background:#f0f0f0;text-align:left;padding:.6rem 1rem;font-size:.85rem}
    td{padding:.5rem 1rem;border-top:1px solid #eee;font-size:.88rem;vertical-align:middle}
    td.id{font-family:monospace;white-space:nowrap}
    td.status{font-family:monospace;font-size:.8rem;white-space:nowrap;font-weight:600}
    .verified{color:#1a7a1a}
    .needs-rework{color:#c0392b}
    .wip{color:#e67e22}
    .work-complete{color:#2980b9}
    .obsolete{color:#888}
    .not-started{color:#999}
    .orphaned{color:#c0392b}
  </style>
</head>
<body>
  <h1>Ralphmania — Overall Status</h1>
  <p class="summary">${verifiedCount} / ${totalInSpec} verified${orphanedNote}</p>
  <table>
    <thead><tr><th>Scenario</th><th>Status</th><th>Summary</th></tr></thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
};
