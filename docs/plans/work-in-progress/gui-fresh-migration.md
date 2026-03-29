# GUI Fresh Migration — Resume Plan

## Status: In Progress

The GUI is being migrated from Hono + JS-in-strings to Fresh 2 with proper
TypeScript Islands.

## What's Done

### Server Migration (COMPLETE — 2026-03-29)

- `src/gui/server.tsx` — Replaced Hono with Fresh 2 `App` + `Deno.serve`
- Uses `preact-render-to-string` for SSR instead of Hono's `c.html()`
- `src/gui/html.ts` → `src/gui/html.tsx` (JSX support for `renderToString`)
- `deno.json` — Added `preact-render-to-string`, `preact/jsx-runtime` imports
- `src/gui/logger.test.ts` — Fixed pre-existing 3-arg call to 2-arg
  `createGuiLogger`
- All 653 tests pass (2 pre-existing worktree lint/fmt failures unrelated)

### Infrastructure (keep)

- `src/gui/log-dir.ts` — File-backed NDJSON log streaming (orchestrator + worker
  logs)
- `src/gui/events.ts` — GuiEvent types (log, state, worker_active, worker_done,
  merge_start, merge_done)
- `src/gui/logger.ts` — Logger that emits structured events to the in-memory
  event bus
- `src/gui/input-bus.ts` — Routes user input to worker subprocess stdin
- `mod.ts` wiring — bus subscriber writes orchestrator events to log files,
  `initLogDir()` on startup
- `src/runner.ts` — Worker output writes NDJSON to
  `.ralph/worker-logs/worker-N.log` via `writeWorkerLine`

### SSE Architecture (keep)

- SSE `/events` tails `.ralph/worker-logs/*.log` via `Deno.watchFs`
- `tailLogDir()` reads all existing content (replay), then watches for new data
  (live)
- Files are the sole source of truth for SSE delivery
- `initLogDir()` truncates all log files on startup

### Client-Side Behavior (must rewrite as Islands)

The React Flow graph, log panel, worker modal, and tab switching currently work
but are written as JavaScript inside TypeScript string literals
(`client/main-script.ts`, `client/worker-script.ts`). This is the code that must
be rewritten as proper Fresh Islands.

A key fix was made: events are buffered until the React Flow module subscribes
(race condition between SSE events arriving and React mounting).

### Browser E2E Tests (keep, update imports)

- `test/gui_browser_e2e_test.ts` — 12 Puppeteer tests that launch headless
  Chrome and verify graph rendering, state transitions, worker nodes, modal,
  tabs, sidebar, log panel
- Chrome installed at
  `~/.cache/puppeteer/chrome/linux-147.0.7727.24/chrome-linux64/chrome`

## What Needs To Happen

### 1. Switch from Hono to Fresh (DONE)

`deno.json` already has `@fresh/core` and `preact` in imports. The JSX import
source is already set to `preact`.

**Replace `src/gui/server.tsx`** (currently Hono):

```ts
import { App } from "@fresh/core";

const app = new App();
// Programmatic routes: GET /, GET /events, GET /worker/:id, POST /input/:workerId, etc.
// Use app.get(), app.post()
// SSE endpoint uses tailLogDir (already implemented in log-dir.ts)
// Page rendering uses Preact JSX (server-side)
await app.listen({ port });
```

Key API: `app.get()`, `app.post()`, `app.listen()`, `app.handler()`.

### 2. Create Fresh Islands (real TypeScript, compiled by Fresh/Vite)

Fresh Islands are Preact components in an `islands/` directory. They get
compiled to browser JS automatically — no strings.

**`src/gui/islands/workflow-graph.tsx`** — The main React Flow graph

- Uses `@xyflow/react` with `preact/compat` aliases (already in deno.json)
- Takes SSE events and updates node/edge state
- Nodes: init, reading_progress, finding_actionable, running_workers,
  validating, checking_doneness, done, aborted
- Dynamic worker nodes appear on worker_active, removed on state change
- Merge pseudo-node between workers and validating
- Click worker node → opens modal
- Pulse animation on active node

**`src/gui/islands/log-panel.tsx`** — Log panel tab

- Subscribes to SSE log events
- Filters by level (debug toggle)
- Auto-scroll

**`src/gui/islands/worker-modal.tsx`** — Worker drill-in modal

- Filters SSE log events by worker prefix `[WN]`
- Input textarea + send button (POST /input/:workerId)
- Pop-out link to /worker/:id

**`src/gui/islands/connection-status.tsx`** — SSE connection health

- Shows pulsing red dot when disconnected
- Green "live" badge when connected

### 3. Server-Side Components (no JS shipped)

**`src/gui/components/layout.tsx`** — HTML shell, `<head>`, CSS
**`src/gui/components/sidebar.tsx`** — Orchestrator state, progress list, worker
cards

### 4. Delete String-Based Code

Remove:

- `src/gui/client/main-script.ts` — JS strings
- `src/gui/client/worker-script.ts` — JS strings
- `src/gui/styles.ts` — CSS strings
- `src/gui/html.ts` — pre-rendered HTML exports
- `src/gui/pages/main-page.tsx` — Hono JSX page
- `src/gui/pages/worker-page.tsx` — Hono JSX page

### 5. preact/compat for React Flow

Already configured in `deno.json`:

```json
"react": "npm:preact@^10/compat",
"react-dom": "npm:preact@^10/compat",
"react-dom/": "npm:preact@^10/compat/"
```

Fresh may need a `vite.config.ts` or similar to ensure the aliases are respected
during island compilation. Check if `fsRoutes` or manual island registration is
needed.

### 6. Fresh Island Discovery

Fresh 2 uses `app.fsRoutes()` to discover routes and islands from the
filesystem. Need to verify this works with our embedded setup:

```ts
await app.fsRoutes(import.meta.url, {
  dir: "./routes",
  loadIsland: true,
  islandDir: "./islands",
});
```

Alternatively, if `fsRoutes` requires Vite, we may need to compile islands
manually with `esbuild` and serve as static JS. Test this.

### 7. Update Tests

- `test/gui_server_test.ts` — Update imports from Hono server to Fresh server
- `test/gui_graph_e2e_test.ts` — Keep HTML assertions, update if rendered output
  changes
- `test/gui_browser_e2e_test.ts` — Keep as-is (tests browser behavior, not
  implementation)
- `test/gui_status_e2e_test.ts` — Update server imports
- `src/gui/server.test.ts` — Update server imports

### 8. CSS

Move from string constants in `styles.ts` to either:

- A real `.css` file served by Fresh's static file handler
- Inline `<style>` blocks in the layout component (acceptable for small apps)
- Tailwind (Fresh has built-in Tailwind support)

## Key Risks

1. **preact/compat + @xyflow/react** — May have edge cases. Test the graph
   renders correctly in the browser.
2. **Fresh island compilation in embedded mode** — Fresh is designed as a
   standalone framework. Using it embedded in a CLI may require workarounds for
   the Vite build pipeline.
3. **SSE + Fresh** — The SSE endpoint uses `tailLogDir` which returns a raw
   `ReadableStream`. Fresh's route handlers should support returning raw
   `Response` objects.

## Architecture After Migration

```
mod.ts
  ↓ (if --gui)
  initLogDir()                    ← truncate log files
  bus.subscribe → writeOrchestratorEvent  ← bridge bus → file
  createGuiLogger(log, bus)       ← logger → bus
  startGuiServer({ port, ... })   ← Fresh App
    ↓
  GET /events  → tailLogDir()     ← SSE via file tailing
  GET /        → <MainPage />     ← SSR shell + Islands hydrate
  GET /worker/:id → <WorkerPage /> ← SSR + Island
  POST /input/:id → agentInputBus ← stdin routing

runner.ts
  ↓ (worker subprocess output)
  pipeStream({ onLine })
    ↓
  writeWorkerLine(idx, event)     ← NDJSON to worker log file
    ↓
  Deno.watchFs detects change
    ↓
  tailLogDir → SSE → browser
```
