/**
 * Shared test fixtures. Functional factories — no mocks.
 *
 * @module
 */

import type {
  EscalationLevel,
  EscalationState,
  Logger,
  ValidationResult,
} from "../src/types.ts";
import { ok } from "../src/types.ts";
import type { WorktreeInfo } from "../src/worktree.ts";
import type { MachineContext, MachineDeps } from "../src/state-machine.ts";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A logger that discards all output. */
export const noopLog: Logger = (): void => {};

/** Build a deterministic WorktreeInfo for a given worker index. */
export const stubWorktree = (workerIndex: number): WorktreeInfo => ({
  scenario: String(workerIndex),
  path: `/tmp/ralph-wt-${workerIndex}`,
  branch: `ralph/worker-${workerIndex}-test`,
});

// ---------------------------------------------------------------------------
// Dependency factories
// ---------------------------------------------------------------------------

/**
 * Build a complete MachineDeps with sensible defaults. Every dep is
 * overridable via the `overrides` partial.
 */
export const stubDeps = (
  overrides: Partial<MachineDeps> = {},
): MachineDeps => ({
  readProgress: () => Promise.resolve(""),
  createWorktree: ({ workerIndex }) =>
    Promise.resolve(ok(stubWorktree(workerIndex))),
  runIteration: () => Promise.resolve({ status: "continue" }),
  runValidation: () => Promise.resolve({ status: "passed" as const }),
  hasNewCommits: () => Promise.resolve(false),
  mergeWorktree: () => Promise.resolve("merged"),
  cleanupWorktree: () => Promise.resolve(ok(undefined)),
  resetWorkingTree: () => Promise.resolve(ok(undefined)),
  reconcileMerge: () => Promise.resolve(),
  readCheckpoint: () => Promise.resolve(undefined),
  writeCheckpoint: () => Promise.resolve(),
  clearCheckpoint: () => Promise.resolve(),
  readEscalationState: () => Promise.resolve({}),
  writeEscalationState: () => Promise.resolve(),
  ...overrides,
});

/**
 * Build a MachineContext with sensible defaults. Everything is overridable.
 * If you override `deps`, pass a full MachineDeps (use {@link stubDeps}).
 */
export const makeCtx = (
  overrides: Partial<MachineContext> = {},
): MachineContext => ({
  agent: "claude",
  iterations: 10,
  parallelism: 1,
  expectedScenarioIds: ["1.1", "1.2"],
  signal: AbortSignal.timeout(10_000),
  log: noopLog,
  plugin: {},
  level: undefined,
  specFile: undefined,
  progressFile: undefined,
  deps: stubDeps(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Stateful stores — functional, not mocks
// ---------------------------------------------------------------------------

export type ProgressStore = {
  /** Read current content. */
  get: () => string;
  /** Replace content (simulates an agent updating progress.md). */
  set: (content: string) => void;
};

/**
 * A mutable progress store. Workers mutate it via `set`; the orchestrator
 * reads it via `get`. Simulates the real progress.md lifecycle.
 */
export const createProgressStore = (initial: string): ProgressStore => {
  let content = initial;
  return {
    get: () => content,
    set: (c: string) => {
      content = c;
    },
  };
};

export type EscalationStore = {
  /** Current state (readonly snapshot). */
  readonly state: EscalationState;
  /** Async reader matching MachineDeps.readEscalationState. */
  read: (log: Logger) => Promise<EscalationState>;
  /** Async writer matching MachineDeps.writeEscalationState. */
  write: (state: EscalationState, log: Logger) => Promise<void>;
};

/**
 * A mutable escalation store that functions like `.ralph/escalation.json`.
 */
export const createEscalationStore = (
  initial: EscalationState = {},
): EscalationStore => {
  const store = { state: initial };
  return {
    get state(): EscalationState {
      return store.state;
    },
    read: () => Promise.resolve({ ...store.state }),
    write: (s) => {
      store.state = s;
      return Promise.resolve();
    },
  };
};

// ---------------------------------------------------------------------------
// Integration-level dependency builder
// ---------------------------------------------------------------------------

/**
 * Build stateful deps for integration testing. The `onIteration` callback
 * receives the worker context and the progress store, allowing the test to
 * simulate what an agent would do (update progress, commit, etc.).
 */
export const integrationDeps = (
  {
    progress,
    escalation = createEscalationStore(),
    onIteration,
    onValidation,
  }: {
    progress: ProgressStore;
    escalation?: EscalationStore;
    onIteration?: (opts: {
      iterationNum: number;
      targetScenarioOverride?: string;
      level: EscalationLevel | undefined;
      validationFailurePath: string | undefined;
      progress: ProgressStore;
    }) => void;
    onValidation?: (
      opts: { iterationNum: number; cwd?: string },
    ) => ValidationResult;
  },
): Partial<MachineDeps> => ({
  readProgress: () => Promise.resolve(progress.get()),
  createWorktree: ({ workerIndex }) =>
    Promise.resolve(ok(stubWorktree(workerIndex))),
  runIteration: (opts) => {
    onIteration?.({
      iterationNum: opts.iterationNum,
      targetScenarioOverride: opts.targetScenarioOverride,
      level: opts.level,
      validationFailurePath: opts.validationFailurePath,
      progress,
    });
    return Promise.resolve({ status: "continue" });
  },
  runValidation: (opts) =>
    Promise.resolve(
      onValidation?.(opts) ?? { status: "passed" as const },
    ),
  hasNewCommits: () => Promise.resolve(true),
  mergeWorktree: () => Promise.resolve("merged"),
  cleanupWorktree: () => Promise.resolve(ok(undefined)),
  resetWorkingTree: () => Promise.resolve(ok(undefined)),
  reconcileMerge: () => Promise.resolve(),
  readCheckpoint: () => Promise.resolve(undefined),
  writeCheckpoint: () => Promise.resolve(),
  clearCheckpoint: () => Promise.resolve(),
  readEscalationState: escalation.read,
  writeEscalationState: escalation.write,
});
