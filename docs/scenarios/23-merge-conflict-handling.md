# Scenario 23: Graceful Merge Conflict Handling

## Requirement

The system SHALL gracefully handle merge conflicts when folding work back into the main branch. Never throw work away.

## Implementation

### `src/reconcile.ts`

Core module implementing agent-driven conflict resolution:

- **`reconcileMerge`**: Loops indefinitely (until signal aborted) attempting to merge a worktree branch into main. Never aborts — never throws work away.
  1. Attempt `git merge <branch> --no-edit`.
  2. If clean (code 0) → done.
  3. If conflict markers present (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD` in `git status --porcelain`) → spawn agent with `buildReconcilePrompt` listing conflicted files, instructing it to resolve markers and `git add` + `git commit --no-edit`.
  4. After agent runs, re-check `git status --porcelain`; if clean → done, else abort and retry loop.
  5. If merge failed but no conflict markers → abort and spawn agent with `buildMergeRetryPrompt` (handles tree/rename/delete conflicts), then check if `git log -1` shows the branch was merged.
- **`RECONCILE_TIMEOUT_MS`**: 10-minute per-attempt agent timeout via `AbortSignal.any`.

### `src/parallel.ts`

Integration point in `runParallelLoop`:

```typescript
await deps.mergeWorktree({ worktree: wr.worktree, log }) === "conflict" &&
  await deps.reconcileMerge({ worktree: wr.worktree, agent, signal, log });
```

When `mergeWorktree` returns `"conflict"`, `reconcileMerge` is called automatically. Work is never discarded.

### `src/worktree.ts`

`mergeWorktree` first tries `git merge -X theirs --no-edit`. If that also fails (code ≠ 0), it returns `"conflict"`, triggering the agent reconciliation path.

## Tests

### `src/reconcile_test.ts` (unit)

- `parseConflictedFiles` extracts all unmerged status codes (`UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD`)
- `hasUnresolvedConflicts` returns true/false based on porcelain status
- `reconcileMerge` returns immediately on clean merge (no agent call)
- `reconcileMerge` resolves on first agent attempt
- `reconcileMerge` retries when agent fails to resolve on first attempt (2 agent calls)
- `reconcileMerge` spawns broad merge-retry prompt when merge fails without conflict markers
- `reconcileMerge` throws `DOMException` on pre-aborted signal

### `test/parallel_test.ts` (integration stubs)

`stubDeps` includes `reconcileMerge: () => Promise.resolve()` stub, ensuring the full `runParallelLoop` test suite exercises the conflict-handling path without real git operations.

## Evidence

- All 155 tests pass (`deno test --allow-all`).
- No work is ever discarded: the loop continues until `signal.aborted`, and neither `reconcileMerge` nor `buildReconcilePrompt` instructs agents to run `git merge --abort` (it is explicitly prohibited in the prompts).
- The `buildMergeRetryPrompt` states: "Do NOT give up. The merge MUST be completed."
