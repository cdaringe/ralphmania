# GUI.a — Interactive Web GUI with Realtime Updates

## Scenario

> The project's capabilities, states, and streams, SHALL be visible via an
> interactive web page with REALTIME updates as the workflow executes.

## Implementation

### Architecture

A three-module design under `src/gui/`:

| Module              | Role                                                     |
| ------------------- | -------------------------------------------------------- |
| `src/gui/events.ts` | Pure in-process event bus (`GuiEventBus`)                |
| `src/gui/logger.ts` | Logger wrapper that tees log calls → bus                 |
| `src/gui/html.ts`   | Embedded single-page HTML/JS application                 |
| `src/gui/server.ts` | HTTP server: serves HTML at `/`, SSE stream at `/events` |

### Realtime Delivery (SSE)

`startGuiServer` opens a `ReadableStream` per SSE client and subscribes to the
`GuiEventBus`. Each `GuiEvent` is serialised as `data: <json>\n\n` and pushed
directly to connected browsers. Auto-reconnect is handled on the client with
`EventSource` + a 3-second retry on error.

### Event Types

```typescript
type GuiEvent =
  | { type: "log"; level; tags; message; ts } // every logger call
  | { type: "state"; from; to; ts } // orchestrator transitions
  | { type: "worker_active"; workerIndex; scenario; ts }
  | { type: "worker_done"; workerIndex; ts };
```

All orchestrator state transitions and log output flow through `createGuiLogger`
(which wraps the normal logger and emits to the bus), so no changes to the state
machine itself were needed.

### CLI Integration

`--gui` flag added to `withRunOptions` in `src/cli.ts`; defaults to `false`.
`--gui-port` flag selects the port (default `8420`).

In `main()` in `mod.ts`:

```
if (gui) {
  const bus = createEventBus();
  log = createGuiLogger(log, bus);          // tee all logs to bus
  startGuiServer({ port, bus, signal });    // fire-and-forget
}
```

The GUI controller is aborted in a `try/finally` block so the server always
stops when the loop ends.

### Interactive Page

The embedded page (`src/gui/html.ts`) provides:

- **Live connection badge** — green "live" / red "disconnected"
- **Orchestrator state panel** — updates on every `state` event
- **Active Workers panel** — shows per-worker scenario parsed from log messages
  (`launching N worker(s) for scenarios [...]` / `resolved by worker N`);
  `worker_active`/`worker_done` structured events are defined and handled but
  worker tracking is driven by log parsing today
- **Live log panel** — color-coded by tag (`info`, `error`, `debug`,
  `orchestrator`, `validate`, `transition`), with auto-scroll and debug-toggle
  controls

## Evidence

Key files:

- `src/gui/events.ts` — `createEventBus()` with emit/subscribe/unsubscribe
- `src/gui/logger.ts` — `createGuiLogger()` wrapper
- `src/gui/server.ts` — `startGuiServer()` SSE + HTML server
- `src/gui/html.ts` — embedded SPA with `EventSource` connection to `/events`
- `test/gui_events_test.ts` — 6 tests: emit, multi-subscribe, unsubscribe,
  worker event types, double-unsubscribe no-op, no-subscriber emit
- `test/gui_logger_test.ts` — 7 tests: base delegation, bus emission, ordering,
  error level, state transition detection, non-transition no-state-event,
  combined log+state events
- `test/gui_server_test.ts` — 5 integration tests: HTML at `/`, fallback HTML,
  SSE content-type, SSE event delivery, HTML element assertions
- `test/cli_test.ts` — `--gui` defaults false, `--gui` enables, `--gui-port`
  default 8420, `--gui-port` custom value

Invocation: `deno run -A mod.ts --iterations 10 --gui --gui-port 8420`
