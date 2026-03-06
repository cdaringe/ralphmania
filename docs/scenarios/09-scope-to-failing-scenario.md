# Scenario 9 – Scope Agent Work to Failing Scenario

**Status: COMPLETE**

## Requirement

When escalating, the system SHALL scope the agent's work to the specific failing
scenario to save tokens and cost.

## Implementation

### Prompt Scoping

`src/command.ts` –
`buildPrompt({ targetScenario, mode, validationFailurePath })`:

When the resolved model is at escalation mode `strong` **and** `targetScenario`
is defined, the base prompt is augmented with:

```
ACTUALLY:
- You must work ONLY on scenario <N>.
- Do not work on any other scenario in this iteration.
```

This directive overrides the default "find next task" behavior and pins the
agent to the single rework scenario.

### When Scoping Activates

`src/model.ts` – `computeModelSelection` sets `targetScenario` from
`detectScenarioFromProgress` (first `NEEDS_REWORK` row number). For Claude, this
value is non-`undefined` whenever at least one rework entry exists.

`src/runner.ts` – `runIteration` calls
`buildPrompt({ targetScenario: selection.targetScenario, mode: selection.mode, ... })`.
The scoping text is injected only when `mode !== "general"` and
`targetScenario !== undefined`, i.e., when Claude is at L2/L3 (opus) escalation.

The log also confirms scoping:

```ts
// src/runner.ts (via resolveModelSelection in model.ts)
if (mode === "strong" && targetScenario !== undefined) {
  log({
    tags: ["info", "scenario"],
    message: `strong-model pass scoped to scenario ${targetScenario}`,
  });
}
```

## Evidence

- `src/command.ts`: `buildPrompt` — conditional scope injection
- `src/model.ts`: `detectScenarioFromProgress`, `computeModelSelection`,
  `resolveModelSelection`
- `src/runner.ts`: `runIteration` passes `selection.targetScenario` to
  `buildPrompt`
