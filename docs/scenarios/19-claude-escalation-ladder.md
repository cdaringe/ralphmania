# Scenario 19 – Claude 4-Step Escalation Ladder

**Status: COMPLETE**

## Requirement

For the Claude agent, the system SHALL implement a 4-step escalation ladder controlled by `CLAUDE_CODE_EFFORT_LEVEL` env var: L0 sonnet/low (default), L1 sonnet/high (first rework), L2 opus/medium (continued rework), L3 opus/high (persistent rework). Each scenario tracks its own level independently in `.ralph/escalation.json`; when a scenario exits `NEEDS_REWORK`, its entry is cleared.

## Implementation

### Ladder Definition

`src/constants.ts` – `CLAUDE_LADDER`:
```ts
export const CLAUDE_LADDER = [
  { model: "sonnet", mode: "general", effort: "low"    }, // L0 default
  { model: "sonnet", mode: "general", effort: "high"   }, // L1 first rework
  { model: "opus",   mode: "strong",  effort: "medium" }, // L2 continued
  { model: "opus",   mode: "strong",  effort: "high"   }, // L3 persistent
] as const;
```

### Per-Scenario State

`.ralph/escalation.json` stores `Record<string, EscalationLevel>` (0–3), keyed by scenario number string. `src/model.ts` – `readEscalationState` / `writeEscalationState` manage persistence.

### State Transitions

`updateEscalationState({ current, reworkScenarios })`:
- Scenario newly in rework → level 1 (first escalation above default).
- Scenario still in rework → level bumped by 1, capped at 3 (`clampLevel`).
- Scenario exits `NEEDS_REWORK` → removed from state (resets to L0 on next entry).

This means levels increase monotonically within a rework lifecycle and reset cleanly when resolved.

### Effort Level Injection

`src/runner.ts` – `runIteration` passes the resolved `effort` into the subprocess env:
```ts
env: {
  ...nonInteractiveEnv(),
  ...(selection.effort ? { CLAUDE_CODE_EFFORT_LEVEL: selection.effort } : {}),
},
```

Claude Code reads `CLAUDE_CODE_EFFORT_LEVEL` to adjust its internal compute budget.

### Selection Flow

`resolveModelSelection` (Claude path):
1. Read `.ralph/escalation.json`.
2. Find all `NEEDS_REWORK` scenarios via `findReworkScenarios`.
3. Compute updated state via `updateEscalationState`, persist it.
4. Get target scenario (first rework) via `detectScenarioFromProgress`.
5. Look up its level from updated state (default 0).
6. Index `CLAUDE_LADDER[level]` via `computeModelSelection`.
7. Log: `"N NEEDS_REWORK entries → <model> (effort: <effort>, level: <N>)"`.

## Evidence

- `src/constants.ts`: `CLAUDE_LADDER`, `ESCALATION_FILE`
- `src/types.ts`: `EscalationLevel` (0|1|2|3), `EscalationState`, `EffortLevel`
- `src/model.ts`: `updateEscalationState`, `readEscalationState`, `writeEscalationState`, `computeModelSelection`, `resolveModelSelection`
- `src/runner.ts`: `CLAUDE_CODE_EFFORT_LEVEL` injected into subprocess env
