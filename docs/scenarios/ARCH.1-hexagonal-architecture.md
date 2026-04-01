# ARCH.1 — Hexagonal architecture via explicit ports/contracts

Scenario intent: make the port/adapter boundary obvious from file layout, not
just behavior.

## What changed

- Port contracts are centralized in `src/ports/types.ts`: `MachineDeps`,
  `AgentRunDeps`, `ModelIODeps`, `ProgressFileDeps`, `ValidationHookDeps`,
  `LoggerOutput`.
- Default Deno adapters are centralized in `src/ports/impl.ts`:
  `defaultModelIODeps`, `defaultProgressFileDeps`, `defaultValidationHookDeps`,
  `defaultLoggerOutput`.
- Domain/feature modules now import port contracts and implementations instead
  of declaring them inline: `src/machines/state-machine.ts`,
  `src/machines/worker-machine.ts`, `src/model.ts`, `src/progress.ts`,
  `src/validation.ts`, `src/logger.ts`.

This satisfies the rework note requirement: type contracts are in one file,
adapter implementations are in `ports/impl.ts`.

## Verification evidence

- Structural tests: `test/arch_1_test.ts`
  - Purity checks (no raw `Deno.*` in domain code outside c8 wiring blocks)
  - Contract centralization check (`src/ports/types.ts`)
  - No duplicate inline contract declarations in domain modules
- Integration test: `ARCH.1 [integration]` in `test/arch_1_test.ts`
  - `runParallelLoop` executes via injected `MachineDeps` (no default adapter
    dependency)
- E2E adapter test: `ARCH.1 [e2e]` in `test/arch_1_test.ts`
  - Real filesystem round-trip via `defaultProgressFileDeps` +
    `ensureProgressFile`
- Regression coverage still passing: `test/progress_test.ts`,
  `test/model_test.ts`, `test/orchestrator_test.ts`,
  `test/orchestrator_integration_test.ts`
