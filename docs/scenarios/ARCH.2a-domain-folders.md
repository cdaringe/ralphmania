# ARCH.2a — Domain-Specific Folder Organization

**Scenario:** The system SHALL attempt to keep domain/category/topic specific
code nestled under domain specific folder to reduce the filesystem noise.

## How It Is Achieved

Five closely related source files were reorganized from the flat `src/` root
into two new domain subfolders, reducing the root entry count from 22 to 17:

### `src/machines/` — state machine domain

| File                  | Responsibility                                                   |
| --------------------- | ---------------------------------------------------------------- |
| `state-machine.ts`    | Orchestrator FSM (`init → … → done`)                             |
| `worker-machine.ts`   | Per-worker pipeline FSM (`resolving_model → … → done`)           |
| `scenario-machine.ts` | Scenario lifecycle FSM (`unimplemented → … → verified/obsolete`) |

All three files model state transitions and carry no I/O. Grouping them under
`machines/` makes the shared concept immediately visible.

### `src/git/` — git operations domain

| File           | Responsibility                              |
| -------------- | ------------------------------------------- |
| `worktree.ts`  | Create/merge/cleanup git worktrees          |
| `reconcile.ts` | Agent-driven merge-conflict resolution loop |

Both files wrap raw `git` subprocess calls. Separating them from the rest of the
codebase gives a clear boundary: everything under `src/git/` is about repository
manipulation.

### `src/parsers/` — already existed

`src/parsers/progress-rows.ts` was already grouped as a precedent for this
pattern. ARCH.2a extends and formalises it.

## Evidence

- **New files:** `src/machines/state-machine.ts`,
  `src/machines/worker-machine.ts`, `src/machines/scenario-machine.ts`,
  `src/git/worktree.ts`, `src/git/reconcile.ts`
- **Updated callers** (import paths only, no logic change):
  - `src/orchestrator.ts` — imports from `./machines/state-machine.ts`,
    `./git/worktree.ts`, `./git/reconcile.ts`
  - `src/runner.ts` — imports from `./machines/worker-machine.ts`
  - All corresponding test files in `test/`
- **Test:** `test/arch_2a_test.ts` — 4 assertions verifying each domain folder
  exists with the correct files and that root `src/` has ≤ 17 `.ts` files
- `deno check mod.ts` passes (all imports resolve)
- `deno task test` — 390 passed, 0 failed
