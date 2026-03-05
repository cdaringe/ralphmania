# ralphmania

AI agent loop execution scripts for specification-driven development.

"Here are my goals, do work until everything is done."

- Good for projects where the specifications are not rock solid, but are
  expected to change regularly over time.
- Bad for projects with firm or static specifications.

Runs an AI coding agent (Claude or Codex) in a loop, validating each iteration
against a user-defined specification until all scenarios are verified.

A basic "ralph loop" is great for one shot development. However, `ralphmania` is
designed for iterative development. Specifically, it has strong support for:

1. **REWORK** - letting the user update the the task tracking document
   (progress.md) if a specification has been refined or has not implemented per
   expectation.
2. **VERIFICATION** - a step that analyzes the intent of the coding work against
   the actual output. Can be skipped.
3. **VALIDATION** - a user-defined validation hook that can be as simple or
   complex as needed, with support for test scripts, static analysis, or manual
   review. Validation results are fed back into the loop to guide rework or
   escalation decisions.
4. **ESCALATION** - automatically switching to a stronger model when rework is
   detected, but scoping that escalation to just the failing scenarios to save
   on tokens and cost.
5. **PLUGINS** - support for changing the default flow if you want to tune
   default behaviors!

## What it does

- Runs an AI agent iteratively against `specification.md`, tracking progress in
  `progress.md`
- Validates each iteration via a user-defined, customizable
  `specification.validate.sh` hook
- Escalates to stronger models when verification, validation, or user feedback
  directly in the progress.md document indicates rework is needed
- Scopes strong-model passes to specific failing scenarios
- Generates receipts (evidence artifacts) once all scenarios pass validation

## Usage

```bash
# Run 10 iterations with Claude (default agent)
deno run -A jsr:@cdaringe/ralphmania -i 10

# Run with Codex
deno run -A jsr:@cdaringe/ralphmania -i 10 -a codex

# With a plugin
deno run -A jsr:@cdaringe/ralphmania -i 10 --plugin ./my-plugin.ts
```

On first run, a `specification.validate.sh` template is created. Fill in your
validation logic before re-running.

## Plugins

Plugins let you customize ralphmania's behavior by hooking into its lifecycle:

```typescript
import type { Plugin } from "@cdaringe/ralphmania";

const plugin: Plugin = {
  onConfigResolved({ agent, iterations, log }) {
    log({ tags: ["info"], message: `Starting with ${agent}` });
    return { agent, iterations };
  },
  onPromptBuilt({ prompt }) {
    return prompt + "\nAlways use TypeScript.";
  },
};

export { plugin };
```

### Available hooks

| Hook                   | Kind      | When                                   |
| ---------------------- | --------- | -------------------------------------- |
| `onConfigResolved`     | transform | After CLI parse, once                  |
| `onModelSelected`      | transform | Each iteration, after model resolution |
| `onPromptBuilt`        | transform | Each iteration, after prompt assembly  |
| `onCommandBuilt`       | transform | Each iteration, before spawn           |
| `onIterationEnd`       | observe   | After agent process exits              |
| `onValidationComplete` | transform | After validation runs                  |
| `onLoopEnd`            | observe   | After loop exits                       |

## Project structure

| File                | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `mod.ts`            | Entrypoint — CLI parsing, signal handling, main loop   |
| `src/runner.ts`     | Iteration execution, stream piping, receipt generation |
| `src/model.ts`      | Model selection and rework-based escalation            |
| `src/command.ts`    | Prompt and command construction per agent              |
| `src/validation.ts` | Validation hook setup and execution                    |
| `src/cli.ts`        | CLI argument parsing                                   |
| `src/plugin.ts`     | Plugin type, loading, and hooks                        |
| `src/types.ts`      | Shared types and Result utilities                      |
| `src/constants.ts`  | Prompts, timeouts, paths                               |
