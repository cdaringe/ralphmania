# TUI.1 — Terminal UI with Live Status Bar and Worker Stream Filtering

## Scenario

> The CLI SHALL act as a TUI, with a bottom status bar showing the current
> orchestrator phase, the count of child workers, and total progress. Workers
> menu SHALL show worker state, and the ability to show only that workers output
> stream.

## Implementation

### Architecture

Two new modules under `src/tui/`:

| Module                  | Role                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| `src/tui/status-bar.ts` | Pure state machine + renderer — no I/O, fully unit-testable        |
| `src/tui/mod.ts`        | TUI orchestrator — subscribes to event bus, wraps stdout, keyboard |

### Status Bar

The TUI renders a 3-line status bar at the bottom of the terminal after every
log write:

```
─────────────────────────────────────────────────────────────────────────────
 Phase: running_workers  │  Workers: 2  │  Progress: 15/45 verified
 [w0/s5] [w1/s12]  │  0-9=filter worker
```

ANSI cursor sequences (`ansi.cursorUp(1).eraseLine.cursorLeft` from
`@cliffy/ansi`) erase the previous bar before each new log line lands, then
redraw it below. This keeps the bar "sticky" at the bottom as content scrolls.

### State Tracking

`TuiState` is a plain immutable object updated via pure reducers:

```typescript
type TuiState = {
  phase: string;                              // orchestrator FSM state
  workers: ReadonlyMap<number, { scenario }>;  // active workers
  verified: number;                           // VERIFIED scenario count
  total: number;                              // total spec scenario count
  selectedWorker: number | null;              // null = all, N = filter
};
```

`applyGuiEvent(state, event)` handles `state`, `worker_active`, and
`worker_done` events from the **same `GuiEventBus`** used by the web GUI — no
new event types or bus plumbing required.

### Worker Stream Filtering

Pressing `1`–`9` on the keyboard filters stdout to show only that worker's
output; `0` clears the filter. The stdin is read in raw mode (so individual
key presses register without Enter). Raw mode is enabled only after the
interactive prompts complete (no interference with `parseCliArgsInteractive`).

`shouldShowLine(line, selectedWorker)` strips ANSI codes then:

- Passes all lines when `selectedWorker === null`.
- Always passes `[ralph:…]` structured log lines.
- Passes worker lines (`[wN/s…]`) only if `N === selectedWorker`.
- Suppresses all other worker-prefixed lines.
- Passes unknown/unclassified lines.

### Mutable Logger Output Bridge

`mod.ts` uses a thin `mutableOutput` wrapper around `LoggerOutput`:

```typescript
let currentOutput = defaultLoggerOutput;
const mutableOutput = {
  writeSync: (d) => currentOutput.writeSync(d),
  writeErrSync: (d) => currentOutput.writeErrSync(d),
};
let log = createLogger(mutableOutput);
log = createGuiLogger(log, bus); // always wired — both TUI + GUI use bus
```

When the TUI is created (after the spec file is read so `total` is known),
`currentOutput` is swapped to `tui.loggerOutput`. All subsequent logger writes
go through the TUI's status-bar management without recreating the logger chain.

### Activation Conditions

The TUI is enabled when:

- `Deno.stdout.isTerminal()` is `true` (real terminal, not piped CI output)
- `--gui` flag is **not** set (prevents overlap with the web GUI)

When inactive (CI/CD, piped, or `--gui` mode) the logger falls back to plain
`defaultLoggerOutput` — no TUI overhead.

### Progress Polling

Because the `GuiEventBus` has no VERIFIED-count event, `mod.ts` starts a
`setInterval` (4 s) that reads `progress.md`, counts VERIFIED rows, and calls
`tui.setVerified(n)`. The TUI shows the live count in the status bar.

### Event Bus Refactor

Previously `createEventBus()` was created only inside the `if (gui)` branch.
It is now always created so both the web GUI and the TUI can share the same bus.
`createGuiLogger(log, bus)` is also always applied — it's a cheap wrapper with
no side-effects unless something subscribes to `bus`.

## Evidence

### Key files

- `src/tui/status-bar.ts` — `TuiState`, `initialTuiState`, `applyGuiEvent`,
  `withVerifiedCount`, `withSelectedWorker`, `renderStatusBar`, `shouldShowLine`
- `src/tui/mod.ts` — `TuiIO`, `TuiController`, `createTui`; `defaultTuiIO`
  marked `/* c8 ignore */` (thin Deno wrappers)
- `mod.ts` — mutableOutput bridge, always-on bus, TUI setup after spec read,
  progress poll interval, cleanup in `finally`

### Tests — `test/tui_test.ts` (31 tests, all passing)

| Group                             | Tests |
| --------------------------------- | ----- |
| `initialTuiState`                 | 1     |
| `applyGuiEvent`                   | 5     |
| `withVerifiedCount/SelectedWorker`| 2     |
| `renderStatusBar`                 | 8     |
| `shouldShowLine`                  | 6     |
| `createTui` (DI integration)      | 9     |

Key integration tests via `TuiIO` injection:

- `loggerOutput writes content to stdout` — confirms write-through
- `loggerOutput draws status bar after each write` — confirms bar rendered
- `setVerified updates the verified count shown in status bar` — confirms poll contract
- `reflects event bus worker_active in next render` — confirms bus subscription
- `reflects event bus state transition in next render` — confirms phase tracking
- `cleanup erases status bar` — confirms terminal restoration
- `startKeyboardHandler returns a promise` — confirms async contract

Invocation: `deno run -A mod.ts --iterations 10 --agent claude` (TTY required;
status bar auto-activates when not using `--gui`).
