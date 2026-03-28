# GUI.c — Dedicated Worker Page

**Scenario**: The GUI SHALL support viewing a page dedicated to an active worker,
where we see what the worker is tasked with, its current state, and its stream.

## How it is achieved

### 1. Worker events emitted from GuiLogger (`src/gui/logger.ts`)

`createGuiLogger` now detects two log patterns and emits structured events:

- **`worker_active`** — detected via `WORKER_LAUNCH_RE` when the orchestrator
  logs `"Round N: launching M worker(s) for scenarios [s1, s2, ...]"`.
  One `{ type: "worker_active", workerIndex: i, scenario }` event is emitted per
  scenario in the list.
- **`worker_done`** — detected via `WORKER_DONE_RE` when the orchestrator logs
  `"Scenario X: resolved by worker N"` or `"…still actionable after worker N"`.
  Emits `{ type: "worker_done", workerIndex: N }`.

Both event types were already defined in `src/gui/events.ts`; this change wires
them to real emission.

### 2. Dedicated worker page HTML (`src/gui/html.ts` — `WORKER_PAGE_HTML`)

A new `WORKER_PAGE_HTML` constant is served at `/worker/:id`. The page:

| Element | Content |
|---------|---------|
| **Worker** info panel | Displays `W{n}` (the worker index) |
| **Scenario** info panel | Reads `?scenario=` query param on load; updates on `worker_active` event |
| **State** badge | Starts as `waiting`; transitions to `running` on `worker_active`, `done` on `worker_done` |
| **Stream** log pane | Shows only `log` events whose `message` starts with `[W{n}]` (the worker-prefixed lines added by `prefixLog` in the state machine) — the prefix is stripped for display |

The page connects to the global `/events` SSE stream and filters client-side by
`workerIndex`.

### 3. `/worker/:id` route (`src/gui/server.ts`)

```
GET /worker/0   → WORKER_PAGE_HTML
GET /worker/3   → WORKER_PAGE_HTML
GET /           → GUI_HTML  (overview, unchanged)
GET /events     → SSE stream (unchanged)
```

A `workerMatch = path.match(/^\/worker\/(\d+)$/)` guard routes numeric worker
IDs to the new page; all other paths still fall through to the overview.

### 4. Main page links workers (`src/gui/html.ts` — `GUI_HTML`)

Worker cards in the sidebar are now `<a class="wcard" href="/worker/N?scenario=X">` links
built dynamically when `worker_active` events arrive, giving users a
one-click path to the detail page.

## Evidence

- **`test/gui_logger_test.ts`** — 4 new tests verify `worker_active` and
  `worker_done` emission for launch/resolved/still-actionable/single-worker
  log patterns.
- **`test/gui_server_test.ts`** — 3 new tests verify the `/worker/:id` route
  serves the worker page, matches `WORKER_PAGE_HTML` exactly, and that the
  HTML contains all required elements (`worker-title`, `scenario-val`,
  `state-val`, `/events`, `worker_active`, `worker_done`, `overview`).
- All 544 tests pass (`deno task test`).
