# Scenario 11 – Evidence Receipts

**Status: COMPLETE**

## Requirement

Upon successful validation and completion, the system SHALL generate evidence
receipts in `.ralph/receipts/` using the fast model tier.

## Implementation

### Trigger Condition

`src/runner.ts` – `runLoopIteration` enters Phase 3 (Receipts) only when both
conditions hold:

- Validation passed (`validation.status === "passed"`)
- Agent signaled completion (`result.status === "complete"`, i.e.
  `COMPLETION_MARKER` found in output)

```ts
const isPriorWorkOk = validation.status === "passed" &&
  result.status === "complete";
```

### Receipt Generation

`updateReceipts({ agent })` in `src/runner.ts`:

- Uses `getModel({ agent, mode: "fast" })` — the cheapest model tier.
- Builds a `CommandSpec` via `buildCommandSpec` with a prompt instructing the
  agent to update `.ralph/receipts/{index.html,assets}`.
- Runs the subprocess synchronously via `.output()` (not streamed).
- Uses `nonInteractiveEnv()` and `stdin: "null"`.

The prompt instructs the agent to:

1. For scenarios with e2e tests: embed a video of the passing test +
   description.
2. For scenarios without tests: write a markdown write-up with code evidence
   snippets.
3. Place a `VERIFIED` or `NEEDS_REWORK` status at the top of each receipt.
4. Render markdown and embed playable videos in the HTML output.

### Output Directory

`src/constants.ts`:

```ts
export const RALPH_RECEIPTS_DIRNAME = ".ralph/receipts";
```

### Loop State Transition

On success: `{ task: "complete" }` — loop exits. On receipts failure:
`{ task: "produce_receipts" }` — loop continues to retry.

```ts
return receiptsResult.ok
  ? { validationFailurePath, task: "complete" }
  : { validationFailurePath, task: "produce_receipts" };
```

The `"produce_receipts"` task causes `runLoopIteration` to skip the agent build
phase and jump straight to receipts on the next iteration.

## Evidence

- `src/runner.ts`: `updateReceipts`, `runLoopIteration` Phase 3 block,
  `LoopState.task === "produce_receipts"`
- `src/constants.ts`: `RALPH_RECEIPTS_DIRNAME`
- `src/model.ts`: `getModel({ agent, mode: "fast" })` used for receipts
