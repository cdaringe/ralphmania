# GUI.0 — Visual Workflow Graph with Live Node Highlighting

## Scenario

> The workflow loops (the task graphs) SHALL be modelled and presented visually.
> Active nodes SHALL pulse. When workers are spawned, new nodes SHALL appear
> with edges pointing to the merge/validating state. Workers SHALL be drillable
> — clicking shows their streaming output and allows sending messages to them.

## Implementation

### Architecture

The graph is a **React Flow** application loaded via ESM (`esm.sh`) and mounted
into `#graph-root` inside the `#graph-panel` tab of the main GUI page.

```
src/gui/client/main-script.ts  — GRAPH_MODULE_SCRIPT (React Flow app as string)
src/gui/pages/main-page.tsx    — embeds the module as <script type="module">
src/gui/logger.ts              — detects orchestrator log patterns → emits GuiEvents
src/gui/events.ts              — GuiEventBus with merge_start/merge_done event types
```

### State Machine Graph (Static Topology)

`makeStaticNodes` / `makeStaticEdges` hardcode all eight orchestrator states:

| Node                 | Position                |
| -------------------- | ----------------------- |
| `init`               | top                     |
| `reading_progress`   | main loop               |
| `finding_actionable` | main loop               |
| `running_workers`    | main loop               |
| `validating`         | main loop               |
| `checking_doneness`  | main loop               |
| `done`               | terminal                |
| `aborted`            | terminal (right branch) |

The back-edge `checking_doneness → reading_progress` is drawn as a dashed purple
`smoothstep` curve to make the loop visible. The `reading_progress → aborted`
edge is a gray branch off to the right.

### Active Node Pulsing

`stateNodeStyle(state, activeState)` returns inline styles:

- **Active**: bright green (`#22c55e`), 2px border, `box-shadow` glow,
  `animation: pulse 1.5s ease-in-out infinite`
- **Visited** (index < active in `STATE_ORDER`): darker green (`#16a34a`)
- **Inactive**: gray with `opacity: 0.7`

The `@keyframes pulse` animation cycles box-shadow intensity to create the
pulsing effect.

### Dynamic Worker Nodes

When workers spawn (`worker_active` events arrive), `makeWorkerNodes` creates:

1. **Worker node** per worker — label `W{i} {scenario}`, pulsing green while
   running, amber while merging, solid green when done/merged
2. **Merge pseudo-node** — appears between workers and `validating`; shows amber
   pulse while any worker is merging
3. **Edges**: `running_workers → worker-{i}`, `worker-{i} → merge`,
   `merge → validating`

The direct `running_workers → validating` edge is hidden when workers exist,
replaced by the fan-out through worker nodes and the merge node.

### Event Wiring

The vanilla JS bridge (`window._onGraphEvent`) passes SSE events from the
`/events` stream to the React component:

| Event           | Effect                                               |
| --------------- | ---------------------------------------------------- |
| `state`         | `setActiveState(ev.to)` — highlights the target node |
| `worker_active` | Adds worker to map with `status: 'running'`          |
| `worker_done`   | Updates worker to `status: 'done'`                   |
| `merge_start`   | Updates worker to `status: 'merging'`                |
| `merge_done`    | Updates worker to `status: 'merged'`                 |

`createGuiLogger` in `src/gui/logger.ts` detects four log patterns:

```
"Merging worker N (scenarioId)"      → merge_start event
"Worker N merge: merged|conflict|no-changes"  → merge_done event
```

These patterns match exactly what `transitionRunningWorkers` logs in
`src/machines/state-machine.ts` (lines 595, 604, 627, 632).

### Worker Drill-in

Clicking a worker node calls `window._openWorkerModal(workerIndex, scenario)`,
which opens a modal with:

- Filtered log stream (lines prefixed `[W{i}]`)
- Textarea + Send button → `POST /input/{workerIndex}` → `AgentInputBus` → agent
  stdin

A "pop out" link navigates to `/worker/{id}` for a dedicated full-page view.

### SSE Snapshot Replay

Late-joining browsers receive the current state immediately: `createEventBus`
tracks `lastState` and `activeWorkers` and replays them via `bus.snapshot()` in
the SSE `start` handler of `src/gui/server.tsx`.

## Evidence

Key files:

- `src/gui/client/main-script.ts` — `GRAPH_MODULE_SCRIPT`: complete React Flow
  app with static nodes, edges, worker nodes, event subscriptions, animations
- `src/gui/logger.ts` — `createGuiLogger` detects state transitions, worker
  launches, worker completions, merge start/done
- `src/gui/events.ts` — `GuiMergeStartEvent`, `GuiMergeDoneEvent` types;
  `createEventBus` with snapshot replay
- `src/machines/state-machine.ts:595,604,627,632` — logs matching merge patterns

Tests:

- `src/gui/client/main-script.test.ts` — 6 tests: all state nodes present,
  worker lifecycle events handled, pulse animation, worker drill-in, loop
  back-edge, dynamic merge node
- `src/gui/server.test.ts` — `GET /` includes `#graph-root`, `#graph-panel`, tab
  controls, `ReactFlow`, `running_workers`
- `src/gui/logger.test.ts` — 7 tests: log emit, state transition, worker_active
  (2 workers), worker_done, merge_start, merge_done, all merge outcomes
