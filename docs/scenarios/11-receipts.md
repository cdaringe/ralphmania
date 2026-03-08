# Scenario 11 – Evidence Receipts

**Status: COMPLETE**

## Requirement

Upon successful execution and all features VERIFIED and no more looping, the
system SHALL generate evidence receipts in `.ralph/receipts/` using the fastest
model tier. Receipts are generated only AFTER the loop halts — not within
individual iterations.

## Implementation

### Trigger Condition

`mod.ts` — after the main loop exits, receipts are generated only when
`state.task === "complete"` (all scenarios verified, validation passed):

```ts
if (state.task === "complete") {
  log({ tags: ["info"], message: "Generating evidence receipts..." });
  const receiptsResult = await updateReceipts({ agent });
  if (!receiptsResult.ok) {
    log({ tags: ["error"], message: receiptsResult.error });
  }
  return 0;
}
```

### Receipt Generation

`updateReceipts({ agent })` exported from `src/runner.ts`:

- Uses `getModel({ agent, mode: "fast" })` — the cheapest model tier.
- Builds a `CommandSpec` via `buildCommandSpec` with a prompt instructing the
  agent to update `.ralph/receipts/{index.html,assets}`.
- Runs the subprocess via `.output()` (not streamed).
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

### LoopState Simplification

`src/types.ts` — `LoopState.task` is now `"build" | "complete"` only.
The former `"produce_receipts"` task state has been removed since receipts
run once post-loop, not as a retry within iterations.

## Evidence

- `mod.ts`: post-loop `if (state.task === "complete")` block calls
  `updateReceipts`
- `src/runner.ts`: `updateReceipts` exported, Phase 3 removed from
  `runLoopIteration`
- `src/types.ts`: `LoopState.task` simplified to `"build" | "complete"`
- `src/constants.ts`: `RALPH_RECEIPTS_DIRNAME = ".ralph/receipts"`
- `src/model.ts`: `getModel({ agent, mode: "fast" })` used for receipts
