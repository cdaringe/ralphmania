# Ralphmania State Machine

## Orchestrator Machine

```rust
enum OrchestratorState {
    Booting,
    ReadingProgress { path: PathBuf },
    FindingActionable { scenarios: Vec<Scenario> },
    SelectingModels { actionable: Vec<Scenario> },
    SpawningWorkers {
        tasks: Vec<WorkerTask>,   // scenario + model + worktree path
    },
    WorkersRunning {
        handles: Vec<WorkerHandle>,  // wait for ANY to complete
    },
    MergeQueued {
        pending: Vec<WorktreePath>,  // on-disk queue of worktrees ready to merge
    },
    Merging { branch: BranchName },
    Reconciling { conflict: MergeConflict },
    Validating { iteration: usize, log_path: PathBuf },
    FeedingBack { failure_log: PathBuf },
    GeneratingReceipts,
    Done,
}
```

### Edges

```rust
/// Each edge names an event, its source state, and the set of valid
/// target states it may transition to.
enum OrchestratorEdge {
    Initialized {
        from: OrchestratorState::Booting,
        to: OrchestratorState::ReadingProgress,
        config: ResolvedConfig,
    },
    ProgressParsed {
        from: OrchestratorState::ReadingProgress,
        to: OrchestratorState::FindingActionable,
        scenarios: Vec<Scenario>,
    },
    ActionableResolved {
        from: OrchestratorState::FindingActionable,
        to: OrchestratorState::SelectingModels
            | OrchestratorState::GeneratingReceipts,
        actionable: Vec<Scenario>,  // empty ⇒ GeneratingReceipts
    },
    ModelsAssigned {
        from: OrchestratorState::SelectingModels,
        to: OrchestratorState::SpawningWorkers,
        tasks: Vec<WorkerTask>,
    },
    WorkersSpawned {
        from: OrchestratorState::SpawningWorkers,
        to: OrchestratorState::WorkersRunning,
        handles: Vec<WorkerHandle>,
    },
    WorkerFinished {
        from: OrchestratorState::WorkersRunning,
        to: OrchestratorState::MergeQueued,
        worktree: WorktreePath,
    },
    DequeuedNext {
        from: OrchestratorState::MergeQueued,
        to: OrchestratorState::Merging
            | OrchestratorState::WorkersRunning,  // queue empty + workers still running
        branch: Option<BranchName>,               // None ⇒ back to WorkersRunning
    },
    MergeResolved {
        from: OrchestratorState::Merging,
        to: OrchestratorState::Validating
            | OrchestratorState::Reconciling,
        conflict: Option<MergeConflict>,  // Some ⇒ Reconciling
    },
    ConflictResolved {
        from: OrchestratorState::Reconciling,
        to: OrchestratorState::Validating,
    },
    ValidationComplete {
        from: OrchestratorState::Validating,
        to: OrchestratorState::MergeQueued
            | OrchestratorState::FeedingBack
            | OrchestratorState::FindingActionable,
        iteration: usize,
        log_path: PathBuf,
        passed: bool,
        // passed + queue non-empty  ⇒ MergeQueued
        // passed + queue empty      ⇒ FindingActionable
        // !passed                   ⇒ FeedingBack
    },
    FailureAttached {
        from: OrchestratorState::FeedingBack,
        to: OrchestratorState::FindingActionable,
        failure_log: PathBuf,
    },
    ReceiptsWritten {
        from: OrchestratorState::GeneratingReceipts,
        to: OrchestratorState::Done,
    },
}
```

## Worker Machine

Per-scenario, runs inside an isolated git worktree.

```rust
enum WorkerState {
    ResolvingModel { scenario: ScenarioId },
    BuildingPrompt {
        scenario: ScenarioId,
        model: ModelConfig,
        prior_failures: Vec<PathBuf>,
    },
    BuildingCommand { prompt: String },
    RunningAgent {
        child: Process,
        output_stream: NdjsonStream,
    },
    IterationComplete { scenario: ScenarioId },
    IterationContinue { scenario: ScenarioId },
}
```

### Edges

```rust
enum WorkerEdge {
    ModelResolved {
        from: WorkerState::ResolvingModel,
        to: WorkerState::BuildingPrompt,
        model: ModelConfig,
    },
    PromptBuilt {
        from: WorkerState::BuildingPrompt,
        to: WorkerState::BuildingCommand,
        prompt: String,
    },
    CommandBuilt {
        from: WorkerState::BuildingCommand,
        to: WorkerState::RunningAgent,
        cmd: Command,
    },
    AgentExited {
        from: WorkerState::RunningAgent,
        to: WorkerState::IterationComplete
            | WorkerState::IterationContinue,
        completed: bool,  // true ⇒ IterationComplete
    },
}
```

## Scenario Lifecycle

Tracks each scenario's status in `progress.md`.

```rust
enum ScenarioStatus {
    Unimplemented,
    Complete,
    Verified,
    NeedsRework,  // user-initiated
    Obsolete,     // user-initiated, terminal
}
```

### Edges

```rust
enum ScenarioEdge {
    AgentMarkedComplete {
        from: ScenarioStatus::Unimplemented,
        to: ScenarioStatus::Complete,
    },
    ValidationPassed {
        from: ScenarioStatus::Complete,
        to: ScenarioStatus::Verified,
    },
    UserRejected {
        from: ScenarioStatus::Complete,
        to: ScenarioStatus::NeedsRework,
    },
    RequeuedForRework {
        from: ScenarioStatus::NeedsRework,
        to: ScenarioStatus::Unimplemented,
    },
    // Obsolete is set directly by the user in progress.md.
    // It is not a machine-driven transition.
}
```

## Model Escalation Ladder

Scenario status determines which model is assigned:

```rust
enum ModelRole {
    Coder,      // Sonnet · high effort — for Unimplemented
    Escalated,  // Opus  · high effort — for NeedsRework
    Verifier,   // Opus  · low effort  — when all Complete
}
```

## Plugin Hooks

Fired at each phase transition in the orchestrator/worker:

```
onConfigResolved → onModelSelected → onPromptBuilt → onCommandBuilt
    → onIterationEnd → onValidationComplete → onLoopEnd
```
