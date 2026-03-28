# Scenario 31: Conflict-Aware Parallel Worker Dispatch

## Goal

When dispatching parallel workers, avoid assigning scenarios that are likely to
conflict (same Area/topic). Use scenario metadata (Area tags) to cluster related
scenarios and ensure at most one scenario per cluster is active per parallel
batch.

## Implementation

### Key Files

- **`src/orchestrator/cluster.ts`** — Pure clustering logic (all exported, no
  I/O)
- **`src/orchestrator/cluster.test.ts`** — Tests for all clustering functions
  (100% coverage)
- **`src/machines/state-machine.ts`** — Added `selectScenarioBatch` to
  `MachineDeps`
- **`src/orchestrator/mod.ts`** — Default `selectScenarioBatch` implementation
  using fast model

### Flow

1. **`transitionFindingActionable`** builds the full `uniqueActionable` list as
   before
2. After escalation state is updated, it calls
   `ctx.deps.selectScenarioBatch(...)` with all actionable scenario IDs
3. `selectScenarioBatch` clusters scenarios and returns at most one per conflict
   cluster, up to `parallelism`
4. The reduced batch is returned in `running_workers.uniqueActionable`
5. A log message is emitted when clustering reduces the batch size

### Clustering Functions (`src/orchestrator/cluster.ts`)

| Function                                                     | Purpose                                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `parseSpecAreas(specContent)`                                | Parses `\| # \| Area \| Scenario \|` table → `Map<id, area>`                           |
| `buildClusteringPrompt(ids, areaMap)`                        | Builds a structured JSON prompt for the fast model                                     |
| `parseClusteringResponse(text)`                              | Extracts `{"clusters":[...]}` from model response; tries whole text then embedded JSON |
| `clusterByArea(ids, areaMap)`                                | Pure area-based fallback; groups by Area, unknown → "Unknown"                          |
| `selectBatchFromClusters(clusters, orderedIds, parallelism)` | Picks one scenario per cluster in priority order, up to parallelism limit              |
| `clusterScenarios({...})`                                    | Main entry: tries fast model, falls back to area-based on failure/incomplete coverage  |

### Default Implementation (`src/orchestrator/mod.ts`)

The `defaultSelectScenarioBatch` function (wrapped in `/* c8 ignore */`):

1. Returns early if `parallelism <= 1` or `scenarioIds.length <= 1`
2. Reads the spec file (or `specification.md`) to extract Area data
3. Spawns `claude -p <prompt> --output-format json --model haiku` for fast
   clustering
4. Parses the JSON response; falls back to area-based clustering on any error
5. Calls `selectBatchFromClusters` to produce the final batch

### Conflict-Avoidance Logic

The model is prompted to return JSON clusters:

```json
{ "clusters": [{ "id": "AreaName", "scenarios": ["id1", "id2"] }] }
```

`selectBatchFromClusters` then picks the highest-priority scenario from each
cluster:

- Priority order comes from `orderedIds` (already sorted by NEEDS_REWORK first)
- At most one scenario per cluster per batch
- Batch size is capped at `parallelism`

### Test Coverage

All exported functions have unit tests in `src/orchestrator/cluster.test.ts`:

- `parseSpecAreas`: table parsing, separator rows, missing areas,
  table-then-text
- `buildClusteringPrompt`: contains IDs, areas, JSON format instruction
- `parseClusteringResponse`: valid JSON, embedded JSON, invalid, null cases,
  non-array scenarios
- `clusterByArea`: grouping, Unknown fallback, empty input
- `selectBatchFromClusters`: one-per-cluster, parallelism limit, priority
  ordering, orphan handling
- `clusterScenarios`: fast model success, incomplete coverage fallback, error
  fallback (Error and non-Error rejections), 0/1 scenario edge cases

State machine tests in `src/machines/state-machine.test.ts`:

- `selectScenarioBatch is called and filters batch` — verifies integration via
  custom mock
- `clustering reduces parallel batch to one per cluster` — verifies batch
  reduction path
