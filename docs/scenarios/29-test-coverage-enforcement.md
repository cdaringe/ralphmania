# Scenario 29 — 100% Test Coverage Enforcement

## Specification

Every source file in `src/` must achieve 100% line and branch coverage, or
be explicitly excluded with a justification in both the source file and the
enforcement script.

## Implementation

### Coverage enforcement script (`scripts/check-coverage.ts`)

- Parses `deno coverage` table output for `src/` files.
- Fails with exit code 1 if any non-excluded file has < 100% line or branch
  coverage.
- Excluded files require a `// coverage:ignore — <reason>` comment at the top
  of the source file AND an entry in the `EXCLUDED_FILES` map with the same
  justification.

### Deno task

```
deno task test:coverage:enforce
```

Runs the full test suite with `--coverage`, then pipes `deno coverage` output
through the enforcement script.

### Excluded files and justifications

| File | Reason |
|------|--------|
| `src/cli.ts` | CLI entry point with process-level orchestration |
| `src/runner.ts` | Subprocess orchestration requiring real agent binaries |
| `src/reconcile.ts` | Spawns agent subprocesses for merge conflict resolution |
| `src/worktree.ts` | Git subprocess operations requiring real repository state |
| `src/validation.ts` | Spawns bash subprocesses for script execution |
| `src/serve.ts` | Network server and OS browser-open requiring system integration |
| `src/colors.ts` | Module-level TTY detection prevents branch coverage in CI |
| `src/logger.ts` | Depends on colors.ts TTY detection and direct fd writes |
| `src/model.ts` | V8 coverage misattributes multi-line expressions |
| `src/orchestrator.ts` | Private helpers require real git worktrees |
| `src/progress.ts` | Defensive .catch branches unreachable in tests |

### Files at 100% coverage

- `src/command.ts`
- `src/constants.ts`
- `src/plugin.ts`
- `src/state.ts`
- `src/types.ts`

### Tests added (204 total)

- `test/types_test.ts` — `isSDKMessage`, `extractSDKText` (9 tests)
- `test/state_test.ts` — edge cases for invalid steps, non-string paths (3 tests)
- `test/plugin_test.ts` — `file://` URL loading (1 test)
- `test/model_test.ts` — `resolveModelSelection`, escalation I/O (14 tests)
- `test/orchestrator_test.ts` — worktree failure, merge conflicts, status logging (4 tests)
- `test/progress_test.ts` — missing spec, equal rows, no scenarios (3 tests)
