# Repo Map

> Ralphmania: AI agent orchestrator running a specification through parallel
> workers, validation, and escalation.

## Architecture

See @ARCHITECTURE.md for full system diagram. Key concepts:

- **Orchestrator** (`src/orchestrator.ts`) drives `runParallelLoop` via
  `state-machine.ts`
- **State Machine** (`src/state-machine.ts`):
  `init → reading_progress → finding_actionable → running_workers → validating → checking_doneness → done`
- **Workers** (`src/worker-machine.ts`):
  `resolving_model → model_resolved → prompt_built → command_built → running_agent → done`
- **Runner** (`src/runner.ts`): `executeAgent` spawns agent subprocess;
  `pipeStream` handles I/O; `linePrefixTransform`/`workerPrefix` add per-worker
  terminal prefix (scenario 33)
- **Validation** (`src/validation.ts`): runs `specification.validate.sh`,
  captures logs to `.ralph/validation/`

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

- Scenario 33: `src/runner.ts` `workerPrefix`/`linePrefixTransform` — per-line
  colored terminal prefix
- Scenario 27: parallel workers prescribed distinct scenarios by orchestrator
- Scenario 22: `src/state.ts` checkpoint serialization
  (`.ralph/loop-state.json`)
- Scenario 8/19: escalation ladder in `src/model.ts` + `.ralph/escalation.json`
