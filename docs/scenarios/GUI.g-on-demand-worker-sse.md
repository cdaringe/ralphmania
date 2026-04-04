# GUI.g — On-Demand Worker Log SSE Streaming

## Scenario

> The SSE event stream SHALL tail only the orchestrator log by default. Worker
> logs SHALL be tailed on demand when a user opens a worker viewer (modal or
> dedicated page), and SHALL stop tailing when the viewer is closed. This
> prevents unnecessary I/O and bandwidth for idle worker logs.

## Implementation

### `src/gui/log-dir.ts`

A private `tailSingleFile(filePath, onEvent, signal, onSnapshotComplete?)`
helper was extracted and two new public functions were added:

- **`tailOrchestratorLog`** – tails only `.ralph/worker-logs/orchestrator.log`.
- **`tailWorkerLog(workerId, ...)`** – tails only
  `.ralph/worker-logs/worker-${id}.log`.

Both follow the same snapshot/live-stream contract as the original `tailLogDir`:
watcher is started before the initial replay to avoid missing writes in the gap,
a polling safety net fires every 200 ms, and the signal-aborted fast-path
prevents any async setup when the signal was already aborted before the call.

### `src/gui/server.tsx`

- **`/events`** now calls `tailOrchestratorLog` instead of `tailLogDir` — the
  default SSE stream is orchestrator-only.
- **`/events/worker/:id`** (new endpoint) calls `tailWorkerLog(workerId)`. The
  browser opens this connection only when a worker viewer is shown and the
  browser itself closes it when the component unmounts, which aborts the
  server-side tail via the `cancel()` hook of `ReadableStream`.
- A shared `makeSseStream()` helper de-duplicates the SSE-response construction
  for both routes.

### `src/gui/islands/worker-page-app.tsx`

`WorkerPageApp` now opens
`new EventSource("/events/worker/${encodeURIComponent(workerId)}")`. The
worker-ID filter (`if (logEv.workerId === workerId)`) was removed — the stream
is already scoped server-side.

### `src/gui/islands/worker-modal.tsx`

The modal no longer reads from the shared `getWorkerLogBuffer()` (populated by
the main `/events` stream). Instead, it opens its own `EventSource` to
`/events/worker/${encodeURIComponent(scenario)}` in a `useEffect` keyed on
`selected?.scenario`. Cleanup (returning from `useEffect`) calls `es.close()`,
which closes the SSE connection and stops the server-side `tailWorkerLog` via
the stream's `cancel()` callback. When no worker is selected the connection is
never opened; when the modal is dismissed the connection is closed.

## Evidence

| File                                  | Change                                                         |
| ------------------------------------- | -------------------------------------------------------------- |
| `src/gui/log-dir.ts`                  | `tailOrchestratorLog`, `tailWorkerLog`, `tailSingleFile` added |
| `src/gui/server.tsx`                  | `/events` → orchestrator-only; `/events/worker/:id` added      |
| `src/gui/islands/worker-page-app.tsx` | Uses `/events/worker/:id`, no client-side filter               |
| `src/gui/islands/worker-modal.tsx`    | Own SSE connection; open on show, close on dismiss             |
| `src/gui/log-dir.test.ts`             | 4 new unit/integration tests for the log-dir functions         |
| `src/gui/server.test.ts`              | 3 new endpoint tests for `/events` and `/events/worker/:id`    |

## Tests

**`src/gui/log-dir.test.ts`** (4 tests):

- `tailOrchestratorLog` receives orchestrator events and ignores worker log
  files.
- `tailWorkerLog` receives only the targeted worker's events and ignores others.
- `tailWorkerLog` replays existing (historical) content on connect.
- `tailOrchestratorLog` resolves promptly when signal is aborted.

**`src/gui/server.test.ts`** (3 new tests):

- `GET /events` returns `Content-Type: text/event-stream`.
- `GET /events/worker/:id` returns `Content-Type: text/event-stream`.
- URL-encoded worker IDs are decoded correctly.

All 164 project tests pass; 3 pre-existing `publish.test.ts` failures are
unrelated (esbuild Node.js compat issue in this environment).
