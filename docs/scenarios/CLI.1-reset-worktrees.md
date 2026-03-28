# CLI.1 — `--reset-worktrees` flag

## Scenario

The CLI SHALL support a `--reset-worktrees` flag that clears out existing ralph
worker worktrees and any worktree state w.r.t. this the tool (ralphmania) on
boot.

## Implementation

### Flag (`src/cli.ts`)

`--reset-worktrees` (boolean, default `false`) is added to `withRunOptions`,
which applies it to both the root command and the `run` subcommand. It is
surfaced in `CliConfig.resetWorktrees` and propagated through both `toCliConfig`
and `parseCliArgsInteractive`.

### Reset logic (`src/git/worktree.ts` — `resetAllWorktrees`)

Called early in `main()` in `mod.ts`, before the plugin, banner, or loop, when
`resetWorktrees` is `true`. Four steps:

1. **Remove each worktree directory** — iterates `.ralph/worktrees/`, calling
   `git worktree remove --force <path>` for each subdirectory. If git removal
   fails (e.g. the path was already detached), falls back to `Deno.remove`.
2. **Prune stale git refs** — `git worktree prune` removes any dangling internal
   git refs left by removed worktrees.
3. **Delete local branches** — `git branch --list "ralph/worker-*"` finds all
   branches that were created by the orchestrator, then deletes each with
   `git branch -D`.
4. **Clear tool state files** — removes `.ralph/escalation.json` and
   `.ralph/loop-state.json` so the next run starts with a clean slate.

If `WORKTREE_BASE_DIR` does not exist the directory iteration catches the error
and continues silently (idempotent).

### Boot wiring (`mod.ts`)

```ts
if (resetWorktrees) {
  const resetResult = await resetAllWorktrees({ log });
  if (resetResult.isErr()) {
    log({ tags: ["error"], message: resetResult.error });
    return 1;
  }
}
```

Runs after the logger and CLI parse, before the plugin load and main loop.

## Tests

| File                    | Tests                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/cli_test.ts`      | `resetWorktrees defaults to false`, `--reset-worktrees sets resetWorktrees to true`                                                                                                                             |
| `test/worktree_test.ts` | `resetAllWorktrees clears worktrees and state files` (creates a real worktree, writes dummy state files, asserts both are gone after reset), `resetAllWorktrees succeeds when no worktrees exist` (idempotency) |

Both worktree tests guard with `git rev-parse --git-dir` and skip gracefully
outside a real repository (consistent with the existing worktree test pattern).
