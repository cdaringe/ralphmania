# Scenario 5: SIGINT Graceful Shutdown

**Spec:** The system SHALL handle SIGINT gracefully: first signal aborts the current iteration, second signal force-exits with code 130.

## Implementation

`mod.ts:97-106` — Two-stage SIGINT handler:

1. **First SIGINT**: `onSigint` fires, calls `shutdownController.abort()` (propagates `AbortSignal` to the running agent subprocess via `AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])` in `runner.ts:130`), logs "ctrl+c again to force exit", removes itself, then registers a second handler.

2. **Second SIGINT**: the newly registered handler calls `Deno.exit(130)` unconditionally.

```ts
// mod.ts:97-106
const onSigint = () => {
  log({ tags: ["error"], message: "Interrupted (ctrl+c again to force exit)" });
  shutdownController.abort();
  Deno.removeSignalListener("SIGINT", onSigint);
  Deno.addSignalListener("SIGINT", () => Deno.exit(130));
};
Deno.addSignalListener("SIGINT", onSigint);
```

The loop also checks `shutdownController.signal.aborted` at the top of each iteration (`mod.ts:120`) and returns `130` for a clean post-iteration exit — but the second-signal path uses `Deno.exit(130)` for an immediate force-exit even mid-iteration.

## Evidence

- `mod.ts:97-106` — SIGINT handler registration with two-stage logic
- `runner.ts:130` — `AbortSignal.any([signal, ...])` propagates abort to subprocess
- Exit code 130 = 128 + SIGINT(2), matching Unix convention
