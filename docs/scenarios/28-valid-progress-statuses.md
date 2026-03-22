# Scenario 28: Valid Progress Statuses

## Requirement

The progress file SHALL support statuses WIP, WORK_COMPLETE, VERIFIED,
NEEDS_REWORK, OBSOLETE. The system SHALL mark any other status as invalid and
prompt workers to correct it.

## Implementation

- **`VALID_STATUSES` constant** (`src/constants.ts`): Defines the canonical set
  `["WIP", "WORK_COMPLETE", "VERIFIED", "NEEDS_REWORK", "OBSOLETE"]` with a
  `ScenarioStatus` type.
- **`validateProgressStatuses()`** (`src/model.ts`): Uses `parseProgressRows` to
  extract status values, compares each non-empty status against
  `VALID_STATUSES`, returns invalid entries as `{ scenario, status }` objects.
- **Orchestrator integration** (`src/orchestrator.ts`): Called at the top of
  each loop iteration. Invalid statuses are logged as errors with the full list
  of valid values. The scenario with the invalid status remains actionable, so
  the next worker agent is directed to it and corrects the status.
- **Status semantics**: WIP and NEEDS_REWORK are actionable (agent works on
  them); WORK_COMPLETE is implemented but not verified; VERIFIED and OBSOLETE
  are terminal/complete states.

## Tests

- `validateProgressStatuses returns empty for all valid statuses` — all 5
  statuses pass validation.
- `validateProgressStatuses detects invalid statuses` — `COMPLETE` and `DONE`
  flagged as invalid.
- `validateProgressStatuses ignores rows without status` — empty cells are not
  flagged.
- `runParallelLoop logs error for invalid progress statuses` — orchestrator logs
  error for `COMPLETE` status.

## Evidence

- `src/constants.ts:29-38` — `VALID_STATUSES` and `ScenarioStatus` definition
- `src/model.ts:182-189` — `validateProgressStatuses` function
- `src/orchestrator.ts:228-239` — orchestrator validation + error logging
- `test/model_test.ts` — 3 unit tests for validation
- `test/orchestrator_test.ts` — 1 integration test for orchestrator logging
