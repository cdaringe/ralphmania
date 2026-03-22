# Scenario 33 — Worker stdio per-line prefix

**Requirement:** Workers SHALL stream their stdio with a per-line prefix, with a
fixed length colored prefix so that output is easily identifiable to the reader
on the CLI stdio output ONLY. That is to say, NO prefixing when flushing stdio
to disk, but pretty prefixing (e.g. in green [w0/task-a], in reg [w1/task-b])
when sending to the users terminal.

## Implementation

### Core utilities — `src/runner.ts`

**`workerPrefix(workerIndex, scenario)`** (exported, line ~87):

- Produces a fixed-width colored string: `[wN/sNN]`
- Worker index: bare digit (0–9); scenario: zero-padded 2 digits (e.g. `s33`,
  `s04`, `s--` for undefined)
- Colors cycle through `[green, yellow, cyan, magenta, blue]` so each worker is
  visually distinct
- Colors are applied by `colors.ts` which automatically strips ANSI codes in
  non-TTY (CI) contexts

**`linePrefixTransform(prefix)`** (exported, line ~100):

- A `TransformStream<Uint8Array, Uint8Array>` that prepends `prefix` to the
  first character of every line
- Tracks `lineStart: boolean` across chunks to correctly handle multi-chunk
  lines
- Applied ONLY for terminal output — disk paths (validation logs) bypass it
  entirely

### Terminal-only application — `executeAgent` in `src/runner.ts`

```typescript
const prefix = workerIndex !== undefined
  ? workerPrefix(workerIndex, selection.targetScenario)
  : undefined;

const rawStdout = agent === "claude"
  ? child.stdout.pipeThrough(ndjsonResultTransform())
  : child.stdout;

// prefix transform applied here, ONLY for terminal output
const stdoutStream = prefix
  ? rawStdout.pipeThrough(linePrefixTransform(prefix))
  : rawStdout;
const stderrStream = prefix
  ? child.stderr.pipeThrough(linePrefixTransform(prefix))
  : child.stderr;
```

Disk writes (`.ralph/validation/iteration-N.log`) go through `validation.ts`'s
`tee()` which independently captures stdio — the prefix transform is never in
that path.

### `workerIndex` threading

- `AgentRunDeps.execute` opts: added `workerIndex?: number`
- `transitionRunningAgent` (worker-machine.ts): 7th parameter `workerIndex?`,
  forwarded to `deps.execute`
- `workerTransition` opts: added `workerIndex?`, passed to
  `transitionRunningAgent`
- `runIteration` opts: added `workerIndex?`, passed to `workerTransition`
- `MachineDeps.runIteration` opts (state-machine.ts): added `workerIndex?`
- `transitionRunningWorkers`: passes `workerIndex: i` (the parallel worker
  index) to `runIteration`

## Evidence

- `test/runner_test.ts`: 9 new tests covering `workerPrefix` (format, padding,
  cycling) and `linePrefixTransform` (single line, multi-line, empty,
  cross-chunk, disk bypass)
- Terminal output path: `executeAgent` applies `linePrefixTransform` before
  writing to `Deno.stdout`/`Deno.stderr`
- Disk path: `runValidation` in `validation.ts` uses its own `tee()` stream — no
  prefix transform applied
- The `COMPLETION_MARKER` detection in `pipeStream` is unaffected because the
  KMP scan finds the marker as a substring regardless of the per-line prefix
