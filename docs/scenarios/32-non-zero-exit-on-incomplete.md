# Scenario 32: Non-Zero Exit Code on Incomplete Loop

## Goal

The CLI SHALL exit with exit code **1** when all iterations are exhausted without all scenarios being VERIFIED, and exit code **0** when all scenarios are VERIFIED. This enables reliable CI/CD pipeline integration — build pipelines can detect incomplete runs via the process exit code rather than parsing output.

## Implementation

### `src/exit.ts` (new)

A pure, testable helper encapsulates the exit code decision:

```typescript
export const computeExitCode = (allDone: boolean): number => (allDone ? 0 : 1);
```

### `mod.ts`

The `main()` function previously returned `0` unconditionally at the end of a run. It now calls `computeExitCode(allDone)`:

```typescript
return computeExitCode(allDone);
```

`allDone` is set by `isAllVerified(finalSection, expectedScenarioCount)` after the loop completes. The SIGINT abort path (`return 130`) is unaffected — it returns before reaching `computeExitCode`.

## Exit Code Summary

| Condition | Exit Code |
| --- | --- |
| All scenarios VERIFIED | `0` |
| Iterations exhausted, not all VERIFIED | `1` |
| SIGINT abort (second signal) | `130` |
| CLI arg error / plugin load failure | `1` |

## Tests

`test/exit_code_test.ts` covers both branches of `computeExitCode`:

- `computeExitCode(true)` → `0`
- `computeExitCode(false)` → `1`

The broader behavior (loop exhausting iterations without completion) is already covered by the orchestrator tests in `test/orchestrator_test.ts` — specifically the "stops after max iterations" test which verifies `runParallelLoop` returns the iteration count (not a special code) when the loop exhausts without all scenarios being verified.
