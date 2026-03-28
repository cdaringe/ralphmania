<!-- END_DEMO -->

# Progress

| #       | Status   | Summary                                                                                                                       | Rework Notes |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ |
| ARCH.1  | VERIFIED | [Hexagonal architecture via ports/adapters; pure domain, injectable deps](docs/scenarios/ARCH.1-hexagonal-architecture.md)    |              |
| ARCH.3  | VERIFIED | [Three FSMs govern orchestrator, worker, and scenario lifecycle via tagged states](docs/scenarios/ARCH.3-state-machines.md)   |              |
| ARCH.4  | VERIFIED | [Checkpoint + escalation persistence restores valid state on crash or restart](docs/scenarios/ARCH.4-recovery.md)             |              |
| ARCH.2  | VERIFIED | [Pipeline architecture with domain-module offloading](docs/scenarios/ARCH.2-pipeline-architecture.md)                         |              |
| ARCH.2a | VERIFIED | [Domain-specific folder organization reduces src/ noise](docs/scenarios/ARCH.2a-domain-folders.md)                            |              |
| 1       | VERIFIED | [Interactive prompting for missing agent/iterations input](docs/scenarios/01-interactive-prompting.md)                        |              |
| 2       | VERIFIED | [CLI accepts --agent/-a, --iterations/-i, --plugin/-p flags](docs/scenarios/02-cli-flags.md)                                  |              |
| 3       | VERIFIED | [Startup banner shows agent, iterations, model ladder](docs/scenarios/03-startup-banner.md)                                   |              |
| 4       | VERIFIED | [Agentic loop runs N iterations, stops early on completion](docs/scenarios/04-agentic-loop.md)                                |              |
| 5       | VERIFIED | [SIGINT graceful: first aborts, second force-exits 130](docs/scenarios/05-sigint-graceful-shutdown.md)                        |              |
| 6       | VERIFIED | [Auto-create specification.validate.sh with placeholder, halt until filled](docs/scenarios/06-validation-hook-auto-create.md) |              |
| 7       | VERIFIED | [Run validation script, capture log, feed failure context back](docs/scenarios/07-validation-run-and-feedback.md)             |              |
| 8       | VERIFIED | [NEEDS_REWORK detection and per-scenario model escalation](docs/scenarios/08-rework-escalation.md)                            |              |
| 9       | VERIFIED | [Agent scoped to failing scenario during escalation](docs/scenarios/09-scope-to-failing-scenario.md)                          |              |
| 10      | VERIFIED | [Agent self-reviews all claims, marks VERIFIED or NEEDS_REWORK](docs/scenarios/10-self-review-verification.md)                |              |
| 11      | VERIFIED | [Evidence receipts generated in .ralph/receipts/ on completion](docs/scenarios/11-receipts.md)                                |              |
| 12      | VERIFIED | [User-provided plugins with 7 lifecycle hooks](docs/scenarios/12-plugins.md)                                                  |              |
| 13      | VERIFIED | [Each iteration capped at 60 minutes via AbortSignal.timeout](docs/scenarios/13-iteration-timeout.md)                         |              |
| 14      | VERIFIED | [Subprocesses run with CI=true, no prompts, stdin null](docs/scenarios/14-non-interactive-environment.md)                     |              |
| 15      | VERIFIED | [First boot generates progress.md template](docs/scenarios/15-first-boot-progress-generation.md)                              |              |
| 16      | VERIFIED | [Logger prefixes all output with [ralph:...] tag](docs/scenarios/16-logger-ralphmania-prefix.md)                              |              |
| 17      | VERIFIED | [Validation logs stripped of ANSI color codes](docs/scenarios/17-strip-color-codes-from-logs.md)                              |              |
| 18      | VERIFIED | [Model-selection log reports progress status](docs/scenarios/18-model-selection-progress-status.md)                           |              |
| 19      | VERIFIED | [Claude 4-step escalation ladder via CLAUDE_CODE_EFFORT_LEVEL](docs/scenarios/19-claude-escalation-ladder.md)                 |              |
| 20      | VERIFIED | [Validation tmp output file via RALPH_OUTPUT_FILE](docs/scenarios/20-validation-tmp-output-file.md)                           |              |
| 21      | VERIFIED | [serve receipts command with --open flag](docs/scenarios/21-serve-receipts.md)                                                |              |
| 22      | VERIFIED | [Workstream state serializable via .ralph/loop-state.json checkpoint](docs/scenarios/22-state-serialization.md)               |              |
| 23      | VERIFIED | [Graceful merge conflict handling via agent reconciliation loop](docs/scenarios/23-merge-conflict-handling.md)                |              |
| 24      | VERIFIED | [All receipt markdown properly rendered via markdown-it](docs/scenarios/24-receipt-markdown-rendering.md)                     |              |
| 25      | VERIFIED | [OBSOLETE scenario support in completeness checks and task selection](docs/scenarios/25-obsolete-scenarios.md)                |              |
| 26      | VERIFIED | [Custom spec/progress paths via plugin onConfigResolved](docs/scenarios/26-custom-spec-progress-paths.md)                     |              |
| 27      | VERIFIED | [Parent prescribes distinct scenario per parallel worker](docs/scenarios/27-parallel-worker-scenario-prescription.md)         |              |
| 28      | VERIFIED | [Valid progress statuses with enforcement](docs/scenarios/28-valid-progress-statuses.md)                                      |              |
| 29      | VERIFIED | [100% test coverage enforcement](docs/scenarios/29-test-coverage-enforcement.md)                                              |              |
| 30      | VERIFIED | [Strict Deno lint enforcement as quality gate](docs/scenarios/30-lint-enforcement.md)                                         |              |
| 32      | VERIFIED | [Non-zero exit code when iterations exhausted without completion](docs/scenarios/32-non-zero-exit-on-incomplete.md)           |              |
| 33      | VERIFIED | [Worker stdio per-line colored prefix for terminal output](docs/scenarios/33-worker-stdio-prefix.md)                          |              |
| GUI.a   | VERIFIED | [Realtime interactive web GUI via SSE](docs/scenarios/GUI.a-interactive-web-gui.md)                                          |              |
| GUI.b   | VERIFIED | [Overall status page showing spec/progress set differences at /status](docs/scenarios/GUI.b-status-diff.md)                   |              |
| GUI.c   | VERIFIED | [Dedicated worker page at /worker/:id showing task, state, and stream](docs/scenarios/GUI.c-worker-page.md)                   |              |
