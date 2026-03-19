# Scenario 25 — OBSOLETE Scenario Support

## Goal

The system SHALL support OBSOLETE scenarios. Completeness checks and task selection should be aware.

## Implementation

Three functions in `src/model.ts` were updated to treat `OBSOLETE` status as "resolved" (not actionable, not requiring VERIFIED):

### `parseTotalCount` (line ~123)

Excludes OBSOLETE rows from the total count used in the "N of M implemented" status message. An OBSOLETE scenario does not contribute to the denominator.

```
(all rows) − (OBSOLETE rows)
```

### `findActionableScenarios` (line ~127)

Added `OBSOLETE` to the regex that builds the "done" set. OBSOLETE scenarios are never returned as actionable and the agent will not attempt to implement them.

### `isAllVerified` (line ~140)

Changed from checking `VERIFIED == expectedCount` to checking `VERIFIED + OBSOLETE == expectedCount`. This means the loop terminates (and receipts are generated) when all non-OBSOLETE scenarios are VERIFIED, even if some scenarios are marked OBSOLETE.

## Tests

Added to `test/orchestrator_test.ts`:
- `findActionableScenarios skips OBSOLETE scenarios`
- `isAllVerified returns true when all VERIFIED and OBSOLETE fill expectedCount`
- `isAllVerified returns false when OBSOLETE leaves VERIFIED count short`
- `isAllVerified returns true when all rows are OBSOLETE matching expectedCount`

Added to `test/model_test.ts`:
- `parseTotalCount excludes OBSOLETE rows`

All 60 tests pass (`deno test test/orchestrator_test.ts test/model_test.ts`).

## Evidence

- `src/model.ts`: `parseTotalCount`, `findActionableScenarios`, `isAllVerified` all updated
- `test/orchestrator_test.ts`: 4 new OBSOLETE-specific tests
- `test/model_test.ts`: 1 new OBSOLETE-specific test
