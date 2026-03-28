import type { Result } from "../types.ts";
import { err, ok } from "../types.ts";
import { Status, VALID_STATUSES } from "../constants.ts";
export { parseProgressRows } from "../parsers/progress-rows.ts";
export type { ProgressRow } from "../parsers/progress-rows.ts";
import type { ProgressRow } from "../parsers/progress-rows.ts";
import { parseProgressRows } from "../parsers/progress-rows.ts";

export const detectScenarioFromProgress = (
  content: string,
): Result<string | undefined, string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  const rework = parsed.value.find((r) => r.status === Status.NEEDS_REWORK);
  return ok(rework?.scenario);
};

/** Find ALL scenario IDs with NEEDS_REWORK status. */
export const findReworkScenarios = (
  content: string,
): Result<string[], string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  return ok(
    parsed.value
      .filter((r) => r.status === Status.NEEDS_REWORK)
      .map((r) => r.scenario),
  );
};

/**
 * Derive the ordered actionable scenario list from parsed progress rows.
 * NEEDS_REWORK scenarios sort first so rework work is prioritised.
 * Pure derivation — no I/O.
 */
export const orderActionableScenarios = (
  rows: ProgressRow[],
  specIds: readonly string[],
): string[] => {
  const doneSet = new Set(
    rows
      .filter((r) =>
        r.status === Status.VERIFIED || r.status === Status.OBSOLETE
      )
      .map((r) => r.scenario),
  );
  const reworkIds = new Set(
    rows.filter((r) => r.status === Status.NEEDS_REWORK).map((r) => r.scenario),
  );
  const actionable = specIds.filter((id) => !doneSet.has(id));
  return [
    ...actionable.filter((s) => reworkIds.has(s)),
    ...actionable.filter((s) => !reworkIds.has(s)),
  ];
};

/** Count rows with WORK_COMPLETE or VERIFIED status in progress.md content. */
export const parseImplementedCount = (
  content: string,
): Result<number, string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  return ok(
    parsed.value.filter((r) =>
      r.status === Status.WORK_COMPLETE || r.status === Status.VERIFIED
    ).length,
  );
};

/** Count total non-OBSOLETE scenario rows in progress.md content. */
export const parseTotalCount = (content: string): Result<number, string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  return ok(parsed.value.filter((r) => r.status !== Status.OBSOLETE).length);
};

/** Find scenario IDs that are not VERIFIED or OBSOLETE (i.e. actionable).
 * WORK_COMPLETE is actionable — it means "ready for verification", not "done". */
export const findActionableScenarios = (
  content: string,
): Result<string[], string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  const done: Set<string> = new Set([Status.VERIFIED, Status.OBSOLETE]);
  return ok(
    parsed.value
      .filter((r) => !done.has(r.status))
      .map((r) => r.scenario),
  );
};

/** Check whether every expected scenario is present and VERIFIED or OBSOLETE. */
export const isAllVerified = (
  content: string,
  expectedScenarioIds?: readonly string[],
): Result<boolean, string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  const rows = parsed.value;
  const doneStatuses: Set<string> = new Set([Status.VERIFIED, Status.OBSOLETE]);
  const allDone = rows.length > 0 &&
    rows.every((r) => doneStatuses.has(r.status));
  if (!allDone) return ok(false);
  if (expectedScenarioIds !== undefined) {
    const presentIds = new Set(rows.map((r) => r.scenario));
    for (const id of expectedScenarioIds) {
      if (!presentIds.has(id)) return ok(false);
    }
  }
  return ok(true);
};

/**
 * Validate that every scenario row in progress.md uses a recognized status.
 * Returns an array of `{ scenario, status }` for each invalid entry.
 */
export const validateProgressStatuses = (
  content: string,
): Result<{ scenario: string; status: string }[], string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  const validSet = new Set<string>(VALID_STATUSES);
  return ok(
    parsed.value
      .filter((r) => r.status !== "" && !validSet.has(r.status))
      .map((r) => ({ scenario: r.scenario, status: r.status })),
  );
};
