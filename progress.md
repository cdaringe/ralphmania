<!-- END_DEMO -->

# Progress

| #  | Status   | Summary                                                                                                                       | Rework Notes |
| -- | -------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1  | WORK_COMPLETE | [Interactive prompting for missing agent/iterations input](docs/scenarios/01-interactive-prompting.md)                        |              |
| 2  | WORK_COMPLETE | [CLI accepts --agent/-a, --iterations/-i, --plugin/-p flags](docs/scenarios/02-cli-flags.md)                                  |              |
| 3  | WORK_COMPLETE | [Startup banner shows agent, iterations, model ladder](docs/scenarios/03-startup-banner.md)                                   |              |
| 4  | WORK_COMPLETE | [Agentic loop runs N iterations, stops early on completion](docs/scenarios/04-agentic-loop.md)                                |              |
| 5  | WORK_COMPLETE | [SIGINT graceful: first aborts, second force-exits 130](docs/scenarios/05-sigint-graceful-shutdown.md)                        |              |
| 6  | WORK_COMPLETE | [Auto-create specification.validate.sh with placeholder, halt until filled](docs/scenarios/06-validation-hook-auto-create.md) |              |
| 7  | WORK_COMPLETE | [Run validation script, capture log, feed failure context back](docs/scenarios/07-validation-run-and-feedback.md)             |              |
| 8  | WORK_COMPLETE | [NEEDS_REWORK detection and per-scenario model escalation](docs/scenarios/08-rework-escalation.md)                            |              |
| 9  | WORK_COMPLETE | [Agent scoped to failing scenario during escalation](docs/scenarios/09-scope-to-failing-scenario.md)                          |              |
| 10 | WORK_COMPLETE | [Agent self-reviews all claims, marks COMPLETE or NEEDS_REWORK](docs/scenarios/10-self-review-verification.md)                |              |
| 11 | WORK_COMPLETE | [Evidence receipts generated in .ralph/receipts/ on completion](docs/scenarios/11-receipts.md)                                |              |
| 12 | WORK_COMPLETE | [User-provided plugins with 7 lifecycle hooks](docs/scenarios/12-plugins.md)                                                  |              |
| 13 | WORK_COMPLETE | [Each iteration capped at 60 minutes via AbortSignal.timeout](docs/scenarios/13-iteration-timeout.md)                         |              |
| 14 | WORK_COMPLETE | [Subprocesses run with CI=true, no prompts, stdin null](docs/scenarios/14-non-interactive-environment.md)                     |              |
| 15 | WORK_COMPLETE | [First boot generates progress.md template](docs/scenarios/15-first-boot-progress-generation.md)                              |              |
| 16 | WORK_COMPLETE | [Logger prefixes all output with [ralph:...] tag](docs/scenarios/16-logger-ralphmania-prefix.md)                              |              |
| 17 | WORK_COMPLETE | [Validation logs stripped of ANSI color codes](docs/scenarios/17-strip-color-codes-from-logs.md)                              |              |
| 18 | WORK_COMPLETE | [Model-selection log reports progress status](docs/scenarios/18-model-selection-progress-status.md)                           |              |
| 19 | WORK_COMPLETE | [Claude 4-step escalation ladder via CLAUDE_CODE_EFFORT_LEVEL](docs/scenarios/19-claude-escalation-ladder.md)                 |              |
| 20 | WORK_COMPLETE | [Validation tmp output file via RALPH_OUTPUT_FILE](docs/scenarios/20-validation-tmp-output-file.md)                           |              |
| 21 | WORK_COMPLETE | [serve receipts command with --open flag](docs/scenarios/21-serve-receipts.md)                                                |              |
| 22 | WORK_COMPLETE | [Workstream state serializable via .ralph/loop-state.json checkpoint](docs/scenarios/22-state-serialization.md)               |              |
| 23 | WORK_COMPLETE | [Graceful merge conflict handling via agent reconciliation loop](docs/scenarios/23-merge-conflict-handling.md)                |              |
| 24 | WORK_COMPLETE | [All receipt markdown properly rendered via markdown-it](docs/scenarios/24-receipt-markdown-rendering.md)                     |              |
| 25 | WORK_COMPLETE | [OBSOLETE scenario support in completeness checks and task selection](docs/scenarios/25-obsolete-scenarios.md)                |              |
| 26 | WORK_COMPLETE | [Custom spec/progress paths via plugin onConfigResolved](docs/scenarios/26-custom-spec-progress-paths.md)                     |              |
| 27 | WORK_COMPLETE | [Parent prescribes distinct scenario per parallel worker](docs/scenarios/27-parallel-worker-scenario-prescription.md)         |              |
| 28 | WORK_COMPLETE | [Valid progress statuses with enforcement](docs/scenarios/28-valid-progress-statuses.md)                                      |              |
| 29 | WORK_COMPLETE | [100% test coverage enforcement](docs/scenarios/29-test-coverage-enforcement.md)                                              |              |
| 30 | WORK_COMPLETE | [Strict Deno lint enforcement as quality gate](docs/scenarios/30-lint-enforcement.md)                                         |              |
| 31 |          |                                                                                                        |              |
| 32 |          |                                                                                                        |              |
