<!-- END_DEMO -->

# Progress

| #  | Status   | Summary                                                                                                                       | Rework Notes |
| -- | -------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1  | COMPLETE | [Interactive prompting for missing agent/iterations input](docs/scenarios/01-interactive-prompting.md)                        |              |
| 2  | COMPLETE | [CLI accepts --agent/-a, --iterations/-i, --plugin/-p flags](docs/scenarios/02-cli-flags.md)                                  |              |
| 3  | COMPLETE | [Startup banner shows agent, iterations, model ladder](docs/scenarios/03-startup-banner.md)                                   |              |
| 4  | COMPLETE | [Agentic loop runs N iterations, stops early on completion](docs/scenarios/04-agentic-loop.md)                                |              |
| 5  | COMPLETE | [SIGINT graceful: first aborts, second force-exits 130](docs/scenarios/05-sigint-graceful-shutdown.md)                        |              |
| 6  | COMPLETE | [Auto-create specification.validate.sh with placeholder, halt until filled](docs/scenarios/06-validation-hook-auto-create.md) |              |
| 7  | COMPLETE | [Run validation script, capture log, feed failure context back](docs/scenarios/07-validation-run-and-feedback.md)             |              |
| 8  | COMPLETE | [NEEDS_REWORK detection and per-scenario model escalation](docs/scenarios/08-rework-escalation.md)                            |              |
| 9  | COMPLETE | [Agent scoped to failing scenario during escalation](docs/scenarios/09-scope-to-failing-scenario.md)                          |              |
| 10 | COMPLETE | [Agent self-reviews all claims, marks VERIFIED or NEEDS_REWORK](docs/scenarios/10-self-review-verification.md)                |              |
| 11 | COMPLETE | [Evidence receipts generated in .ralph/receipts/ on completion](docs/scenarios/11-receipts.md)                               |              |
| 12 | COMPLETE | [User-provided plugins with 7 lifecycle hooks](docs/scenarios/12-plugins.md)                                                  |              |
| 13 | COMPLETE | [Each iteration capped at 60 minutes via AbortSignal.timeout](docs/scenarios/13-iteration-timeout.md)                         |              |
| 14 | COMPLETE | [Subprocesses run with CI=true, no prompts, stdin null](docs/scenarios/14-non-interactive-environment.md)                     |              |
| 15 | COMPLETE | [First boot generates progress.md template](docs/scenarios/15-first-boot-progress-generation.md)                              |              |
| 16 | COMPLETE | [Logger prefixes all output with [ralph:...] tag](docs/scenarios/16-logger-ralphmania-prefix.md)                              |              |
| 17 | COMPLETE | [Validation logs stripped of ANSI color codes](docs/scenarios/17-strip-color-codes-from-logs.md)                              |              |
| 18 | COMPLETE | [Model-selection log reports progress status](docs/scenarios/18-model-selection-progress-status.md)                           |              |
| 19 | COMPLETE | [Claude 4-step escalation ladder via CLAUDE_CODE_EFFORT_LEVEL](docs/scenarios/19-claude-escalation-ladder.md)                 |              |
