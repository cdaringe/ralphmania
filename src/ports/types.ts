import type {
  Agent,
  CommandSpec,
  EscalationLevel,
  EscalationState,
  IterationResult,
  Logger,
  LoopCheckpoint,
  ModelSelection,
  Result,
  ValidationResult,
} from "../types.ts";
import type { WorktreeInfo } from "../git/worktree.ts";
import type { Plugin } from "../plugin.ts";
import type { AgentInputBus } from "../gui/input-bus.ts";

/** File I/O port for progress file operations. */
export type ProgressFileDeps = {
  readonly readTextFile: (path: string) => Promise<string>;
  readonly writeTextFile: (path: string, content: string) => Promise<void>;
  /** Resolves if file exists, rejects if not. Return value is unused. */
  readonly stat: (path: string) => Promise<unknown>;
};

/** Injectable filesystem deps for ensureValidationHook. */
export type ValidationHookDeps = {
  exists: (path: string) => Promise<boolean>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  chmod: (path: string, mode: number) => Promise<void>;
};

/** Injectable output deps for the logger. */
export type LoggerOutput = {
  writeSync: (data: Uint8Array) => number;
  writeErrSync: (data: Uint8Array) => number;
};

/** Injectable I/O deps for model resolution functions. */
export type ModelIODeps = {
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
};

/** Dependencies for the agent execution step — worker I/O boundary. */
export type AgentRunDeps = {
  /** Spawn the agent, stream output, return the iteration result. */
  readonly execute: (opts: {
    spec: CommandSpec;
    agent: Agent;
    selection: ModelSelection;
    iterationNum: number;
    signal: AbortSignal;
    log: Logger;
    cwd: string | undefined;
    /** Worker index used to build a colored per-line stdio prefix. */
    workerIndex?: number;
    /** When provided, the agent subprocess stdin is piped and registered here. */
    agentInputBus?: AgentInputBus;
  }) => Promise<IterationResult>;
};

/** Dependencies injectable for orchestrator state machine testing. */
export type MachineDeps = {
  readonly readProgress: () => Promise<string>;
  readonly readSpec: () => Promise<string>;
  readonly createWorktree: (
    opts: { scenario: string; workerIndex: number; log: Logger },
  ) => Promise<Result<WorktreeInfo, string>>;
  readonly runIteration: (
    opts: {
      iterationNum: number;
      agent: Agent;
      signal: AbortSignal;
      log: Logger;
      validationFailurePath: string | undefined;
      plugin: Plugin;
      level: EscalationLevel | undefined;
      cwd?: string;
      targetScenarioOverride?: string;
      specFile?: string;
      progressFile?: string;
      /** Worker index forwarded to the agent executor for stdio prefixing. */
      workerIndex?: number;
    },
  ) => Promise<IterationResult>;
  readonly runValidation: (
    opts: { iterationNum: number; log: Logger; cwd?: string },
  ) => Promise<ValidationResult>;
  readonly hasNewCommits: (
    opts: { worktree: WorktreeInfo; log: Logger },
  ) => Promise<boolean>;
  readonly mergeWorktree: (
    opts: { worktree: WorktreeInfo; log: Logger },
  ) => Promise<"merged" | "conflict">;
  readonly cleanupWorktree: (
    opts: { worktree: WorktreeInfo; log: Logger },
  ) => Promise<Result<void, string>>;
  readonly resetWorkingTree: (
    opts: { log: Logger },
  ) => Promise<Result<void, string>>;
  readonly reconcileMerge: (
    opts: {
      worktree: WorktreeInfo;
      agent: Agent;
      signal: AbortSignal;
      log: Logger;
    },
  ) => Promise<void>;
  readonly readCheckpoint: () => Promise<LoopCheckpoint | undefined>;
  readonly writeCheckpoint: (checkpoint: LoopCheckpoint) => Promise<void>;
  readonly clearCheckpoint: () => Promise<void>;
  readonly readEscalationState: (log: Logger) => Promise<EscalationState>;
  readonly writeEscalationState: (
    state: EscalationState,
    log: Logger,
  ) => Promise<void>;
  readonly selectScenarioBatch: (opts: {
    scenarioIds: readonly string[];
    specFile: string | undefined;
    parallelism: number;
    log: Logger;
  }) => Promise<readonly string[]>;
};
