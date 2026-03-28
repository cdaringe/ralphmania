# ARCH.4 — Recoverability

**Scenario**: The system SHALL be recoverable. If a process crashes or a web
page is refreshed, the implementations SHALL restore valid states.

## How It Is Achieved

Recovery is implemented via three complementary persistence layers, all
coordinated through the orchestrator state machine
(`src/machines/state-machine.ts`).

### 1. Loop Checkpoint (`src/state.ts`)

At each step of every iteration the orchestrator writes
`.ralph/loop-state.json`:

| When written                            | `step` value | Effect on resume                         |
| --------------------------------------- | ------------ | ---------------------------------------- |
| Before spawning workers                 | `"agent"`    | Re-runs agents for that iteration        |
| After merges, before validation         | `"validate"` | Skips agents, re-runs validation only    |
| After validation, before next iteration | `"done"`     | Advances to the correct iteration number |

The checkpoint also carries `validationFailurePath` so the last known failure
context is fed back to the agent after a crash.

On a clean exit `clearLoopCheckpoint` removes the file, leaving no stale state
(`orchestrator.ts:109`).

**Key functions** (`src/state.ts`):

- `readLoopCheckpoint()` — gracefully returns `undefined` for missing/corrupt
  files
- `writeLoopCheckpoint(checkpoint)` — atomic JSON write to
  `.ralph/loop-state.json`
- `clearLoopCheckpoint()` — removes file, silently no-ops if already gone

### 2. Init-state recovery (`state-machine.ts:187–208`)

`transitionInit` reads the checkpoint and branches:

```
checkpoint.step === "validate"  →  ValidatingState  (skip agents)
otherwise                       →  ReadingProgressState (normal flow)
```

`iterationsUsed` and `validationFailurePath` are restored verbatim, so the loop
resumes at exactly the right iteration count with the correct error context.

### 3. Escalation State (`src/model.ts:243–274`)

Per-scenario escalation levels are persisted independently to
`.ralph/escalation.json` (`readEscalationState` / `writeEscalationState`).
Because this file is written every iteration and never cleared, a restarted
process immediately inherits the correct rework escalation level for each
scenario without re-doing failed rounds.

### Web-page recovery

For the `serve receipts` command (scenario 21), all content is statically
generated to `.ralph/receipts/`. A browser refresh re-fetches the same files; no
transient state is lost.

## Evidence

| File                            | Key lines                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `src/state.ts`                  | Full file — checkpoint I/O with graceful error handling                           |
| `src/machines/state-machine.ts` | `transitionInit` lines 187–208; checkpoint writes lines 365–369, 556–560, 588–592 |
| `src/orchestrator.ts`           | Line 109 — `clearCheckpoint` on clean exit                                        |
| `src/model.ts`                  | Lines 243–274 — escalation state read/write                                       |

## Tests

**Unit** (`test/state_test.ts`):

- Round-trip write → read
- Clear removes file
- Rejects invalid `step` values
- Ignores malformed JSON (`.catch` swallows parse errors)

**Unit** (`test/orchestrator_test.ts`):

- Resumes `iterationsUsed` from checkpoint
- Restores `validationFailurePath` from checkpoint
- Resumes at `"validate"` step — agent not re-invoked
- Checkpoint written at each step per iteration (`done` checkpoints = [1,2,3])
- Checkpoint cleared on clean exit

**Integration** (`test/orchestrator_integration_test.ts`):

- `integration(ARCH.4): crash recovery — resumes from persisted checkpoint` —
  pre-seeds `iterationsUsed=2`, runs with `iterations=4`, asserts only 2 agent
  runs and checkpoint cleared
- `integration(ARCH.4): crash at validate step — agent skipped, validation reruns`
  — pre-seeds `step="validate"`, asserts agent runs once for the next iteration
- `integration(ARCH.4): validationFailurePath restored from checkpoint across restart`
  — pre-seeds failure path, asserts agent receives it on first resumed run
- `integration(ARCH.4): escalation state survives simulated restart` — pre-seeds
  `{ "1.1": 1 }`, asserts worker receives level 1 without a prior rework cycle
