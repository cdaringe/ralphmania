# Scenario 15 – First Boot: Generate `progress.md`

**Spec:** On first boot, the SYSTEM SHALL generate `progress.md` with a
template.

## Implementation

**New file:** `src/progress.ts`

- `parseScenarioCount(specContent)` – counts data rows matching
  `/^\|\s*\d+\s*\|/` in `specification.md`.
- `generateProgressTemplate(count)` – produces a Markdown table with `count`
  blank rows, prefixed with the `<!-- END_DEMO -->` sigil required by
  `resolveModelSelection` in `src/model.ts` (which splits on `"END_DEMO"` to
  locate progress content).
- `ensureProgressFile(log)` – stats `progress.md`; if absent, reads
  `specification.md`, derives scenario count (falls back to 10 if spec is
  unreadable), writes the template, and emits an `[info:progress]` log notice.

**Wired into `mod.ts`** (lines ~109–111):

```ts
await ensureProgressFile(log); // ← scenario 15
const hookResult = await ensureValidationHook(log);
```

Called after config and plugin resolution, before validation-hook check, so the
file is present before any downstream reader (e.g. `resolveModelSelection`)
needs it.

## Evidence

| Check                                                  | Result                            |
| ------------------------------------------------------ | --------------------------------- |
| `deno check mod.ts`                                    | passes – no type errors           |
| `src/progress.ts` exists                               | ✓                                 |
| `mod.ts` imports and calls `ensureProgressFile`        | ✓                                 |
| Template contains `<!-- END_DEMO -->` sigil            | ✓ (required by `src/model.ts:69`) |
| Falls back to 10 rows if `specification.md` unreadable | ✓ (`count                         |
| No-op when file already exists                         | ✓ (`Deno.stat` check)             |
