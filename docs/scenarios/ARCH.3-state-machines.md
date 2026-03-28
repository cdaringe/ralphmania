# ARCH.3 — State Machine Management of Long Running Processes

**Scenario:** The system SHALL manage long running processes via state
transitions, or minimally, tagged states for those that aren't FSMs.

## How It Is Achieved

Three FSMs govern the ralphmania runtime. Each uses a **TypeScript discriminated
union** as its state type — every state is a deeply-`Readonly` object with a
`tag` field, and all data needed for the next transition is carried immutably in
the state value itself.

---

### 1. Orchestrator FSM — `src/machines/state-machine.ts`

Governs the top-level parallel loop. States:

```
init → reading_progress → finding_actionable → running_workers
     ↘                                                         ↘
      → validating → checking_doneness → done / aborted
```

Key types and entry points:

- `OrchestratorState` — 8-variant tagged union
  (`init | reading_progress | finding_actionable | running_workers | validating | checking_doneness | done | aborted`)
- `isTerminal(s)` — narrows to `DoneState | AbortedState`
- `transition(state, ctx)` — top-level dispatcher; logs every `from → to` at
  debug level
- Per-state functions: `transitionInit`, `transitionReadingProgress`,
  `transitionFindingActionable`, `transitionRunningWorkers`,
  `transitionValidating`, `transitionCheckingDoneness`
- `MachineContext` — immutable config + injectable `MachineDeps` threaded
  through all transitions
- `MachineDeps` — DI interface abstracting all I/O (file reads, subprocess
  spawning, git ops, checkpoint reads/writes)

**Recoverability:** `transitionInit` reads a persisted `LoopCheckpoint` from
`.ralph/loop-state.json`; if `step === "validate"` it resumes at the validating
state, skipping re-running agents (ARCH.4).

---

### 2. Worker FSM — `src/machines/worker-machine.ts`

Governs a single agent iteration as a linear pipeline:

```
resolving_model → model_resolved → prompt_built → command_built → running_agent → done
```

Key types:

- `WorkerState` — 6-variant tagged union
- `isWorkerTerminal(s)` — narrows to `DoneState`
- `workerTransition(state, opts)` — dispatcher; logs every `from → to` at debug
  level
- `initialWorkerState(opts)` — constructs the `resolving_model` entry state

Plugin hooks fire at boundaries: `onModelSelected`
(resolving_model→model_resolved), `onPromptBuilt` (model_resolved→prompt_built),
`onCommandBuilt` (prompt_built→command_built), `onIterationEnd`
(running_agent→done).

---

### 3. Scenario Lifecycle FSM — `src/machines/scenario-machine.ts`

Encodes the valid status transitions for each scenario in `progress.md`:

```
"" (unimplemented) → WIP → WORK_COMPLETE → VERIFIED
                  ↘      ↘              ↘
                           NEEDS_REWORK ────────────────────┐
                                                             ↓
                                                       OBSOLETE (terminal)
```

Key exports:

- `ScenarioState` — 6-variant tagged union
  (`unimplemented | wip | work_complete | verified | needs_rework | obsolete`)
- `isTerminalScenario(s)` — true for `verified` and `obsolete`
- `statusToState(scenario, status, reworkNotes?)` — maps progress.md status
  strings to typed states
- `stateToStatus(s)` — inverse mapping
- `validateTransition(from, to)` — checks a single transition against
  `VALID_TRANSITIONS` map
- `validateProgressTransitions(oldRows, newRows, log?)` — batch-validates all
  status changes in a progress.md update; returns all invalid transitions

---

## Evidence

### State Transitions Are Typed

Every state carries exactly the data needed for the next step — no nullish
fields, no shared mutable state. Illegal transitions are caught by TypeScript's
narrowing:

```ts
// state-machine.ts — return types are narrowed per-transition
export const transitionInit = async (
  ctx: MachineContext,
): Promise<ReadingProgressState | ValidatingState> => { ... }

export const transitionReadingProgress = async (
  state: ReadingProgressState,
  ctx: MachineContext,
): Promise<FindingActionableState | DoneState | AbortedState> => { ... }
```

### Dispatcher Logs Every Transition

`transition()` and `workerTransition()` both emit a debug log after every step:

```ts
ctx.log({
  tags: ["debug", "orchestrator", "transition"],
  message: `${from} → ${next.tag}`,
});
```

### 98 Tests Cover All Three FSMs

| Test file                               | Tests | Coverage                  |
| --------------------------------------- | ----- | ------------------------- |
| `src/machines/scenario-machine.test.ts` | 42    | 96.7% branch / 100% line  |
| `src/machines/state-machine.test.ts`    | 35    | 88.7% branch / 90.7% line |
| `src/machines/worker-machine.test.ts`   | 21    | 90.9% branch / 96.1% line |

Tests exercise:

- All valid and invalid scenario lifecycle transitions
- Orchestrator transitions including checkpoint resume, abort signal, iteration
  limit, NEEDS_REWORK priority ordering, validation failure path, all-OBSOLETE
  recovery
- Worker pipeline transitions including plugin hook overrides, model escalation
  (claude/codex), full end-to-end drive to `done`
