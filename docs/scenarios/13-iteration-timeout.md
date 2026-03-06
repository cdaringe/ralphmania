# Scenario 13 – Iteration Timeout (60 Minutes)

**Status: COMPLETE**

## Requirement

Each agent iteration SHALL be capped at 60 minutes, after which the iteration is
terminated and the loop continues.

## Implementation

### Timeout Constant

`src/constants.ts`:

```ts
export const TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
```

### AbortSignal Composition

`src/runner.ts` – `runIteration`:

```ts
const combinedSignal = AbortSignal.any([
  signal, // user SIGINT
  AbortSignal.timeout(TIMEOUT_MS), // 60-minute hard cap
]);
```

The combined signal is passed to `Deno.Command(...).spawn()`, killing the
subprocess when either source fires.

### Timeout Detection and Continuation

The subprocess is wrapped in a `try/catch`. On timeout, `Deno.Command` throws a
`DOMException` with `name === "AbortError"`:

```ts
} catch (error) {
  if (error instanceof DOMException && error.name === "AbortError") {
    log({ tags: ["error"], message: `TIMEOUT: iteration ${iterationNum} exceeded 60 minutes` });
    const result: IterationResult = { status: "timeout" };
    await plugin.onIterationEnd?.({ result, ctx });
    return result;
  }
  throw error;
}
```

The `"timeout"` result is returned to `runLoopIteration`, which treats it like
any non-complete iteration and continues to the next loop cycle — the loop does
not exit.

## Evidence

- `src/constants.ts`: `TIMEOUT_MS = 60 * 60 * 1000`
- `src/runner.ts`: `AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])`,
  timeout catch block
- `src/types.ts`: `IterationResult` includes `{ status: "timeout" }`
