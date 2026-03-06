# Scenario 8 – NEEDS_REWORK Detection and Model Escalation

**Status: COMPLETE**

## Requirement

The system SHALL detect `NEEDS_REWORK` entries in `progress.md` and escalate model selection. For Claude, per-scenario escalation state is tracked in `.ralph/escalation.json`; levels increase monotonically within a scenario's rework lifecycle and reset when the scenario exits `NEEDS_REWORK`. For Codex, the existing 3-tier rework-count escalation applies.

## Implementation

### NEEDS_REWORK Detection

`src/model.ts` – `findReworkScenarios(content)` scans `progress.md` (post-`END_DEMO`) for rows matching `/^\|\s*(\d+)\s*\|\s*NEEDS_REWORK\s*\|/gm` and returns all scenario numbers in rework.

### Per-Scenario Escalation State (Claude)

`src/constants.ts` – `ESCALATION_FILE = ".ralph/escalation.json"` is the persistence path.

`src/model.ts` – `readEscalationState` / `writeEscalationState` read/write a `Record<string, EscalationLevel>` (0–3) keyed by scenario number string.

`updateEscalationState({ current, reworkScenarios })` applies the transition rules:
- Scenarios newly in rework → start at level 1.
- Scenarios still in rework → level incremented (capped at 3 via `clampLevel`).
- Scenarios no longer in rework → removed from state (effectively reset to 0 on next entry).

### Model Selection with Escalation Level

`computeModelSelection` in `src/model.ts` receives the resolved `escalationLevel` for the first rework scenario (from `detectScenarioFromProgress`) and indexes into `CLAUDE_LADDER`:

| Level | Model  | Effort |
|-------|--------|--------|
| 0     | sonnet | low    |
| 1     | sonnet | high   |
| 2     | opus   | medium |
| 3     | opus   | high   |

The selected model/effort/mode flows into `runIteration` via `resolveModelSelection` → `ModelSelection`.

### Codex Escalation

For Codex, `computeModelSelection` falls back to a rework-count threshold (`REWORK_THRESHOLD = 1`): 0 rework → fast, 1 rework → general, >1 rework → strong.

### Integration Point

`resolveModelSelection` in `src/model.ts` is called at the start of each `runIteration` in `src/runner.ts`. It reads progress, detects rework, updates `.ralph/escalation.json`, and returns the correctly escalated `ModelSelection`.

## Evidence

- `src/model.ts`: `findReworkScenarios`, `updateEscalationState`, `readEscalationState`, `writeEscalationState`, `computeModelSelection`, `resolveModelSelection`
- `src/constants.ts`: `CLAUDE_LADDER`, `ESCALATION_FILE`, `REWORK_THRESHOLD`
- `src/types.ts`: `EscalationLevel`, `EscalationState`, `ModelSelection`
- `src/runner.ts`: calls `resolveModelSelection` at the top of `runIteration`
