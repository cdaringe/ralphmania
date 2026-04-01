# GUI.e — Edit Progress from the GUI

## Scenario

> Scenario edit tasks SHALL be offered through the GUI, including, but not
> limited to: updating a progress status to NEEDS_REWORK with rework notes, or
> marking a status as obsolete.

## How It Is Achieved

- **HTTP API** (`src/gui/server.tsx`)
  - PATCH `/api/scenario/:id` now enforces the canonical status set
    (`WIP|WORK_COMPLETE|VERIFIED|NEEDS_REWORK|OBSOLETE`), rejects missing
    statuses, and requires non-empty notes for `NEEDS_REWORK`.
  - Requests are normalized to uppercase, notes are single-line sanitized, and
    OBSOLETE updates automatically clear rework notes.
- **Progress write path** (`src/gui/server.tsx` → `updateProgressRow`)
  - The injected `progressRowUpdater` still performs surgical table rewrites,
    but now receives validated, normalized payloads directly from the GUI API.
- **Scenario page UX** (`src/gui/islands/scenario-page-app.tsx`)
  - Adds two explicit actions: **Mark NEEDS_REWORK** (notes required) and **Mark
    OBSOLETE**.
  - Rework textarea is reused and validated client-side; status feedback shows
    save success/errors without reloading the page.
- **Reliability of GUI events** (`src/gui/log-dir.ts`, `src/gui/server.tsx`)
  - SSE tailer now de-duplicates file paths, adds a polling safety net, and
    shifts the hydration marker to a comment so initial sync signals do not
    suppress worker events.
- **Tests**
  - `test/gui_scenario_edit_e2e_test.ts` exercises success and error flows for
    NEEDS_REWORK (notes required), OBSOLETE (notes cleared), and invalid
    statuses via real HTTP calls and progress file rewrites.
  - GUI SSE e2e tests pass after the hydration signal adjustment, ensuring the
    edit actions coexist with the live event stream.

## Evidence

| Artifact                                   | Detail                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `src/gui/server.tsx`                       | Validates status + notes, sanitizes inputs, writes via `progressRowUpdater` |
| `src/gui/islands/scenario-page-app.tsx`    | Dual buttons for NEEDS_REWORK + OBSOLETE with inline validation             |
| `src/gui/log-dir.ts`, `src/gui/server.tsx` | Polling + canonicalized paths; hydration comment preserves SSE delivery     |
| `test/gui_scenario_edit_e2e_test.ts`       | 4 e2e cases covering NEEDS_REWORK, missing notes, OBSOLETE, invalid status  |
| `test/gui_status_e2e_test.ts`              | SSE delivery now stable alongside scenario edit traffic                     |
