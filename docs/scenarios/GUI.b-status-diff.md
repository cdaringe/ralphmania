# GUI.b — Overall Status with Set Differences

## Requirement

The GUI SHALL display overall status, showing the set differences between the
specifications and the progress.

## Implementation

### Core logic: `src/status-diff.ts`

Two pure, fully-tested functions:

**`computeStatusDiff(specIds, progressRows): StatusDiff`**

Computes three set-theoretic partitions:

| Field          | Meaning                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| `specOnly`     | IDs in `specification.md` but absent from `progress.md` (not yet started)    |
| `progressOnly` | IDs in `progress.md` but absent from `specification.md` (orphaned / removed) |
| `shared`       | IDs in both; carries `status` and `summary` from progress                    |

**`generateStatusHtml(diff): string`**

Renders a self-contained HTML page showing:

- `N / total verified` summary line, with `· K orphaned` appended when orphaned
  entries exist
- A single table with all three partitions (shared, specOnly as `NOT_STARTED`,
  progressOnly as `ORPHANED`)
- Color-coded status cells via CSS classes (`verified`, `needs-rework`, `wip`,
  `work-complete`, `obsolete`, `not-started`, `orphaned`)

### HTTP endpoint: `src/serve.ts` — `/status` route

The existing `serveReceipts` server now handles `GET /status` dynamically:

1. Reads `specFile` + `progressFile` (defaults: `specification.md` /
   `progress.md`; overridable via `ServeOptions.specFile` and `.progressFile`)
2. Parses spec IDs with `parseScenarioIds` and progress rows with
   `parseProgressRows`
3. Computes diff via `computeStatusDiff` and renders via `generateStatusHtml`
4. Returns `200 text/html`; returns `500` with an error message if files are
   unreadable

The status page is accessible at `http://localhost:<port>/status` when running
`deno run -A mod.ts serve receipts`.

## Evidence

### Tests: `test/status_diff_test.ts` (10 tests, 100% coverage)

| Test                                        | Covers                                                |
| ------------------------------------------- | ----------------------------------------------------- |
| empty inputs                                | base case                                             |
| specIds only                                | specOnly branch (all IDs untracked)                   |
| progressRows only                           | progressOnly branch (all rows orphaned)               |
| fully shared set                            | shared branch, status/summary preservation            |
| mixed set                                   | all three partitions simultaneously                   |
| `generateStatusHtml` verified count         | summary line math                                     |
| `generateStatusHtml` NOT_STARTED rows       | specOnly rendering                                    |
| `generateStatusHtml` ORPHANED rows + note   | progressOnly rendering + `orphanedNote` truthy branch |
| `generateStatusHtml` no orphaned note       | `orphanedNote` falsy branch                           |
| `generateStatusHtml` NEEDS_REWORK CSS class | underscore→hyphen CSS class transform                 |

`src/status-diff.ts` reports **100% line and branch coverage**.

### Key design decisions

- **Pure functions only** in `src/status-diff.ts`: no I/O, fully unit-testable
- `serve.ts` (already coverage-ignored) handles all I/O for the HTTP endpoint
- `ServeOptions` extended non-breakingly: `specFile?` / `progressFile?` optional
  with defaults from `DEFAULT_FILE_PATHS`
- Status order in the table: shared (tracked) → specOnly (unstarted) →
  progressOnly (orphaned), matching the most-to-least-relevant priority for a
  reviewer
