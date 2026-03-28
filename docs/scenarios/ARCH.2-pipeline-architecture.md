# ARCH.2 — Pipeline Architecture

## Scenario

> The system SHALL attempt to keep workflows formed as pipelines (or flat linear
> semantic sequences), and offload transforms, reductions, derivations, and more
> into domain specific modules.

## How It Is Achieved

### Two Explicit Pipeline State Machines

**Orchestrator pipeline** (`src/state-machine.ts`):

```
init → reading_progress → finding_actionable → running_workers
     → validating → checking_doneness → done
```

Each state is a typed discriminated-union object. `transition()` dispatches to
a single `transition<State>` function per step. No logic lives in the
dispatcher — it is a pure router.

**Worker pipeline** (`src/worker-machine.ts`):

```
resolving_model → model_resolved → prompt_built → command_built
                → running_agent → done
```

Same pattern: `workerTransition()` is a pure router; every actual step calls
into a domain module.

### Domain Modules Own the Logic

| Module | Transforms / Derivations |
|---|---|
| `src/model.ts` | Model selection, escalation state, progress row analytics (`parseImplementedCount`, `parseTotalCount`, `findActionableScenarios`, `isAllVerified`, `updateEscalationState`, `validateProgressStatuses`, **`orderActionableScenarios`**, **`computeEffectiveLevel`**) |
| `src/command.ts` | `buildPrompt`, `buildCommandSpec` |
| `src/parsers/progress-rows.ts` | Progress table → `ProgressRow[]` |
| `src/validation.ts` | Validation execution and log capture |
| `src/worktree.ts` | Git worktree operations |
| `src/reconcile.ts` | Merge-conflict reconciliation |
| `src/set-fns.ts` | Set-difference / XOR utilities |

### Refactoring Applied for ARCH.2

Two inline derivations were extracted from pipeline stages into `src/model.ts`:

1. **`orderActionableScenarios(rows, specIds)`** — formerly inline in
   `transitionFindingActionable`. Derives the rework-first ordered actionable
   list from parsed rows and the spec ID list. Pure, no I/O.

2. **`computeEffectiveLevel(scenario, escalation, minLevel)`** — formerly inline
   in `transitionRunningWorkers`. Combines per-scenario escalation state with
   the operator's `--level` floor and clamps to `EscalationLevel` (0 | 1).
   Pure, no I/O.

After the refactor the pipeline transition functions are thin orchestrators:
they read/write state and call domain functions — they do not compute.

## Tests

- `test/state_machine_test.ts` — 40+ tests covering every `transition*`
  function, multi-step sequences, checkpoint resume, and validation-failure
  edge cases.
- `test/worker_machine_test.ts` — full pipeline traversal test plus per-step
  transition tests.
- `test/model_test.ts` — unit tests for both new domain functions:
  `orderActionableScenarios` (4 cases) and `computeEffectiveLevel` (6 cases).
