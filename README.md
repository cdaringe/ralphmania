# ralphmania

Automated iterative agent loop runner for specification-driven development. Runs an AI coding agent (Claude or Codex) in a loop, validating each iteration against a user-defined specification until all scenarios are verified.

Where a basic "ralph loop" is great for one shot attempts, `ralphmania` is designed for iterative development. Specifically, it has strong support for:

1. **REWORK** - letting the user update the progress document if a specification has been refined or not implemented per expectation.
2. **VERIFICATION** - an extra agent step that analyzes the intent of the coding work against the actual output.
3. **VALIDATION** - a user-defined validation hook that can be as simple or complex as needed, with support for test scripts, static analysis, or manual review. Feedback is fed back into the loop to guide rework or escalation decisions.
4. **ESCALATION** - automatically switching to a stronger model (Claude 2) when rework is detected, but scoping that escalation to just the failing scenarios to save on tokens and cost.

## What it does

- Runs an AI agent iteratively against `specification.md`, tracking progress in `progress.md`
- Validates each iteration via a user-defined, customizable `specification.validate.sh` hook
- Escalates to stronger models when verification, validation, or user feedback directly in the progress.md document indicates rework is needed
- Scopes strong-model passes to specific failing scenarios
- Generates receipts (evidence artifacts) once all scenarios pass validation

## Usage

```bash
# Run 10 iterations with Claude (default agent)
deno run -A mod.ts --iterations 10

# Run with Codex
deno run -A mod.ts --iterations 10 --agent codex

# Short flags
deno run -A mod.ts -i 10 -a claude
```

On first run, a `specification.validate.sh` template is created. Fill in your validation logic before re-running.

## Project structure

| File | Purpose |
|---|---|
| `mod.ts` | Entrypoint — CLI parsing, signal handling, main loop |
| `src/runner.ts` | Iteration execution, stream piping, receipt generation |
| `src/model.ts` | Model selection and rework-based escalation |
| `src/command.ts` | Prompt and command construction per agent |
| `src/validation.ts` | Validation hook setup and execution |
| `src/cli.ts` | CLI argument parsing |
| `src/types.ts` | Shared types and Result utilities |
| `src/constants.ts` | Prompts, timeouts, paths |
