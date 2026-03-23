/** A parsed row from the progress.md markdown table. */
export type ProgressRow = {
  readonly scenario: number;
  readonly status: string;
  readonly summary: string;
  readonly reworkNotes: string;
};

/**
 * Parse progress.md markdown table content into structured rows.
 * Skips headers, separators, and malformed lines.
 *
 * Resilient to imperfect tables: trims whitespace, tolerates missing
 * trailing pipes, ignores lines that don't start with `|`, and handles
 * variable column counts gracefully.
 */
export const parseProgressRows = (content: string): ProgressRow[] => {
  const rows: ProgressRow[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // Only consider lines that look like table rows
    if (!trimmed.startsWith("|")) continue;

    const cells = trimmed
      .replace(/^\|/, "")
      .split("|")
      .map((c) => c.trim());

    if (cells.length < 2) continue;

    const scenario = parseFloat(cells[0]);
    if (isNaN(scenario)) continue;

    // Separator rows: e.g. "| -- | -------- |"
    if (/^-+$/.test(cells[0].trim())) continue;

    rows.push({
      scenario,
      status: cells[1] ?? "",
      summary: cells[2] ?? "",
      reworkNotes: cells[3] ?? "",
    });
  }
  return rows;
};
