# Repo Map

> Ralphmania: AI agent orchestrator running a specification through parallel
> workers, validation, and escalation.

## Architecture

See @ARCHITECTURE.md for full system diagram. Key concepts:

- **Ports/Adapters (ARCH.1)**:
  - `src/ports/types.ts` = port contracts only (`MachineDeps`, `AgentRunDeps`,
    `ModelIODeps`, `ProgressFileDeps`, `ValidationHookDeps`, `LoggerOutput`)
  - `src/ports/impl.ts` = default Deno adapter implementations only
  - Domain modules consume these ports and keep logic pure: `src/machines/*.ts`,
    `src/model.ts`, `src/progress.ts`, `src/validation.ts`, `src/logger.ts`
- **Orchestrator** (`src/orchestrator/mod.ts`) drives `runParallelLoop` via
  `src/machines/state-machine.ts`; `src/orchestrator/escalation.ts` manages
  escalation state; `src/orchestrator/progress-queries.ts` provides progress
  file query functions
- **State Machine** (`src/machines/state-machine.ts`):
  `init → reading_progress → finding_actionable → running_workers → validating → checking_doneness → done`
- **Workers** (`src/machines/worker-machine.ts`):
  `resolving_model → model_resolved → prompt_built → command_built → running_agent → done`
- **Scenario Machine** (`src/machines/scenario-machine.ts`): scenario lifecycle
  FSM (`unimplemented → wip → work_complete → verified/obsolete`)
- **GUI** (`src/gui/`): realtime web UI — `events.ts` (pure event bus),
  `logger.ts` (Logger wrapper → bus), `server.tsx` (HTTP+SSE server + island
  compiler), `pages/main-page.tsx` (Fresh shell), and islands under
  `src/gui/islands/` (React/Preact client pieces). Activated via
  `--gui [--gui-port N]` flag. `createGuiLogger` wraps the main logger to tee
  log calls to the bus and emits explicit `state` events.
- **Runner** (`src/runner.ts`): `executeAgent` spawns agent subprocess;
  `pipeStream` handles I/O; `linePrefixTransform`/`workerPrefix` add per-worker
  terminal prefix (scenario 33)
- **Git ops** (`src/git/`): `worktree.ts` manages git worktrees; `reconcile.ts`
  drives agent-based merge-conflict resolution
- **Validation** (`src/validation.ts`): runs `specification.validate.sh`,
  captures logs to `.ralph/validation/`

### Domain folder layout (`src/`)

- `src/machines/` — all state machines (orchestrator, worker, scenario)
- `src/git/` — git subprocess operations (worktree, reconcile)
- `src/parsers/` — parsers (progress rows)
- `src/orchestrator/` — orchestrator loop, escalation state, progress queries
- `src/*.ts` root — cross-cutting: types, constants, model, plugin, cli, etc.

## Key Design Decisions

- **workerIndex threading**: flows from
  `transitionRunningWorkers → MachineDeps.runIteration → workerTransition → transitionRunningAgent → AgentRunDeps.execute`.
  Used only for building terminal stdio prefix.
- **Terminal-only prefixing**: `linePrefixTransform` applied in `executeAgent`
  path to `Deno.stdout`/`Deno.stderr` only. Disk writes via `validation.ts`'s
  `tee()` bypass it entirely.
- **set-fns.ts**: vendored utility; excluded from lint+coverage (user marked DO
  NOT CHANGE)
- **Coverage exclusions**: `scripts/check-coverage.ts` EXCLUDED_FILES; files
  with `// coverage:ignore` at top
- **Lint exclusions**: `deno.json` `lint.exclude` for vendored files

## GUI / Web Interface

- **`src/serve.ts`**: HTTP server (`serveReceipts`), used by `serve receipts`
  CLI command. Serves `.ralph/receipts/` as static site AND provides a dynamic
  `/status` endpoint.
- **`src/status-diff.ts`**: pure `computeStatusDiff` + `generateStatusHtml`;
  computes spec-vs-progress set differences (specOnly/progressOnly/shared) and
  renders a self-contained HTML status page. 100% test coverage in
  `test/status_diff_test.ts`.
- **GUI.b status in live GUI**: `gui/server.ts` accepts a `StatusProvider` DI
  function, serves `/api/status` (JSON) and `/status` (HTML). Main page
  (`gui/html.ts`) has a Progress sidebar that fetches `/api/status` on load and
  on every state/worker_done SSE event. E2E tests in
  `test/gui_status_e2e_test.ts` (10 tests, DI adapters, no real file I/O).
- **Workflow graph (GUI.0)**: `src/gui/pages/main-page.tsx` mounts
  React Flow graph island `src/gui/islands/workflow-graph.tsx` fed by
  `event-store.ts` SSE state. Dynamic worker nodes/merge node pulse with
  activity; clicking opens `worker-modal.tsx` (log replay + /input POST). SSE
  tails `.ralph/worker-logs/*` via `src/gui/log-dir.ts` and `server.tsx`.

## Scenarios Index

See `docs/scenarios/` for all scenario write-ups. Scenario status tracked in
`progress.md`.

Notable implementations:

- ARCH.1: contracts in `src/ports/types.ts`; default adapters in
  `src/ports/impl.ts`; domain modules import ports. Enforced by
  `test/arch_1_test.ts` (purity + contract/adapter split + integration + e2e).
- ARCH.2: `src/model.ts` owns all derivations — `orderActionableScenarios`
  (rework-first ordering) and `computeEffectiveLevel` (escalation merge);
  pipeline stages in `src/machines/state-machine.ts` are thin orchestrators only
- ARCH.2a: domain subfolders — `src/machines/` (3 state machines), `src/git/`
  (worktree + reconcile), `src/parsers/` (parsers)
- Scenario 33: `src/runner.ts` `workerPrefix`/`linePrefixTransform` — per-line
  colored terminal prefix
- Scenario 27: parallel workers prescribed distinct scenarios by orchestrator
- ARCH.4: recovery via `src/state.ts` checkpoint (`.ralph/loop-state.json`) +
  `src/model.ts` escalation state (`.ralph/escalation.json`) + `transitionInit`
  resume routing. See `docs/scenarios/ARCH.4-recovery.md`
- Scenario 22: `src/state.ts` checkpoint serialization
  (`.ralph/loop-state.json`)
- Scenario 8/19: escalation ladder in `src/model.ts` + `.ralph/escalation.json`

## Ops Quicklinks

- Spec: `specification.md`
- Progress: `progress.md`
- Architecture: `ARCHITECTURE.md`
- Runtime state dir: `.ralph/` (currently no `.ralph/*.md` docs in this branch)
- ARCH.1 details: `docs/scenarios/ARCH.1-hexagonal-architecture.md`
