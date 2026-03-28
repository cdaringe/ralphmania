# GUI.b — Overall Status with Set Differences

## Requirement

The GUI SHALL display overall status, showing the set differences between the
specifications and the progress.

## Implementation

### Live GUI integration

The main GUI page at `/` includes a **Progress** sidebar section that:

- Fetches `/api/status` on page load and re-fetches on every orchestrator state
  transition (`state` SSE event) and worker completion (`worker_done` event)
- Displays a summary line: `N/M verified · K rework · J wip · L not started`
- Renders a compact per-scenario status list with color-coded statuses
- Links to `/status` for the full standalone HTML status page

### Endpoints on the GUI server (`src/gui/server.ts`)

| Route         | Response                                               |
| ------------- | ------------------------------------------------------ |
| `/api/status` | JSON `StatusDiff` (specOnly, progressOnly, shared)     |
| `/status`     | Self-contained HTML page via `generateStatusHtml`      |

Both endpoints use a `StatusProvider` function injected via `GuiServerOptions`,
keeping the server testable with DI (no real file I/O in tests).

### Core logic: `src/status-diff.ts`

Two pure functions compute the set-theoretic diff:

- **`computeStatusDiff(specIds, progressRows)`** → `{ specOnly, progressOnly, shared }`
- **`generateStatusHtml(diff)`** → full HTML page with color-coded status table

### Wiring: `mod.ts`

The `statusProvider` reads `specification.md` and `progress.md` via
`Deno.readTextFile`, parses them with `parseScenarioIds` and
`parseProgressRows`, and computes the diff with `computeStatusDiff`.

## Evidence

### E2E tests: `test/gui_status_e2e_test.ts` (10 tests)

| Test                                               | Covers                                       |
| -------------------------------------------------- | -------------------------------------------- |
| GET /api/status returns JSON diff (provider)       | JSON endpoint with configured provider       |
| GET /api/status returns empty diff (no provider)   | Graceful fallback when no provider            |
| GET /api/status returns 500 (provider throws)      | Error handling                               |
| GET /status returns HTML (provider)                | Full HTML status page rendering              |
| GET /status returns fallback (no provider)         | No-provider graceful response                |
| GET /status returns 500 (provider throws)          | Error handling                               |
| GET / HTML contains status section + fetchStatus   | Main page includes Progress sidebar + JS     |
| SSE delivers worker_active and worker_done events  | SSE event delivery for worker lifecycle      |
| Status reflects updated data on re-fetch           | Dynamic status updates across requests       |
| GuiLogger → SSE worker_active integration          | Full stack: logger → bus → SSE → client      |

### Unit tests: `test/status_diff_test.ts` (10 tests)

All `computeStatusDiff` and `generateStatusHtml` branches covered at 100%.

### Key design decisions

- **DI via `StatusProvider`**: server receives a `() => Promise<StatusDiff>`
  function, enabling tests to inject canned data without file I/O
- **Polling on state change**: main page JS re-fetches `/api/status` on every
  `state` and `worker_done` SSE event, providing realtime status updates
- **No new SSE event type**: status is fetched via HTTP on demand rather than
  pushed via SSE, keeping the event bus simple
