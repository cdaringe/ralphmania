# Ralphmania State Machines

Three state machines govern the system. Each is implemented as a TypeScript
discriminated union with per-state transition functions that enforce valid edges
at the type level.

## Orchestrator Machine

**File:** `src/state-machine.ts`

Drives the main loop: read progress → find actionable scenarios → dispatch
workers → validate → check doneness → loop.

```typescript
type OrchestratorState =
  | { tag: "init" }
  | { tag: "reading_progress"; iterationsUsed; validationFailurePath }
  | {
    tag: "finding_actionable";
    iterationsUsed;
    validationFailurePath;
    progressContent;
  }
  | {
    tag: "running_workers";
    iterationsUsed;
    validationFailurePath;
    uniqueActionable;
    escalation;
  }
  | { tag: "validating"; iterationsUsed; validationFailurePath }
  | { tag: "checking_doneness"; iterationsUsed; validationFailurePath }
  | { tag: "done"; iterationsUsed }
  | { tag: "aborted" };
```

### Edges

Each transition function has a narrow return type enforcing valid targets:

```
transitionInit              → reading_progress | validating
transitionReadingProgress   → finding_actionable | done | aborted
transitionFindingActionable → running_workers | done
transitionRunningWorkers    → validating | reading_progress
transitionValidating        → checking_doneness
transitionCheckingDoneness  → reading_progress | done
```

### Diagram

```
init
  │
  ▼
reading_progress  ◄───────────────────────┐
  │                                       │
  ├──► done (all verified / limit)        │
  ├──► aborted (signal)                   │
  ▼                                       │
finding_actionable                        │
  │                                       │
  ├──► done (no actionable remain)        │
  ▼                                       │
running_workers                           │
  │                                       │
  ├──► reading_progress (no worktrees)    │
  ▼                                       │
validating                                │
  │                                       │
  ▼                                       │
checking_doneness ────────────────────────┘
  │
  └──► done (all verified)
```

## Worker Machine

**File:** `src/worker-machine.ts`

Models a single agent iteration as a linear pipeline. Separates pure logic
(model selection, prompt/command building) from subprocess I/O (agent
execution), making the pipeline testable without real agent binaries.

```typescript
type WorkerState =
  | { tag: "resolving_model";  iterationNum; agent; level; targetScenarioOverride; ... }
  | { tag: "model_resolved";   iterationNum; agent; selection; validationFailurePath; ... }
  | { tag: "prompt_built";     iterationNum; agent; selection; prompt }
  | { tag: "command_built";    iterationNum; agent; selection; spec }
  | { tag: "running_agent";    iterationNum; agent; selection; spec }
  | { tag: "done";             result: IterationResult }
```

### Edges

```
transitionResolvingModel  → model_resolved       (pure: model selection + onModelSelected hook)
transitionModelResolved   → prompt_built          (pure: buildPrompt + onPromptBuilt hook)
transitionPromptBuilt     → command_built         (pure: buildCommandSpec + onCommandBuilt hook)
transitionCommandBuilt    → running_agent         (pure: pass-through)
transitionRunningAgent    → done                  (I/O: subprocess via AgentRunDeps + onIterationEnd hook)
```

### Diagram

```
resolving_model → model_resolved → prompt_built → command_built → running_agent → done
```

Plugin hooks fire at each transition boundary:

- `onModelSelected` between resolving_model → model_resolved
- `onPromptBuilt` between model_resolved → prompt_built
- `onCommandBuilt` between prompt_built → command_built
- `onIterationEnd` between running_agent → done

## Scenario Lifecycle

**File:** `src/scenario-machine.ts`

Tracks each scenario's status in `progress.md`. Defines valid transitions and
provides `validateTransition()` to detect illegal status changes.

```typescript
type ScenarioState =
  | { tag: "unimplemented"; scenario } // status: "" or missing
  | { tag: "wip"; scenario } // status: WIP
  | { tag: "work_complete"; scenario } // status: WORK_COMPLETE
  | { tag: "verified"; scenario } // status: VERIFIED
  | { tag: "needs_rework"; scenario; reworkNotes } // status: NEEDS_REWORK
  | { tag: "obsolete"; scenario }; // status: OBSOLETE (terminal)
```

### Valid Transitions

```
unimplemented  → wip, work_complete, obsolete
wip            → work_complete, needs_rework, obsolete
work_complete  → verified, needs_rework, obsolete
verified       → needs_rework, obsolete
needs_rework   → wip, work_complete, obsolete
obsolete       → (terminal — no transitions out)
```

Self-transitions (same status) are always valid.

### Diagram

```
""  ──→  WIP  ──→  WORK_COMPLETE  ──→  VERIFIED
 │        │              │                  │
 │        │              ▼                  │
 │        │        NEEDS_REWORK ◄───────────┘
 │        │              │
 │        ▼              ▼
 └──────────────→  OBSOLETE (terminal)
```

## Model Escalation Ladder

Scenario status determines which model config is assigned per-worker:

| Role      | Config                         | Trigger                   |
| --------- | ------------------------------ | ------------------------- |
| Coder     | Sonnet · general · high effort | Unimplemented scenario    |
| Escalated | Opus · strong · high effort    | NEEDS_REWORK (level ≥ 1)  |
| Verifier  | Opus · general · low effort    | All scenarios implemented |

Implemented in `resolveWorkerModelSelection()` (`src/worker-machine.ts`).

## Plugin Hooks

Fired at state transition boundaries across the orchestrator and worker
machines:

```
onConfigResolved → onModelSelected → onPromptBuilt → onCommandBuilt
    → onIterationEnd → onValidationComplete → onLoopEnd
```
