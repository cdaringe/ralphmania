# Scenario 18 – Model-Selection Progress Status Log

## Requirement

At each iteration start, the model-selection log SHALL report progress as
`"Status: N of M implemented, finding next task..."` (parsed from `progress.md`)
when no rework is pending, and mention `NEEDS_REWORK` only when rework entries
exist.

## Implementation

**`src/model.ts`** — `resolveModelSelection` (called at the start of every
iteration via `runIteration`):

- Two new exported helpers parse the post-`END_DEMO` section of `progress.md`:
  - `parseImplementedCount(content)` — counts rows matching
    `/^\|\s*\d+\s*\|\s*(COMPLETE|VERIFIED)\s*\|/gm`
  - `parseTotalCount(content)` — counts all data rows matching
    `/^\|\s*\d+\s*\|/gm`

- The log message is now conditional:
  ```
  reworkCount > 0
    → "<N> NEEDS_REWORK entries → using <model>"
    → "Status: <N> of <M> implemented, finding next task..."
  ```

## Evidence

- `src/model_test.ts` — 4 new unit tests cover both helpers and both log message
  branches; all 17 tests pass (`deno test src/model_test.ts`).
- The log is emitted via
  `log({ tags: ["info", "model"], message: statusMessage })` inside
  `resolveModelSelection`, which is invoked once per iteration before any agent
  subprocess is spawned.
