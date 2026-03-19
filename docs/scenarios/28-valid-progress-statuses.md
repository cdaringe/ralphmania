# Scenario 28: Valid Progress Statuses

## Requirement

The progress file SHALL support statuses WIP, WORK_COMPLETE, VERIFIED,
NEEDS_REWORK, OBSOLETE. The system SHALL mark any other status as invalid and
prompt workers to correct it.

## Implementation

- **`VALID_STATUSES` constant** (`src/constants.ts`): Defines the canonical set
  `["WIP", "WORK_COMPLETE", "VERIFIED", "NEEDS_REWORK", "OBSOLETE"]` with a
  `ScenarioStatus` type.
- **`validateProgressStatuses()`** (`src/model.ts`): Parses progress.md rows via
  regex `[^\s|]+`, compares each status against `VALID_STATUSES`, returns
  invalid entries with scenario number and status string.
- **Orchestrator integration** (`src/orchestrator.ts`): Called at the top of
  each loop iteration. Invalid statuses are logged as errors with the full list
  of valid values, informing the worker to correct them.
- **Status migration**: All internal regexes updated from `COMPLETE` to
  `WORK_COMPLETE` (`parseImplementedCount`, `findActionableScenarios`,
  `buildPrompt`).

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

- `src/constants.ts:28-38` — `VALID_STATUSES` definition
- `src/model.ts:185-195` — `validateProgressStatuses` function
- `src/orchestrator.ts:226-238` — orchestrator validation call
- `test/model_test.ts` — 3 unit tests for validation
- `test/orchestrator_test.ts` — 1 integration test for orchestrator logging
