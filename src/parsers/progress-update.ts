/**
 * Surgical update of a single row in a progress.md markdown table.
 *
 * Discovers column indices from the header row by keyword matching
 * (not hardcoded positions), then rewrites only the target cells.
 *
 * @module
 */
import type { Result } from "../types.ts";
import { err, ok } from "../types.ts";

const splitCells = (line: string): string[] =>
  line.replace(/^\|/, "").split("|").map((c) => c.trim());

const isSeparatorRow = (cells: string[]): boolean =>
  cells.length > 0 && cells.filter(Boolean).every((c) => /^[-:]+$/.test(c));

/**
 * Find the 0-based column index whose header matches `keyword`
 * (case-insensitive substring).
 */
const findColumnIndex = (
  headerCells: string[],
  keyword: string,
): number =>
  headerCells.findIndex((c) => c.toLowerCase().includes(keyword.toLowerCase()));

export type ProgressRowUpdate = {
  readonly scenarioId: string;
  readonly status: string;
  readonly reworkNotes: string;
};

/**
 * Update a single row in the progress markdown table, identified by scenario
 * ID (first column). Only the Status and Rework Notes columns are modified.
 *
 * Returns the full file content with exactly one row changed, preserving all
 * other content byte-for-byte.
 */
export const updateProgressRow = (
  content: string,
  update: ProgressRowUpdate,
): Result<string, string> => {
  const lines = content.split("\n");

  // Find table lines — rows starting with `|`.
  const tableLineIndices = lines
    .map((l, i) => l.trim().startsWith("|") ? i : -1)
    .filter((i) => i !== -1);

  if (tableLineIndices.length < 2) {
    return err("No markdown table found in progress content");
  }

  // Identify header and separator rows.
  const separatorLineIdx = tableLineIndices.find((i) =>
    isSeparatorRow(splitCells(lines[i]))
  );
  if (separatorLineIdx === undefined) {
    return err("No separator row found in progress table");
  }

  // Header is the table line immediately before the separator.
  const headerLineIdx = tableLineIndices[
    tableLineIndices.indexOf(separatorLineIdx) - 1
  ];
  if (headerLineIdx === undefined) {
    return err("No header row found before separator");
  }

  const headerCells = splitCells(lines[headerLineIdx]);
  const idCol = findColumnIndex(headerCells, "#");
  const statusCol = findColumnIndex(headerCells, "status");
  const reworkCol = findColumnIndex(headerCells, "rework");

  if (idCol === -1) return err('Could not find scenario ID column ("#")');
  if (statusCol === -1) return err("Could not find Status column");
  if (reworkCol === -1) return err("Could not find Rework Notes column");

  // Data rows are table lines after the separator.
  const dataLineIndices = tableLineIndices.filter((i) => i > separatorLineIdx);

  // Find the target row by scenario ID.
  const targetLineIdx = dataLineIndices.find((i) => {
    const cells = splitCells(lines[i]);
    return cells[idCol]?.trim() === update.scenarioId;
  });

  if (targetLineIdx === undefined) {
    return err(
      `Scenario "${update.scenarioId}" not found in progress table`,
    );
  }

  // Rebuild the target line, preserving column widths from the separator row.
  const sepCells = lines[separatorLineIdx].replace(/^\|/, "").split("|");
  const originalCells = lines[targetLineIdx].replace(/^\|/, "").split("|");

  const updatedCells = originalCells.map((cell, i) => {
    const colWidth = sepCells[i] !== undefined ? sepCells[i].length : 0;
    const trimmed = cell.trim();
    if (i === statusCol) {
      return ` ${update.status.padEnd(Math.max(colWidth - 2, 0))} `;
    }
    if (i === reworkCol) {
      return ` ${update.reworkNotes.padEnd(Math.max(colWidth - 2, 0))} `;
    }
    // Preserve original cell content and padding.
    if (colWidth > 0 && trimmed.length < colWidth) return cell;
    return cell;
  });

  lines[targetLineIdx] = "|" + updatedCells.join("|");

  return ok(lines.join("\n"));
};
