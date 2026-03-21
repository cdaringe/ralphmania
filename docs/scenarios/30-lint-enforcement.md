# Scenario 30: Strict Deno Lint Enforcement

## Scenario

> The codebase SHALL enforce strict Deno lint rules as a quality gate. Lint
> rules SHALL be configured in `deno.json` and `deno lint` SHALL be integrated
> into the validation process, preventing merges when lint violations exist.

## Implementation

### Lint configuration — `deno.json`

`deno.json` defines a `lint.rules` block with:

- **`tags: ["recommended"]`** — all Deno-recommended rules are enabled by
  default.
- **`include`** — additional strict rules layered on top:
  - `explicit-function-return-type` / `explicit-module-boundary-types` — all
    public APIs must declare return types; prevents implicit `any` leakage.
  - `no-non-null-assertion` / `no-non-null-asserted-optional-chain` — bans `!`
    assertions that mask null-pointer bugs.
  - `no-eval`, `no-throw-literal`, `no-slow-types`, `no-undef` — safety and
    performance guards.
  - `eqeqeq`, `guard-for-in`, `single-var-declarator`, `verbatim-module-syntax`
    — consistency and correctness rules.

### Validation gate — `specification.validate.sh`

`deno lint` is called before type-check and tests:

```bash
deno fmt
deno lint        # ← enforces lint rules on every CI run
deno run check
deno run -A test
```

Any lint violation causes the validation script to exit non-zero, feeding
failure context back to the agent loop (scenario 7).

### Tests — `test/lint_test.ts`

Four tests verify the complete enforcement chain:

| Test | Assertion |
|------|-----------|
| `deno.json has lint rules configured` | `lint.rules.tags` and `lint.rules.include` exist |
| `deno.json lint rules include strict type rules` | `explicit-function-return-type`, `explicit-module-boundary-types`, `no-non-null-assertion` present |
| `deno lint passes with no violations` | `deno lint` subprocess exits with code 0 |
| `specification.validate.sh includes deno lint` | script text contains `deno lint` |

All four tests pass (`ok | 4 passed | 0 failed`).

## Evidence

- `deno.json` lines 6–30: `lint.rules` block with `tags: ["recommended"]` and
  15 additional strict rules.
- `specification.validate.sh` line 10: `deno lint` invocation.
- `test/lint_test.ts`: four dedicated lint-enforcement tests.
- Running `deno lint` against all 33 project files: `Checked 33 files` (no
  violations).
