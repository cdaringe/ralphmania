import type { Result } from "../types.ts";
import { err, ok } from "../types.ts";

/** A parsed row from the progress.md markdown table. */
export type ProgressRow = {
  readonly scenario: string;
  readonly status: string;
  readonly summary: string;
  readonly reworkNotes: string;
};

const splitCells = (line: string): string[] =>
  line.replace(/^\|/, "").split("|").map((c) => c.trim());

const isSeparatorRow = (cells: string[]): boolean =>
  cells.length > 0 && cells.filter(Boolean).every((c) => /^[-:]+$/.test(c));

/**
 * Parse progress.md markdown table content into structured rows.
 * Uses the separator row (e.g. `| --- | --- |`) as the structural
 * delimiter — everything at or above it is the header, everything
 * below is data.
 */
export const parseProgressRows = (
  content: string,
): Result<ProgressRow[], string> => {
  const tableLines = content.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
  const separatorIdx = tableLines.findIndex((l) =>
    isSeparatorRow(splitCells(l))
  );
  const dataLines = separatorIdx === -1
    ? tableLines
    : tableLines.slice(separatorIdx + 1);

  const rows: ProgressRow[] = [];
  const errors: string[] = [];

  for (const line of dataLines) {
    const cells = splitCells(line);
    if (cells.length < 2) {
      errors.push(`Malformed table row (too few columns): ${line}`);
      continue;
    }

    const scenario = cells[0] ?? "";
    if (!scenario) {
      errors.push(`Table row has empty scenario ID: ${line}`);
      continue;
    }

    rows.push({
      scenario,
      status: cells[1] ?? "",
      summary: cells[2] ?? "",
      reworkNotes: cells[3] ?? "",
    });
  }

  return errors.length > 0
    ? err(`Failed to parse progress rows:\n${errors.join("\n")}`)
    : ok(rows);
};
