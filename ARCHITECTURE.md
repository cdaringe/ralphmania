# Ralphmania Architecture

> AI agent orchestrator that iteratively implements a specification via parallel
> workers, validation, and escalation.

## System Overview

```mermaid
graph TD
    User([User]) -->|"deno run mod.ts -i N -a claude"| CLI
    User -->|edits| ProgressMD[progress.md]
    User -->|edits| SpecMD[specification.md]
    User -->|writes| ValidateScript[specification.validate.sh]

    subgraph Entry ["Entry (mod.ts)"]
        CLI[CLI Parser] --> Init[Initialize]
        Init --> Banner[Print Banner]
        Banner --> MainLoop
    end

    subgraph MainLoop ["Main Loop"]
        PLoop[runParallelLoop] --> ReadProgress[Read progress.md]
        ReadProgress --> FindActionable[Find Actionable Scenarios]
        FindActionable --> SpawnWorkers
    end

    subgraph SpawnWorkers ["Parallel Workers (parallel.ts)"]
        direction TB
        CreateWT[Create Git Worktrees] --> W1[Worker 0]
        CreateWT --> W2[Worker 1]
        CreateWT --> WN[Worker N...]
        W1 --> Merge[Merge Branches]
        W2 --> Merge
        WN --> Merge
    end

    subgraph WorkerDetail ["Single Worker (runner.ts)"]
        ResolveModel[Resolve Model] --> BuildPrompt[Build Prompt]
        BuildPrompt --> BuildCmd[Build Command]
        BuildCmd --> SpawnAgent[Spawn Agent Subprocess]
        SpawnAgent --> StreamOutput[Stream NDJSON Output]
        StreamOutput --> DetectComplete{Completion Marker?}
        DetectComplete -->|yes| IterComplete[IterationResult: complete]
        DetectComplete -->|no| IterContinue[IterationResult: continue]
    end

    SpawnWorkers --> WorkerDetail

    Merge --> ConflictCheck{Merge Conflicts?}
    ConflictCheck -->|no| Validate
    ConflictCheck -->|yes| Reconcile[Reconcile Agent]
    Reconcile --> Validate

    subgraph Validate ["Validation (validation.ts)"]
        RunScript[Run specification.validate.sh] --> CaptureLog[Save to .ralph/validation/]
        CaptureLog --> VResult{Passed?}
    end

    VResult -->|yes| CheckDone{All VERIFIED?}
    VResult -->|no| FeedBack[Feed failure to next iteration]
    FeedBack --> ReadProgress
    CheckDone -->|no| ReadProgress
    CheckDone -->|yes| Receipts[Generate Receipts]
    Receipts --> Exit([Exit 0])
```

## Model Escalation Ladder

```mermaid
graph LR
    subgraph Ladder ["Model Selection (model.ts)"]
        Coder["Coder\nSonnet · general · high effort"] -->|scenario marked NEEDS_REWORK| Escalated
        Escalated["Escalated\nOpus · strong · high effort"]
        Verifier["Verifier\nOpus · general · low effort"]
    end

    Unimplemented([Unimplemented Scenario]) --> Coder
    NeedsRework([NEEDS_REWORK Scenario]) --> Escalated
    AllComplete([All Scenarios Complete]) --> Verifier
```

## Worker Isolation & Merge

```mermaid
sequenceDiagram
    participant Main as main branch
    participant WT as Git Worktree
    participant Agent as AI Agent
    participant Reconciler as Reconcile Agent

    Main->>WT: Create worktree (.ralph/worktrees/worker-N/)
    WT->>Agent: Run iteration (scoped to scenario)
    Agent->>WT: Commit changes
    WT->>Main: git merge --no-edit
    alt Merge conflict
        Main->>Reconciler: Spawn reconciliation agent
        Reconciler->>Main: Resolve conflicts & commit
    end
    Main->>Main: Cleanup worktree + branch
```

## Plugin Hooks

```mermaid
graph LR
    subgraph Hooks ["Plugin Lifecycle (plugin.ts)"]
        H1[onConfigResolved] --> H2[onModelSelected]
        H2 --> H3[onPromptBuilt]
        H3 --> H4[onCommandBuilt]
        H4 --> H5[onIterationEnd]
        H5 --> H6[onValidationComplete]
        H6 --> H7[onLoopEnd]
    end
```

## File Map

```mermaid
graph TD
    subgraph Sources ["src/"]
        mod.ts --> cli.ts
        mod.ts --> runner.ts
        mod.ts --> parallel.ts
        mod.ts --> progress.ts
        mod.ts --> validation.ts
        mod.ts --> plugin.ts
        mod.ts --> logger.ts

        parallel.ts --> worktree.ts
        parallel.ts --> reconcile.ts
        parallel.ts --> runner.ts
        parallel.ts --> model.ts

        runner.ts --> command.ts
        runner.ts --> validation.ts
        runner.ts --> model.ts

        model.ts --> constants.ts
        model.ts --> types.ts

        command.ts --> types.ts
        command.ts --> constants.ts

        logger.ts --> colors.ts
    end

    subgraph Runtime ["Runtime Files"]
        progress.md
        specification.md
        specification.validate.sh
    end

    subgraph Ralph [".ralph/"]
        escalation.json
        validation/
        worktrees/
        receipts/
    end
```

## Key Data Flow

```
specification.md ──→ prompt ──→ agent ──→ code changes ──→ git commit
                                                              │
progress.md ◄──────────────────────────────────────── agent updates status
                                                              │
specification.validate.sh ◄──────────── runs after merge ────┘
         │
         └──→ .ralph/validation/iteration-N.log ──→ feeds next iteration
```

## Scenario Lifecycle

```
UNIMPLEMENTED ──→ COMPLETE ──→ VERIFIED
       ▲              │
       │              ▼
       └──── NEEDS_REWORK
              (user marks)
```
