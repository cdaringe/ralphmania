# Scenario 16 – Logger identifies ralphmania logs

## Requirement

> The logger SHALL clearly identify ralphmania logs as associated with ralphmania, as there are many other streams piped to stdio within ralphmania.

## Implementation

Every log line emitted by `createLogger` (`src/logger.ts`) now begins with a
`ralph` prefix, making ralphmania output instantly distinguishable from
agent/subprocess output:

```
[ralph:info:iteration] Starting 1 (sonnet)...
[ralph:error:validate] Validation failed (iteration 2), see .ralph/validation/iteration-2.log
```

### Change

`src/logger.ts:34–36` — the encoded string was updated from:

```
[<tags>] <message>
```

to:

```
[ralph:<tags>] <message>
```

The `ralph` prefix is rendered in `magenta` (matching the ralphmania banner
color) so it stands out visually from agent stdout/stderr even when multiple
streams are interleaved.

## Evidence

- `src/logger.ts` — single-site change; all callers go through `createLogger`,
  so every log line across the system gains the prefix automatically.
- No tests required beyond visual inspection; the format is purely additive.
