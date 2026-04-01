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
        FindActionable --> SelectModels[Select Models]
        SelectModels --> SpawnWorkers
    end

    subgraph SpawnWorkers ["Parallel Workers (orchestrator.ts)"]
        direction TB
        CreateWT[Create Git Worktrees] --> W1[Worker 0]
        CreateWT --> W2[Worker 1]
        CreateWT --> WN[Worker N...]
        W1 --> MQ[Merge Queue]
        W2 --> MQ
        WN --> MQ
        MQ --> Merge[Merge Next Branch]
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

    VResult -->|yes| QueueCheck{Merge queue empty?}
    VResult -->|no| FeedBack[Feed failure to next iteration]
    FeedBack --> ReadProgress
    QueueCheck -->|no| MQ
    QueueCheck -->|yes| CheckDone{All VERIFIED?}
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
    participant MQ as Merge Queue
    participant Reconciler as Reconcile Agent

    Main->>WT: Create worktree (.ralph/worktrees/worker-N/)
    WT->>Agent: Run iteration (scoped to scenario)
    Agent->>WT: Commit changes
    WT->>MQ: Enqueue worktree (on-disk)
    Note over MQ: Workers enqueue as they finish (any order)
    MQ->>Main: Dequeue & git merge --no-edit
    alt Merge conflict
        Main->>Reconciler: Spawn reconciliation agent
        Reconciler->>Main: Resolve conflicts & commit
    end
    Main->>Main: Validate
    alt Queue non-empty
        Main->>MQ: Dequeue next
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
        mod.ts --> orchestrator.ts
        mod.ts --> progress.ts
        mod.ts --> validation.ts
        mod.ts --> plugin.ts
        mod.ts --> logger.ts

        orchestrator.ts --> worktree.ts
        orchestrator.ts --> reconcile.ts
        orchestrator.ts --> runner.ts
        orchestrator.ts --> model.ts

        runner.ts --> command.ts
        runner.ts --> validation.ts
        runner.ts --> model.ts

        model.ts --> constants.ts
        model.ts --> types.ts
        model.ts --> ports/types.ts
        model.ts --> ports/impl.ts

        command.ts --> types.ts
        command.ts --> constants.ts

        logger.ts --> colors.ts
        logger.ts --> ports/types.ts
        logger.ts --> ports/impl.ts

        progress.ts --> ports/types.ts
        progress.ts --> ports/impl.ts

        validation.ts --> ports/types.ts
        validation.ts --> ports/impl.ts

        state-machine.ts --> ports/types.ts
        worker-machine.ts --> ports/types.ts

        subgraph Ports ["src/ports/"]
            portsTypes[types.ts]
            portsImpl[impl.ts]
        end
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

Any non-VERIFIED status ──→ OBSOLETE (user marks in progress.md, terminal)
```
