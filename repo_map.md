# Repo Map

> Ralphmania: AI agent orchestrator running a specification through parallel
> workers, validation, and escalation.

## Architecture

See @ARCHITECTURE.md for full system diagram. Key concepts:

- **Orchestrator** (`src/orchestrator.ts`) drives `runParallelLoop` via
  `src/machines/state-machine.ts`
- **State Machine** (`src/machines/state-machine.ts`):
  `init → reading_progress → finding_actionable → running_workers → validating → checking_doneness → done`
- **Workers** (`src/machines/worker-machine.ts`):
  `resolving_model → model_resolved → prompt_built → command_built → running_agent → done`
- **Scenario Machine** (`src/machines/scenario-machine.ts`): scenario lifecycle
  FSM (`unimplemented → wip → work_complete → verified/obsolete`)
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

## Scenarios Index

See `docs/scenarios/` for all scenario write-ups. Scenario status tracked in
`progress.md`.

Notable implementations:

- ARCH.1: Hexagonal arch via ports (`MachineDeps`, `AgentRunDeps`,
  `ValidationHookDeps`, `ModelIODeps`, `ProgressFileDeps`) + pure domain modules
  in `src/machines/`, `src/parsers/`, `src/model.ts`, `src/command.ts` + adapters
  wired by `orchestrator.ts`. Structural enforcement in `test/arch_1_test.ts`
  (Deno-call purity checks + port shape + in-memory adapter). In-memory fakes in
  `test/fixtures.ts` (`stubDeps`, `createProgressStore`).
- ARCH.2: `src/model.ts` owns all derivations — `orderActionableScenarios`
  (rework-first ordering) and `computeEffectiveLevel` (escalation merge);
  pipeline stages in `src/machines/state-machine.ts` are thin orchestrators only
- ARCH.2a: domain subfolders — `src/machines/` (3 state machines), `src/git/`
  (worktree + reconcile), `src/parsers/` (parsers)
- Scenario 33: `src/runner.ts` `workerPrefix`/`linePrefixTransform` — per-line
  colored terminal prefix
- Scenario 27: parallel workers prescribed distinct scenarios by orchestrator
- Scenario 22: `src/state.ts` checkpoint serialization
  (`.ralph/loop-state.json`)
- Scenario 8/19: escalation ladder in `src/model.ts` + `.ralph/escalation.json`
