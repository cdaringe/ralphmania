# Scenario 22 – Workstream State Serialization

## Requirement

> The state of the workstream SHALL be serializable at any point in time,
> allowing the system to be stopped and restarted without loss of progress or
> context. This includes the current iteration, scenario statuses, and
> escalation levels.

## How it is met

Three pieces of durable state together fully reconstruct the workstream:

| State                                                    | File                     | Managed by                         |
| -------------------------------------------------------- | ------------------------ | ---------------------------------- |
| Scenario statuses                                        | `progress.md`            | git-committed by each agent worker |
| Per-scenario escalation levels                           | `.ralph/escalation.json` | `src/model.ts`                     |
| Iteration counter + current step + validation failure    | `.ralph/loop-state.json` | `src/state.ts`                     |

`progress.md` and `.ralph/escalation.json` were already persisted to disk before
this scenario. This change adds the **loop checkpoint** for the remaining
in-memory loop variables, including **precisely which step of the loop** was
active when the process was stopped.

### `src/state.ts`

Three exported functions manage the checkpoint file:

- `readLoopCheckpoint()` – reads `.ralph/loop-state.json`; returns `undefined`
  on a fresh start or missing file.
- `writeLoopCheckpoint(checkpoint)` – writes `{ iterationsUsed, step, validationFailurePath }`.
- `clearLoopCheckpoint()` – deletes the file on clean loop exit so subsequent
  fresh runs start from scratch.

### `LoopCheckpoint` type (`src/types.ts`)

```ts
export type LoopStep = "agent" | "validate" | "done";

export type LoopCheckpoint = {
  readonly iterationsUsed: number;
  readonly step: LoopStep;           // which phase was active when stopped
  readonly validationFailurePath: string | undefined;
};
```

The `step` field records exactly where in the iteration lifecycle the process
was when the checkpoint was written.

### Checkpoint write points in `src/parallel.ts`

| When written                                    | `step` value | Resume behaviour                                   |
| ----------------------------------------------- | ------------ | -------------------------------------------------- |
| Before spawning workers for an iteration        | `"agent"`    | Re-runs agent work for that iteration              |
| After workers complete, before running validate | `"validate"` | Skips agent work, jumps straight to validation     |
| After validation, iteration counter incremented | `"done"`     | Starts the next iteration from scratch             |

### Resume logic

On startup `runParallelLoop` calls `deps.readCheckpoint()`:

1. Restores `iterationsUsed` and `validationFailurePath` from the checkpoint.
2. Sets `skipAgentWork = true` when `checkpoint.step === "validate"`, so the
   first resumed iteration skips the agent phase and goes directly to
   validation.
3. Logs a resume message including the iteration number and step name.
4. Calls `deps.clearCheckpoint()` on clean exit so the next run starts fresh.

### Constant (`src/constants.ts`)

```ts
LOOP_STATE_FILE = ".ralph/loop-state.json"
```

## Tests

### `test/parallel_test.ts` – 6 checkpoint integration tests

| Test                                              | Assertion                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `writes checkpoint after each round`              | agent + validate + done checkpoints written per iteration               |
| `clears checkpoint on clean exit`                 | `clearCheckpoint` called after the loop ends                            |
| `resumes iterationsUsed from checkpoint`          | Starting from checkpoint=3 with max=5 only triggers 2 more rounds      |
| `restores validationFailurePath from checkpoint`  | First post-resume iteration receives the saved failure path             |
| `writes checkpoint with validationFailurePath`    | Failure path from validation is persisted in done checkpoint            |
| `resumes at validate step — skips agent work`     | When checkpoint step="validate", agent phase skipped for that iteration |

### `test/state_test.ts` – 4 unit tests for `src/state.ts`

| Test                                  | Assertion                                            |
| ------------------------------------- | ---------------------------------------------------- |
| `returns undefined when file missing` | Fresh start returns `undefined`                      |
| `write then read round-trips`         | Written checkpoint (incl. `step`) is faithfully restored |
| `clearLoopCheckpoint removes file`    | After clear, read returns `undefined`                |
| `ignores malformed JSON`              | Gracefully returns `undefined` for unparseable files |

All 168 tests pass (`deno test --allow-all`).
