/**
 * Scenario lifecycle state machine.
 *
 * Each scenario in progress.md transitions through a defined lifecycle.
 * This module encodes the valid transitions and provides validation so
 * that illegal status changes (e.g. jumping from "" straight to "VERIFIED")
 * are caught.
 *
 * ```
 *   ""  ──→  WIP  ──→  WORK_COMPLETE  ──→  VERIFIED
 *    │        │              │                  │
 *    │        │              ▼                  │
 *    │        │        NEEDS_REWORK ────────────┘
 *    │        │              │
 *    │        ▼              ▼
 *    └──────────────→  OBSOLETE (terminal)
 * ```
 *
 * @module
 */

import type { ScenarioStatus } from "./constants.ts";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

/** Unstarted — status cell is empty or missing. */
export type UnimplementedState = Readonly<{
  tag: "unimplemented";
  scenario: string;
}>;

export type WipState = Readonly<{
  tag: "wip";
  scenario: string;
}>;

export type WorkCompleteState = Readonly<{
  tag: "work_complete";
  scenario: string;
}>;

export type VerifiedState = Readonly<{
  tag: "verified";
  scenario: string;
}>;

export type NeedsReworkState = Readonly<{
  tag: "needs_rework";
  scenario: string;
  reworkNotes: string;
}>;

export type ObsoleteState = Readonly<{
  tag: "obsolete";
  scenario: string;
}>;

export type ScenarioState =
  | UnimplementedState
  | WipState
  | WorkCompleteState
  | VerifiedState
  | NeedsReworkState
  | ObsoleteState;

/** Terminal states that end the lifecycle. */
export const isTerminalScenario = (
  s: ScenarioState,
): s is VerifiedState | ObsoleteState =>
  s.tag === "verified" || s.tag === "obsolete";

// ---------------------------------------------------------------------------
// Status ↔ State mapping
// ---------------------------------------------------------------------------

type Tag = ScenarioState["tag"];

const STATUS_TO_TAG: Readonly<Record<string, Tag>> = {
  "": "unimplemented",
  "WIP": "wip",
  "WORK_COMPLETE": "work_complete",
  "VERIFIED": "verified",
  "NEEDS_REWORK": "needs_rework",
  "OBSOLETE": "obsolete",
};

const TAG_TO_STATUS: Readonly<Record<Tag, ScenarioStatus | "">> = {
  unimplemented: "" as ScenarioStatus | "",
  wip: "WIP",
  work_complete: "WORK_COMPLETE",
  verified: "VERIFIED",
  needs_rework: "NEEDS_REWORK",
  obsolete: "OBSOLETE",
};

/** Convert a progress.md status string to a ScenarioState. */
export const statusToState = (
  scenario: string,
  status: string,
  reworkNotes = "",
): ScenarioState | undefined => {
  const tag = STATUS_TO_TAG[status.trim()];
  if (tag === undefined) return undefined;
  if (tag === "needs_rework") {
    return { tag, scenario, reworkNotes };
  }
  return { tag, scenario } as ScenarioState;
};

/** Convert a ScenarioState back to a status string. */
export const stateToStatus = (s: ScenarioState): ScenarioStatus | "" =>
  TAG_TO_STATUS[s.tag];

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

/**
 * Map of each state tag to the set of tags it may transition to.
 *
 * Rules:
 * - Unimplemented → WIP, WORK_COMPLETE, OBSOLETE
 * - WIP → WORK_COMPLETE, NEEDS_REWORK, OBSOLETE
 * - WORK_COMPLETE → VERIFIED, NEEDS_REWORK, OBSOLETE
 * - NEEDS_REWORK → WIP, WORK_COMPLETE, OBSOLETE
 * - VERIFIED → NEEDS_REWORK, OBSOLETE  (user can reject after verify)
 * - OBSOLETE → (nothing — terminal)
 */
const VALID_TRANSITIONS: Readonly<Record<Tag, ReadonlySet<Tag>>> = {
  unimplemented: new Set<Tag>([
    "wip",
    "work_complete",
    "obsolete",
  ]),
  wip: new Set<Tag>([
    "work_complete",
    "needs_rework",
    "obsolete",
  ]),
  work_complete: new Set<Tag>([
    "verified",
    "needs_rework",
    "obsolete",
  ]),
  verified: new Set<Tag>([
    "needs_rework",
    "obsolete",
  ]),
  needs_rework: new Set<Tag>([
    "wip",
    "work_complete",
    "obsolete",
  ]),
  obsolete: new Set<Tag>(),
};

// ---------------------------------------------------------------------------
// Transition validation
// ---------------------------------------------------------------------------

export type TransitionResult =
  | Readonly<{ ok: true; from: Tag; to: Tag }>
  | Readonly<{ ok: false; from: Tag; to: Tag; reason: string }>;

/**
 * Check whether transitioning from `from` to `to` is a valid scenario
 * lifecycle transition. Self-transitions (same status) are always valid.
 */
export const validateTransition = (
  from: ScenarioState,
  to: ScenarioState,
): TransitionResult => {
  if (from.tag === to.tag) {
    return { ok: true, from: from.tag, to: to.tag };
  }
  const allowed = VALID_TRANSITIONS[from.tag];
  if (allowed.has(to.tag)) {
    return { ok: true, from: from.tag, to: to.tag };
  }
  return {
    ok: false,
    from: from.tag,
    to: to.tag,
    reason:
      `Invalid scenario transition: ${from.tag} → ${to.tag} (scenario ${from.scenario})`,
  };
};

/**
 * Validate a batch of scenario status changes by comparing old and new
 * progress content. Returns all invalid transitions found.
 *
 * When a `log` function is provided, every detected transition (valid or
 * invalid) is emitted at debug level so the full scenario lifecycle is
 * visible in logs.
 */
export const validateProgressTransitions = (
  oldRows: ReadonlyArray<{ scenario: string; status: string }>,
  newRows: ReadonlyArray<{
    scenario: string;
    status: string;
    reworkNotes?: string;
  }>,
  log?: import("./types.ts").Logger,
): TransitionResult[] => {
  const oldMap = new Map(oldRows.map((r) => [r.scenario, r.status]));
  const violations: TransitionResult[] = [];

  for (const row of newRows) {
    const oldStatus = oldMap.get(row.scenario) ?? "";
    const newStatus = row.status;
    if (oldStatus === newStatus) continue;

    const from = statusToState(row.scenario, oldStatus);
    const to = statusToState(row.scenario, newStatus, row.reworkNotes ?? "");
    if (!from || !to) continue; // skip unknown statuses (caught elsewhere)

    const result = validateTransition(from, to);
    log?.({
      tags: ["debug", "scenario", "transition"],
      message: `scenario ${row.scenario}: ${from.tag} → ${to.tag}${
        result.ok ? "" : " (INVALID)"
      }`,
    });
    if (!result.ok) {
      violations.push(result);
    }
  }

  return violations;
};
