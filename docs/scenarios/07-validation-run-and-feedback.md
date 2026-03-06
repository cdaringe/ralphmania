# Scenario 7 – Run validation script, capture log, feed failure context back

## Requirement

> The system SHALL run `specification.validate.sh` after each agent iteration,
> capturing output to `.ralph/validation/iteration-{N}.log` and feeding failure
> context back to the agent on the next iteration.

## Implementation

### 1. Validation execution (`src/validation.ts`)

`runValidation({ iterationNum, log })` is called from `runLoopIteration`
(Phase 2) after every agent iteration. It:

- Creates `.ralph/validation/` via `Deno.mkdir` (recursive).
- Opens `iteration-{N}.log` for writing.
- Spawns `bash specification.validate.sh` with `stdin: "null"` and
  `nonInteractiveEnv()`.
- Tees stdout/stderr to both the live terminal and the log file, stripping ANSI
  color codes before writing to disk (satisfying scenario 17).
- Returns `{ status: "passed" }` on exit 0, or
  `{ status: "failed", outputPath }` on non-zero exit.

Key constant: `VALIDATE_OUTPUT_DIR = ".ralph/validation"` (`src/constants.ts`).

### 2. Failure path threaded through loop state (`src/runner.ts`)

`runLoopIteration` stores the failure path in `LoopState`:

```ts
const validationFailurePath = validation.status === "failed"
  ? validation.outputPath
  : undefined;
```

This value is forwarded into the next call to `runIteration` via the
`validationFailurePath` field on `LoopState`.

### 3. Failure context injected into the agent prompt (`src/command.ts`)

`buildPrompt` appends a block to the prompt when `validationFailurePath` is set:

```ts
return validationFailurePath === undefined ? base : `${base}

VALIDATION FAILED on previous iteration. Review the failure output at: ${validationFailurePath}
Fix the issues identified in the validation output before proceeding with other work.`;
```

The agent thus receives the exact path to the failure log and is explicitly
instructed to fix those issues first.

## Evidence

| Concern                       | File                    | Symbol                |
| ----------------------------- | ----------------------- | --------------------- |
| Runs script & captures log    | `src/validation.ts:28`  | `runValidation`       |
| Log path constant             | `src/constants.ts:7`    | `VALIDATE_OUTPUT_DIR` |
| Threads failure path in state | `src/runner.ts:274-276` | `runLoopIteration`    |
| Injects failure into prompt   | `src/command.ts:16-22`  | `buildPrompt`         |
