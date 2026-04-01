# GUI.0 — Live Workflow Graph with Worker Drill-In

## Scenario

> Model and present the workflow loop visually. Active nodes pulse; downstream
> nodes stay inactive. When workers spawn, new nodes appear with edges into the
> merge/validation path. Workers must be drillable to view streaming output and
> send messages.

## Implementation

- **Visualization stack**: `src/gui/pages/main-page.tsx` mounts the
  `WorkflowGraph` island alongside the log panel. `GRAPH_PANEL_CSS` defines the
  `pulse` keyframes used for live highlighting. Islands are compiled at startup
  by `startGuiServer` (`src/gui/server.tsx`) and loaded from `/islands/*.js`.
- **Event flow**: `createGuiLogger` (`src/gui/logger.ts`) tees every log into
  the `GuiEventBus`, emitting structured `state`, `worker_active/done`,
  `merge_start/done`, and `log` events. `mod.ts` subscribes the bus to
  `writeOrchestratorEvent` so events land in `.ralph/worker-logs/` and are
  tailed by `/events` SSE (`src/gui/log-dir.ts`, `src/gui/server.tsx`). On the
  client, `event-store.ts` consumes SSE, maintains orchestrator state + active
  workers, and feeds islands.
- **Graph behavior** (`src/gui/islands/workflow-graph.tsx`):
  - Static orchestrator nodes:
    `init → reading_progress → finding_actionable →
    running_workers → validating → checking_doneness → done`
    with an `aborted` branch and dashed loop-back edge. Active node pulses;
    visited nodes turn solid green; inactive nodes are muted gray.
  - Dynamic workers: `worker_active` events create `W{i} {scenario}` nodes that
    pulse while running, turn amber during `merge_start`, and settle green after
    `worker_done/merge_done`. Worker nodes fan out from `running_workers` into a
    `merge` node, which only appears once workers exist; the direct
    `running_workers → validating` edge is removed in that case to show the full
    merge loop.
  - **Drill-in**: clicking a worker node calls `setSelectedWorker`, opening
    `WorkerModal` (`src/gui/islands/worker-modal.tsx`). The modal replays worker
    log lines (buffered by `event-store.ts`), streams new ones, and posts user
    input to `/input/:workerId` where `AgentInputBus` delivers it to the live
    agent. Finished workers disable input and show an “inactive” badge. A “pop
    out” link goes to `/worker/:id`.
- **Late joiners**: `GuiEventBus.snapshot()` replays the latest state and active
  workers into new SSE connections so the graph starts in the correct state even
  mid-iteration.

## Evidence

- `src/gui/islands/workflow-graph.tsx` — React Flow graph with dynamic worker +
  merge nodes, pulse styling, worker-click handler.
- `src/gui/islands/event-store.ts` — SSE-backed store tracking orchestrator
  state, worker lifecycle, and modal selection.
- `src/gui/server.tsx` + `src/gui/log-dir.ts` — SSE over tailed
  `.ralph/worker-logs/*`, `/input/:workerId` input endpoint, island compilation.
- `test/gui_browser_e2e_test.ts` — browser tests validate node/edge rendering,
  pulsing active nodes, worker lifecycle (active→merge→done), modal input
  enabled/disabled, and sidebar/log updates.
- `test/gui_graph_e2e_test.ts` — ensures islands exist, graph includes all
  states, merge events flow through SSE, and logger emits merge events.
- `test/gui_logger_test.ts` — structured events for state transitions, worker
  launch/done, and merge start/done.
