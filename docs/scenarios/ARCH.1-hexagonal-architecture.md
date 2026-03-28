# ARCH.1 — Hexagonal Architecture Adherence

## Scenario

> The system SHALL attempt to be adherent to hexagonal architecture.

## Implementation

Hexagonal architecture separates the core domain (pure logic) from
infrastructure concerns (filesystem, subprocesses, HTTP) via **ports**
(interfaces) and **adapters** (concrete implementations). The system achieves
this through three design layers:

---

### Layer 1: Pure Domain Logic

State machines and transformation functions are pure — no I/O, fully testable in
isolation:

| Module                              | Role                                         |
| ----------------------------------- | -------------------------------------------- |
| `src/machines/state-machine.ts`     | Orchestrator FSM — pure transition functions |
| `src/machines/worker-machine.ts`    | Worker pipeline FSM — pure transitions       |
| `src/machines/scenario-machine.ts`  | Scenario lifecycle state machine             |
| `src/model.ts`                      | Escalation logic, model selection            |
| `src/command.ts`                    | Prompt and command building                  |
| `src/exit.ts`                       | Exit code computation                        |
| `src/parsers/progress-rows.ts`      | Markdown table parsing                       |
| `src/set-fns.ts`                    | Pure set operations                          |

---

### Layer 2: Ports (Injectable Interfaces)

Every external concern is abstracted behind a typed interface that can be
swapped in tests:

| Port                 | Defined In                      | Abstracts                                                 |
| -------------------- | ------------------------------- | --------------------------------------------------------- |
| `MachineDeps`        | `src/machines/state-machine.ts` | All I/O for the orchestrator (fs, git, agent, validation) |
| `AgentRunDeps`       | `src/machines/worker-machine.ts`| Agent subprocess execution                                |
| `ReconcileDeps`      | `src/git/reconcile.ts`          | Git subprocess + agent spawning                           |
| `ValidationHookDeps` | `src/validation.ts`             | Filesystem for validation hook setup                      |
| `ModelIODeps`        | `src/model.ts`                  | Escalation state file persistence                         |
| `ProgressFileDeps`   | `src/progress.ts`               | Progress/spec file read, write, stat                      |
| `Plugin`             | `src/plugin.ts`                 | Observer hooks at every lifecycle stage                   |
| `LoggerOutput`       | `src/logger.ts`                 | stdout/stderr output                                      |

**Key evidence — `ProgressFileDeps`:**

```typescript
// src/progress.ts
export type ProgressFileDeps = {
  readonly readTextFile: (path: string) => Promise<string>;
  readonly writeTextFile: (path: string, content: string) => Promise<void>;
  /** Resolves if file exists, rejects if not. Return value is unused. */
  readonly stat: (path: string) => Promise<unknown>;
};
```

`ensureProgressFile` accepts an injected `ProgressFileDeps` (defaulting to
Deno) instead of calling `Deno.*` directly:

```typescript
export const ensureProgressFile = async (
  log: Logger,
  paths: FilePaths = DEFAULT_FILE_PATHS,
  io: ProgressFileDeps = defaultProgressFileDeps,
): Promise<void> => { ... };
```

---

### Layer 3: Adapters (Infrastructure)

Concrete implementations live in infrastructure modules, wired up by
`orchestrator.ts` into `MachineDeps`. Direct Deno calls are confined to adapter
code, wrapped in `/* c8 ignore */` blocks to mark them as wiring:

| Adapter                  | Infrastructure                      |
| ------------------------ | ----------------------------------- |
| `src/git/worktree.ts`    | Git subprocess operations           |
| `src/git/reconcile.ts`   | Merge-conflict reconciliation       |
| `src/runner.ts`          | Agent subprocess execution          |
| `src/validation.ts`      | Bash validation script execution    |
| `src/state.ts`           | Loop checkpoint JSON persistence    |
| `src/serve.ts`           | HTTP static file server             |
| `src/cli.ts`             | CLI parsing and interactive prompts |

Default Deno wiring in adapters uses the `/* c8 ignore start/stop */` pattern:

```typescript
/* c8 ignore start — thin Deno I/O wiring */
const defaultProgressFileDeps: ProgressFileDeps = {
  readTextFile: (path) => Deno.readTextFile(path),
  writeTextFile: (path, content) => Deno.writeTextFile(path, content),
  stat: (path) => Deno.stat(path),
};
/* c8 ignore stop */
```

---

## Test Evidence

### Structural tests (`test/arch_1_test.ts`)

12 tests enforce the port/adapter boundary at the source level:

1. **10 module purity tests** — read each pure-domain source file, strip
   `c8 ignore start/stop` blocks, then assert no remaining `Deno.*` calls:
   - `src/machines/state-machine.ts`
   - `src/machines/worker-machine.ts`
   - `src/machines/scenario-machine.ts`
   - `src/command.ts`, `src/exit.ts`, `src/parsers/progress-rows.ts`, `src/set-fns.ts`
   - `src/model.ts`, `src/progress.ts`, `src/orchestrator.ts` (wiring confined)

2. **Port shape test** — `stubDeps()` satisfies all 14 keys of `MachineDeps` at
   runtime, verifying the port contract is fully injectable.

3. **In-memory adapter test** — `ensureProgressFile` runs end-to-end against a
   plain JS object (no real `Deno.*`) proving the port is truly swappable.

### Functional tests (`test/progress_test.ts`)

4 in-memory tests tagged `[ARCH.1]` exercise `ensureProgressFile` with an
in-memory `ProgressFileDeps` (no filesystem, no Deno calls).

### Orchestrator + state machine tests

`test/orchestrator_test.ts` and `test/state_machine_test.ts` run the full state
machine via `stubDeps` — zero real I/O, confirming the orchestrator domain is
fully decoupled from infrastructure.

---

## Architecture Consistency

The `ARCHITECTURE.md` plugin diagram and file map document the port/adapter
boundaries. The `test/fixtures.ts` provides `stubDeps`, `makeCtx`, and
`integrationDeps` factories for injecting in-memory adapters across all state
machine tests.
