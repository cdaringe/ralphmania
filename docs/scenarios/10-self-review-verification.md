# Scenario 10 – Agent Self-Review and Verification

**Status: COMPLETE**

## Requirement

After all scenarios are implemented, the agent SHALL self-review each claim in `progress.md`, verifying intent vs. actual output, and marking scenarios `VERIFIED` or `NEEDS_REWORK`.

## Implementation

### Verification Instruction in BASE_PROMPT

`src/constants.ts` – `BASE_PROMPT` embeds the self-review directive as step 6, delivered to the agent on every iteration:

```
6. If all scenarios are completed, revisit each claim ONE BY ONE in the progress
file CRITIQUE if the INTENT of the scenario is ACTUALLY COMPLETED. Run code, use browsers,
and verify documentation to validate the scenario.
  6.1 Review if the user's desires are met--not if the claimed tasks are completed.
  6.2 Every referenced document or module should be verified existing and up-to-date.
  6.3 Update status to VERIFIED or NEEDS_REWORK with rework notes as needed.

Once all claims are VERIFIED, output <promise>COMPLETE</promise>.
```

The agent is explicitly instructed to:
- Work through claims one-by-one.
- Run code and verify documents rather than trust surface-level completeness.
- Mark `VERIFIED` only when intent is satisfied, not just when tasks are listed as done.
- Mark `NEEDS_REWORK` with notes if anything fails the intent check.

### Completion Signal

`src/constants.ts`:
```ts
export const COMPLETION_MARKER = "<promise>COMPLETE</promise>";
```

`src/runner.ts` – `pipeStream` scans the agent's stdout for `COMPLETION_MARKER`. The iteration is marked `{ status: "complete" }` only when the marker is found, meaning the agent declared all scenarios `VERIFIED`. Without the marker the loop continues.

### NEEDS_REWORK Feedback Loop

If the self-review produces `NEEDS_REWORK` entries, the escalation system (Scenario 8) picks them up on the next iteration and escalates the model, scoping work to the failing scenario (Scenario 9). This closes the verification → rework → re-verify cycle.

## Evidence

- `src/constants.ts`: `BASE_PROMPT` step 6, `COMPLETION_MARKER`
- `src/runner.ts`: `pipeStream` checks for `COMPLETION_MARKER`; `foundAllCompleteSigil` drives `{ status: "complete" }`
- `src/model.ts`: `resolveModelSelection` re-reads `progress.md` each iteration, picking up any `NEEDS_REWORK` marks set during self-review
