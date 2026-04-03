# DOCSSITE.2 — Architecture & Workflow Visuals

## Requirement

The docs site SHALL include the architecture and clear visuals of each workflow
(orchestrator, agent, etc). It SHALL annotate visually when/where state changes
occur, when/where plugin lifecycle content gets invoked.

## Implementation

### Architecture page: `site/src/pages/architecture.tsx`

A new Preact page renders eight sections covering all workflows:

| Section               | Workflow covered                           | State annotations                                                     | Plugin annotations                                                     |
| --------------------- | ------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| System Overview       | End-to-end data flow                       | Orchestrator Loop node                                                | —                                                                      |
| Orchestrator Workflow | FSM: init → reading_progress → ... → done  | Every FSM state labelled `state change`                               | `onModelSelected`, `onValidationComplete`, `onLoopEnd`                 |
| Worker Pipeline       | FSM: resolving_model → ... → done          | Every FSM state labelled                                              | `onModelSelected`, `onPromptBuilt`, `onCommandBuilt`, `onIterationEnd` |
| Merge & Reconcile     | Merge queue + conflict resolution          | Decision/terminal variants                                            | —                                                                      |
| Model Escalation      | 2-level ladder table (Sonnet → Opus)       | —                                                                     | —                                                                      |
| Scenario Lifecycle    | UNIMPLEMENTED → WIP → ... → VERIFIED       | State change badges                                                   | —                                                                      |
| Plugin Lifecycle      | Linear hook sequence with timing labels    | `once, before loop` / `per worker` / `per round` / `once, after loop` | All 7 hooks                                                            |
| File Map              | Source directory table + data-flow diagram | —                                                                     | —                                                                      |

### Visual system: CSS flow diagrams

Custom CSS components in `site/src/styles.css`:

- `.flow-diagram` — vertical flex container with gray background
- `.flow-node` / `.flow-node--active` — box nodes, green-highlighted for states
- `.flow-node--decision` / `.flow-node--terminal` — variant shapes (dashed /
  rounded)
- `.flow-annotation` — small green badge indicating state change or plugin hook
- `.flow-arrow` / `.flow-arrow-label` — connecting arrows with optional labels
- `.flow-row` — horizontal grouping for parallel nodes

### Build integration

- `site/build.ts` registers `architecture.html` in the page list
- `site/src/layout.tsx` nav bar includes Architecture link on all pages

## Evidence

- Page renders all FSM states from `src/machines/state-machine.ts` and
  `src/machines/worker-machine.ts`
- Plugin hooks annotated on the exact workflow nodes where they fire
- State change annotations visible on every orchestrator and worker FSM node
- 16 new tests in `test/site_build_test.ts` verify content presence, section
  anchors, visual annotations, and nav links
- All 711 tests pass; `deno lint` and `deno check` clean
