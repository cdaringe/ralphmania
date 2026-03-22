# Scenario 31: Code Formatting Enforcement as Quality Gate

## Scenario

> The codebase SHALL enforce consistent code formatting as a quality gate.
> `deno fmt --check` SHALL be integrated into the validation process, preventing
> merges when formatting violations exist. The validation script SHALL use
> `deno fmt --check` (not `deno fmt`) so that formatting issues fail the gate
> rather than being silently auto-fixed.

## Implementation

### Why `--check` matters

The previous `deno fmt` call in `specification.validate.sh` auto-formatted files
silently and always exited 0 — formatting violations were never surfaced as
failures. Using `deno fmt --check` exits non-zero when any file is unformatted,
making formatting a true quality gate (consistent with scenarios 29–30 for
coverage and lint).

### Change — `specification.validate.sh`

```bash
deno fmt --check   # ← fails if any file is not formatted (was: deno fmt)
deno lint
deno run check
deno run -A test
```

### Fix — `docs/scenarios/30-lint-enforcement.md`

The markdown table in the scenario 30 doc was not formatted per `deno fmt`
rules; re-formatted to aligned pipe-table style so `deno fmt --check` passes.

### Tests — `test/fmt_test.ts`

| Test                                                         | Assertion                                          |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `deno fmt --check passes with no formatting violations`      | subprocess exits code 0                            |
| `specification.validate.sh uses deno fmt --check (not bare)` | script contains `deno fmt --check`, not bare `fmt` |

Both tests pass (`ok | 2 passed | 0 failed`).

## Evidence

- `specification.validate.sh` line 9: `deno fmt --check`.
- `test/fmt_test.ts`: two dedicated format-enforcement tests.
- `deno fmt --check` against 72 project files: `Checked 72 files` (no
  violations).
