/**
 * SimController: reactive control object for simulation mode.
 *
 * The dev panel writes configuration here; {@link SimMachineDeps} reads it
 * to drive the orchestrator state machine with fake I/O.
 *
 * @module
 */

/** Timing profile for simulated delays. */
export type SimProfile = "instant" | "fast" | "realistic";

/** Outcome a simulated worker produces for a given scenario. */
export type ScenarioOutcome = "complete" | "needs_rework" | "timeout";

/** Serializable snapshot of simulation configuration (sent over HTTP). */
export type SimConfig = {
  profile: SimProfile;
  autoAdvance: boolean;
  validationFailureRate: number;
  mergeConflictRate: number;
  workerFailureRate: number;
  scenarioCount: number;
  scenarioOutcomes: Record<string, ScenarioOutcome>;
};

type Subscriber = () => void;

export type SimController = {
  /** Current timing profile. */
  profile: SimProfile;

  /** When true, transitions advance automatically after delays. */
  autoAdvance: boolean;

  /** Per-scenario outcome overrides. Defaults to "complete" for unlisted. */
  scenarioOutcomes: Map<string, ScenarioOutcome>;

  /** Number of scenarios in the simulated spec. */
  scenarioCount: number;

  /** Probability (0-1) of validation failing after merge. */
  validationFailureRate: number;

  /** Probability (0-1) of a merge conflict per worker. */
  mergeConflictRate: number;

  /** Probability (0-1) of a worker failing. */
  workerFailureRate: number;

  /**
   * When autoAdvance is false, the orchestrator blocks at each transition
   * until this is called. Resolves the current wait promise.
   */
  advance: () => void;

  /**
   * Returns a promise that resolves when {@link advance} is called,
   * or immediately if autoAdvance is true (after the profile delay).
   */
  waitForAdvance: () => Promise<void>;

  /** Subscribe to config changes (for SSE broadcast). */
  subscribe: (fn: Subscriber) => () => void;

  /** Notify all subscribers of a config change. */
  notifyChange: () => void;

  /** Snapshot the current config as a plain object. */
  snapshot: () => SimConfig;

  /** Apply a partial config update. */
  applyConfig: (partial: Partial<SimConfig>) => void;

  /**
   * Register a callback invoked when {@link reset} is called.
   * Used by SimDeps to clear in-memory scenario/checkpoint state.
   */
  onReset: (fn: () => void) => () => void;

  /** Restart the orchestrator loop (clears scenario progress, not config). */
  reset: () => void;

  /** Reset all config knobs to defaults (does not restart the loop). */
  resetConfig: () => void;

  /** Abort controller for the current orchestrator run. */
  abortController: AbortController;
};

/** Delay durations per profile (milliseconds). */
export const PROFILE_DELAYS: Record<SimProfile, {
  worker: number;
  merge: number;
  validate: number;
  transition: number;
}> = {
  instant: { worker: 0, merge: 0, validate: 0, transition: 0 },
  fast: { worker: 800, merge: 300, validate: 500, transition: 200 },
  realistic: { worker: 5000, merge: 1500, validate: 3000, transition: 500 },
};

export const createSimController = (
  opts?: Partial<{
    scenarioCount: number;
    profile: SimProfile;
    autoAdvance: boolean;
  }>,
): SimController => {
  const scenarioCount = opts?.scenarioCount ?? 4;
  const subscribers = new Set<Subscriber>();
  const resetCallbacks = new Set<() => void>();

  let advanceResolve: (() => void) | null = null;

  const controller: SimController = {
    profile: opts?.profile ?? "fast",
    autoAdvance: opts?.autoAdvance ?? true,
    scenarioOutcomes: new Map(),
    scenarioCount,
    validationFailureRate: 0,
    mergeConflictRate: 0,
    workerFailureRate: 0,
    abortController: new AbortController(),

    advance: () => {
      if (advanceResolve) {
        const resolve = advanceResolve;
        advanceResolve = null;
        resolve();
      }
    },

    waitForAdvance: async () => {
      if (controller.autoAdvance) {
        const delay = PROFILE_DELAYS[controller.profile].transition;
        if (delay > 0) {
          await new Promise<void>((r) => setTimeout(r, delay));
        }
        return;
      }
      await new Promise<void>((r) => {
        advanceResolve = r;
      });
    },

    subscribe: (fn: Subscriber) => {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    notifyChange: () => {
      for (const fn of subscribers) fn();
    },

    snapshot: (): SimConfig => ({
      profile: controller.profile,
      autoAdvance: controller.autoAdvance,
      validationFailureRate: controller.validationFailureRate,
      mergeConflictRate: controller.mergeConflictRate,
      workerFailureRate: controller.workerFailureRate,
      scenarioCount: controller.scenarioCount,
      scenarioOutcomes: Object.fromEntries(controller.scenarioOutcomes),
    }),

    applyConfig: (partial: Partial<SimConfig>) => {
      if (partial.profile !== undefined) controller.profile = partial.profile;
      if (partial.autoAdvance !== undefined) {
        controller.autoAdvance = partial.autoAdvance;
      }
      if (partial.validationFailureRate !== undefined) {
        controller.validationFailureRate = partial.validationFailureRate;
      }
      if (partial.mergeConflictRate !== undefined) {
        controller.mergeConflictRate = partial.mergeConflictRate;
      }
      if (partial.workerFailureRate !== undefined) {
        controller.workerFailureRate = partial.workerFailureRate;
      }
      if (partial.scenarioCount !== undefined) {
        controller.scenarioCount = partial.scenarioCount;
      }
      if (partial.scenarioOutcomes !== undefined) {
        controller.scenarioOutcomes = new Map(
          Object.entries(partial.scenarioOutcomes),
        );
      }
      controller.notifyChange();
    },

    onReset: (fn: () => void) => {
      resetCallbacks.add(fn);
      return () => {
        resetCallbacks.delete(fn);
      };
    },

    reset: () => {
      controller.abortController.abort();
      controller.abortController = new AbortController();
      for (const fn of resetCallbacks) fn();
      controller.notifyChange();
    },

    resetConfig: () => {
      controller.profile = opts?.profile ?? "fast";
      controller.autoAdvance = opts?.autoAdvance ?? true;
      controller.scenarioOutcomes.clear();
      controller.validationFailureRate = 0;
      controller.mergeConflictRate = 0;
      controller.workerFailureRate = 0;
      controller.scenarioCount = scenarioCount;
      controller.notifyChange();
    },
  };

  return controller;
};
