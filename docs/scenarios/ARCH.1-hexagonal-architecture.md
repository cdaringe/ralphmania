# ARCH.1 — Hexagonal architecture via explicit ports/contracts

Intent: make the port/adapter boundary obvious from module conventions.

## Completion evidence

- Contracts are centralized in `src/ports/types.ts` only.
- Default Deno adapters are centralized in `src/ports/impl.ts` only.
- Domain modules no longer re-export port contracts:
  - `src/logger.ts`
  - `src/model.ts`
  - `src/progress.ts`
  - `src/validation.ts`
  - `src/machines/state-machine.ts`
  - `src/machines/worker-machine.ts`
- Downstream imports were updated to consume contracts directly from
  `src/ports/types.ts`:
  - `test/progress_test.ts`
  - `src/machines/state-machine.test.ts`
  - `test/fixtures.ts`

## Verification

- Structural + boundary checks: `test/arch_1_test.ts`
  - `ports/types` has contracts
  - `ports/impl` has Deno adapters
  - domain modules do not declare or re-export port contracts
  - no raw `Deno.*` in pure/domain modules
- Integration coverage: `ARCH.1 [integration]` test in `test/arch_1_test.ts`
  validates orchestrator execution against injected `MachineDeps`.
- E2E coverage: `ARCH.1 [e2e]` test in `test/arch_1_test.ts` validates real
  filesystem adapter round-trip through `defaultProgressFileDeps`.
