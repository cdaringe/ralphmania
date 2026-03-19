# Scenario 27: Parallel Worker Scenario Prescription

## Requirement

The system SHALL prevent parallel workers from working on the same scenario
simultaneously. The parent process SHALL prescribe a scenario for the worker to
focus on.

## Implementation

### Root cause of prior gap

In `src/orchestrator.ts`, `targetScenarioOverride` was only passed to
`runWorker` when rework scenarios existed (`reworkSet.size > 0`). For normal
(non-rework) iterations, no scenario was prescribed — workers received no
explicit focus constraint and could theoretically pick any actionable scenario.

### Fix

`src/orchestrator.ts` line ~317: removed the conditional spread and always
passes `targetScenarioOverride`:

```typescript
// Before (broken)
...(reworkSet.size > 0
  ? { targetScenarioOverride: actionableScenarios[i] }
  : {}),

// After (correct)
targetScenarioOverride: actionableScenarios[i],
```

### How collision is prevented

1. The orchestrator computes `actionableScenarios` (NEEDS_REWORK first, then
   unimplemented) before creating any worktrees.
2. Worker `i` is assigned `actionableScenarios[i]` — each worker gets a
   **distinct index** into a deduplicated list.
3. `targetScenarioOverride` is forwarded through `runWorker` → `runIteration` →
   `buildPrompt`, which appends to the agent prompt:
   ```
   ACTUALLY:
   - You must work ONLY on scenario N.
   - Do not work on any other scenario in this iteration.
   ```
4. The git branch name also encodes the scenario:
   `ralph/worker-{i}-scenario-{N}-{ts}`, making assignment visible in git
   history.

### Evidence

- **`src/orchestrator.ts`**: `targetScenarioOverride: actionableScenarios[i]` —
  unconditional assignment.
- **`src/command.ts` `buildPrompt`**: emits the
  `ACTUALLY: You must work ONLY on scenario N` instruction when `targetScenario`
  is defined.
- **`test/orchestrator_test.ts`**:
  - `"runParallelLoop always prescribes targetScenarioOverride to workers"` —
    verifies single worker receives scenario 1.
  - `"runParallelLoop prescribes distinct scenarios to parallel workers"` —
    verifies 3 workers receive scenarios `[1, 2, 3]` with no duplicates.
  - All 31 orchestrator tests pass.
