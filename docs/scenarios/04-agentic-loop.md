# Scenario 4 – Agentic Loop: N Iterations, Early Stop

**Spec:** The system SHALL run an AI agent iteratively up to N iterations,
stopping early when all scenarios are verified complete.

## Status: COMPLETE

## Evidence

### Loop bounded by `--iterations N`

`mod.ts:125-139` — the main entry point drives the loop:

```ts
for (let i = 1; i <= iterations; i++) {
  if (shutdownController.signal.aborted) { ... return 130; }
  state = await runLoopIteration({ state, iterationNum: i, agent, signal, log, plugin });
  if (state.task === "complete") break;   // early-stop
}
```

`iterations` comes from `--iterations` / `-i` CLI flag (see Scenario 2). The
loop runs at most `N` times; `break` fires whenever the loop transitions to the
`"complete"` state.

### State machine controlling early stop

`src/runner.ts:232-323` — `runLoopIteration` advances `LoopState` through three
phases per iteration:

| Phase               | What happens                                                       | Transition                                              |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| 1 – Agent Execution | Spawns agent subprocess, watches for `COMPLETION_MARKER` in stdout | `IterationResult.status = "complete"` when marker found |
| 2 – Validation      | Runs `specification.validate.sh`; captures exit code               | `validation.status = "passed"` on exit 0                |
| 3 – Receipts        | Calls `updateReceipts` with the fast model                         | `LoopState.task = "complete"` on success                |

Early stop requires **both** conditions (`src/runner.ts:287-288`):

```ts
const isPriorWorkOk = validation.status === "passed" &&
  result.status === "complete";
```

Only when `isPriorWorkOk` is true does the state advance to `"complete"`, which
causes the outer loop to `break`.

### Completion marker

`src/constants.ts` — `COMPLETION_MARKER` is the sentinel string the agent
outputs to signal "all scenarios done." The agent is prompted to emit it via
`BASE_PROMPT` step 6. `pipeStream` (`src/runner.ts:74-92`) scans every stdout
chunk for the marker.

### Loop exhaustion (no early stop)

If the loop finishes all `N` iterations without hitting `"complete"`,
`mod.ts:147-151` logs `"All N iterations completed without completion marker."`
and exits 0 — a non-destructive fallback.
