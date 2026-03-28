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

| Module                         | Role                                         |
| ------------------------------ | -------------------------------------------- |
| `src/state-machine.ts`         | Orchestrator FSM — pure transition functions |
| `src/worker-machine.ts`        | Worker pipeline FSM — pure transitions       |
| `src/scenario-machine.ts`      | Scenario lifecycle state machine             |
| `src/model.ts`                 | Escalation logic, model selection            |
| `src/command.ts`               | Prompt and command building                  |
| `src/exit.ts`                  | Exit code computation                        |
| `src/parsers/progress-rows.ts` | Markdown table parsing                       |
| `src/set-fns.ts`               | Pure set operations                          |

---

### Layer 2: Ports (Injectable Interfaces)

Every external concern is abstracted behind a typed interface that can be
swapped in tests:

| Port                 | Defined In              | Abstracts                                                 |
| -------------------- | ----------------------- | --------------------------------------------------------- |
| `MachineDeps`        | `src/state-machine.ts`  | All I/O for the orchestrator (fs, git, agent, validation) |
| `AgentRunDeps`       | `src/worker-machine.ts` | Agent subprocess execution                                |
| `ReconcileDeps`      | `src/reconcile.ts`      | Git subprocess + agent spawning                           |
| `ValidationHookDeps` | `src/validation.ts`     | Filesystem for validation hook setup                      |
| `ModelIODeps`        | `src/model.ts`          | Escalation state file persistence                         |
| `ProgressFileDeps`   | `src/progress.ts`       | Progress/spec file read, write, stat                      |
| `Plugin`             | `src/plugin.ts`         | Observer hooks at every lifecycle stage                   |
| `LoggerOutput`       | `src/logger.ts`         | stdout/stderr output                                      |

**Key evidence — `ProgressFileDeps` (added in this scenario):**

```typescript
// src/progress.ts
export type ProgressFileDeps = {
  readonly readTextFile: (path: string) => Promise<string>;
  readonly writeTextFile: (path: string, content: string) => Promise<void>;
  readonly stat: (path: string) => Promise<unknown>;
};
```

`ensureProgressFile` now accepts an injected `ProgressFileDeps` (defaulting to
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

| Adapter             | Infrastructure                      |
| ------------------- | ----------------------------------- |
| `src/worktree.ts`   | Git subprocess operations           |
| `src/runner.ts`     | Agent subprocess execution          |
| `src/validation.ts` | Bash validation script execution    |
| `src/state.ts`      | Loop checkpoint JSON persistence    |
| `src/serve.ts`      | HTTP static file server             |
| `src/cli.ts`        | CLI parsing and interactive prompts |

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

`test/progress_test.ts` demonstrates the hexagonal port with 4 in-memory tests
(no filesystem, no Deno calls):

```
[ARCH.1] ensureProgressFile creates template via in-memory fs
[ARCH.1] ensureProgressFile syncs new rows via in-memory fs
[ARCH.1] ensureProgressFile no-ops when spec has equal rows via in-memory fs
[ARCH.1] ensureProgressFile defaults to 10 rows with missing spec via in-memory fs
```

The orchestrator is tested the same way via `stubDeps` in
`test/orchestrator_test.ts` — the state machine never touches real I/O.

---

## Architecture Consistency

The `ARCHITECTURE.md` plugin diagram and file map document the port/adapter
boundaries. The `test/fixtures.ts` provides `stubDeps` and `makeMemFS`-style
patterns for injecting in-memory adapters across all state machine tests.
