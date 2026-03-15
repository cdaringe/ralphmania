# Scenario 11 – Evidence Receipts

**Status: COMPLETE**

## Requirement

Upon successful execution and all features VERIFIED and no more looping, the
system SHALL generate evidence receipts in `.ralph/receipts/` using the fastest
model tier. Use the existing prompt already found. The summary markdown for the
VERIFIED scenario SHALL be inlined and collapsed. A short intro SHALL describe
how the scenario's goals are achieved.

## Implementation

### Trigger Condition

`mod.ts` — receipts generated post-loop only when `allDone === true`:

```ts
const receiptsResult = allDone
  ? (log({ tags: ["info"], message: "Generating evidence receipts..." }),
    await updateReceipts({ agent, plugin, log }))
  : undefined;
```

### Receipt Prompt

`src/runner.ts` exports `RECEIPTS_PROMPT` — the canonical prompt consumed by
`updateReceipts`. It instructs the agent to:

1. Embed playwright test videos (+ description) for scenarios with e2e tests.
2. Write markdown evidence snippets for scenarios without e2e tests.
3. Place a VERIFIED/NEEDS_REWORK status at the top of each receipt.
4. **Write a short intro describing how each scenario's goals are achieved.**
5. **Inline and collapse the summary markdown for each VERIFIED scenario**
   (e.g., inside a `<details>` element).

Rendering requirements: markdown rendered, videos embedded and playable.

### Fastest Model Tier

`updateReceipts` calls `getModel({ agent, mode: "fast" })` — cheapest tier.

### Output Directory

`RALPH_RECEIPTS_DIRNAME = ".ralph/receipts"` from `src/constants.ts`.

## Evidence

- `src/runner.ts:243` — `RECEIPTS_PROMPT` exported; contains all 5 requirements
  including intro and collapsed summary
- `src/runner.ts:260` — `updateReceipts` uses
  `getModel({ agent, mode: "fast" })`
- `mod.ts:187` — post-loop receipt generation gated on `allDone`
- `src/constants.ts` — `RALPH_RECEIPTS_DIRNAME = ".ralph/receipts"`
- `test/runner_test.ts` — 3 tests verify prompt contains intro requirement,
  collapsed `<details>` requirement, and receipts dir path
