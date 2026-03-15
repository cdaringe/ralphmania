# Scenario 22 – Workstream State Serialization

## Requirement

> The state of the workstream SHALL be serializable at any point in time,
> allowing the system to be stopped and restarted without loss of progress or
> context. This includes the current iteration, scenario statuses, and
> escalation levels.

## How it is met

Three pieces of durable state together fully reconstruct the workstream:

| State                                               | File                     | Managed by                         |
| --------------------------------------------------- | ------------------------ | ---------------------------------- |
| Scenario statuses                                   | `progress.md`            | git-committed by each agent worker |
| Per-scenario escalation levels                      | `.ralph/escalation.json` | `src/model.ts`                     |
| Loop iteration counter + validation failure context | `.ralph/loop-state.json` | `src/state.ts` (new)               |

`progress.md` and `.ralph/escalation.json` were already persisted to disk before
this scenario. This change adds the **loop checkpoint** for the remaining
in-memory loop variables.

### New files

**`src/state.ts`** – three exported functions:

- `readLoopCheckpoint()` – reads `.ralph/loop-state.json`; returns `undefined`
  on a fresh start or missing file.
- `writeLoopCheckpoint(checkpoint)` – atomically writes
  `{ iterationsUsed,
  validationFailurePath }` after each completed round.
- `clearLoopCheckpoint()` – deletes the file on clean loop exit so subsequent
  fresh runs start from scratch.

**Type** `LoopCheckpoint` added to `src/types.ts`:

```ts
export type LoopCheckpoint = {
  readonly iterationsUsed: number;
  readonly validationFailurePath: string | undefined;
};
```

Constant `LOOP_STATE_FILE = ".ralph/loop-state.json"` added to
`src/constants.ts`.

### Changes to `src/parallel.ts`

`ParallelDeps` gains three injectable checkpoint methods:

```ts
readCheckpoint: (() => Promise<LoopCheckpoint | undefined>);
writeCheckpoint: ((checkpoint: LoopCheckpoint) => Promise<void>);
clearCheckpoint: (() => Promise<void>);
```

`runParallelLoop` now:

1. **On entry** – calls `deps.readCheckpoint()` and restores `iterationsUsed`
   and `validationFailurePath` from the saved checkpoint (if present), logging a
   resume message.
2. **After each round** – calls `deps.writeCheckpoint(...)` with the updated
   values so any subsequent kill-and-restart resumes from the correct round.
3. **On clean exit** – calls `deps.clearCheckpoint()` so a fresh invocation
   starts at iteration 0.

### Restart semantics

When restarted with `--iterations N`, the loop resumes at the checkpointed
`iterationsUsed` and continues until `iterationsUsed >= N`. Example: stopped at
iteration 5 of 10 → restart with `--iterations 10` → runs 5 more iterations.

## Tests – `src/parallel_test.ts`

Five new unit tests exercise the checkpoint contract via injected stubs:

| Test                                             | Assertion                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `writes checkpoint after each round`             | `writeCheckpoint` called once per round with correct `iterationsUsed` |
| `clears checkpoint on clean exit`                | `clearCheckpoint` called after the loop ends                          |
| `resumes iterationsUsed from checkpoint`         | Starting from checkpoint=3 with max=5 only triggers rounds 4 and 5    |
| `restores validationFailurePath from checkpoint` | First post-resume iteration receives the saved failure path           |
| `writes checkpoint with validationFailurePath`   | Failure path from validation is persisted in checkpoint               |

All 27 tests in `src/parallel_test.ts` pass (`ok | 27 passed | 0 failed`).
