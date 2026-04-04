/**
 * Shared client-side event store for GUI islands.
 *
 * Holds SSE-derived state (log events, orchestrator state, workers)
 * and notifies subscribers on change. All islands import this same
 * module instance — esbuild deduplicates it into a shared chunk.
 *
 * @module
 */

/** Shape of a log event from the SSE stream. */
export type LogEvent = {
  readonly type: "log";
  readonly level: string;
  readonly tags: readonly string[];
  readonly message: string;
  readonly ts: number;
  readonly workerId?: string;
  /** Monotonic sequence number for stable rendering keys. */
  readonly seq: number;
};

export type WorkerInfo = {
  readonly scenario: string;
  readonly status: "running" | "done" | "merging" | "merged";
};

export type StatusEntry = {
  readonly id: string;
  readonly status: string;
};

export type StatusDiff = {
  readonly specOnly: string[];
  readonly progressOnly: string[];
  readonly shared: StatusEntry[];
};

export type SelectedWorker = {
  readonly workerIndex: number;
  readonly scenario: string;
  /** When set, this selection points to a phase stream (merge/validate) rather than a worker. */
  readonly phase?: "merge" | "validate";
} | null;

// deno-lint-ignore no-explicit-any
type GuiEvent = { readonly type: string; [k: string]: any };

type Subscriber = () => void;
type StoreTopic =
  | "connection"
  | "graph"
  | "hydration"
  | "iteration"
  | "logs"
  | "selection"
  | "worker_logs";

const MAX_LOG_EVENTS = 1500;
const TRIMMED_LOG_EVENTS = 1200;
const MAX_WORKER_LOG_EVENTS = 800;
const TRIMMED_WORKER_LOG_EVENTS = 600;

// --- Mutable store ---
let connected = false;
let hydrated = false;
let orchestratorState = "init";
let iteration = "";
const logEvents: LogEvent[] = [];
const workerLogBuffers = new Map<string, LogEvent[]>();
const activeWorkers = new Map<number, WorkerInfo>();
let selectedWorker: SelectedWorker = null;
/** Scenarios whose workers have finished (worker_done received). */
const finishedWorkers = new Set<string>();
/** Whether the merge phase is currently active. */
let mergeActive = false;
/** Whether the validation phase is currently active. */
let validateActive = false;
const subscribers = new Map<Subscriber, ReadonlySet<StoreTopic> | null>();
let logVersion = 0;
let workerLogVersion = 0;
let nextSeq = 0;
const pendingTopics = new Set<StoreTopic>();
let notifyFrameId: number | null = null;
const frameScheduler = globalThis as typeof globalThis & {
  requestAnimationFrame?: (cb: (time: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
};

const flushNotifications = (): void => {
  notifyFrameId = null;
  if (pendingTopics.size === 0) return;
  const changed = new Set(pendingTopics);
  pendingTopics.clear();
  for (const [fn, subscribedTopics] of subscribers) {
    if (subscribedTopics === null) {
      fn();
      continue;
    }
    for (const topic of subscribedTopics) {
      if (changed.has(topic)) {
        fn();
        break;
      }
    }
  }
};

const scheduleNotificationFlush = (): void => {
  if (notifyFrameId !== null) return;
  if (typeof frameScheduler.requestAnimationFrame === "function") {
    notifyFrameId = frameScheduler.requestAnimationFrame(flushNotifications);
    return;
  }
  flushNotifications();
};

const notify = (...topics: StoreTopic[]): void => {
  for (const topic of topics) pendingTopics.add(topic);
  scheduleNotificationFlush();
};

const trimLogBuffer = (buffer: LogEvent[], max: number, keep: number): void => {
  if (buffer.length <= max) return;
  buffer.splice(0, buffer.length - keep);
};

// --- Public read API ---
export const getConnected = (): boolean => connected;
export const getHydrated = (): boolean => hydrated;
export const getOrchestratorState = (): string => orchestratorState;
export const getIteration = (): string => iteration;
export const getLogEvents = (): readonly LogEvent[] => logEvents;
export const getLogVersion = (): number => logVersion;
export const getActiveWorkers = (): ReadonlyMap<number, WorkerInfo> =>
  activeWorkers;
export const getSelectedWorker = (): SelectedWorker => selectedWorker;
export const isWorkerFinished = (scenario: string): boolean =>
  finishedWorkers.has(scenario);
export const getWorkerLogBuffer = (
  workerId: string,
): readonly LogEvent[] => workerLogBuffers.get(workerId) ?? [];
export const getWorkerLogVersion = (): number => workerLogVersion;
export const isMergeActive = (): boolean => mergeActive;
export const isValidateActive = (): boolean => validateActive;

// --- Public write API ---
export const subscribe = (
  fn: Subscriber,
  topics?: readonly StoreTopic[],
): () => void => {
  subscribers.set(fn, topics ? new Set(topics) : null);
  return (): void => {
    subscribers.delete(fn);
  };
};

export const setConnected = (v: boolean): void => {
  connected = v;
  notify("connection");
};

export const setHydrated = (v: boolean): void => {
  hydrated = v;
  notify("hydration");
};

export const setSelectedWorker = (w: SelectedWorker): void => {
  selectedWorker = w;
  notify("selection");
};

export const clearLogEvents = (): void => {
  logEvents.length = 0;
  logVersion++;
  notify("logs");
};

/** Reset client-side GUI state while preserving active subscriptions. */
export const resetStore = (): void => {
  if (notifyFrameId !== null) {
    if (typeof frameScheduler.cancelAnimationFrame === "function") {
      frameScheduler.cancelAnimationFrame(notifyFrameId);
    }
    notifyFrameId = null;
  }
  pendingTopics.clear();
  connected = false;
  hydrated = false;
  orchestratorState = "init";
  iteration = "";
  logEvents.length = 0;
  logVersion++;
  workerLogBuffers.clear();
  workerLogVersion++;
  activeWorkers.clear();
  selectedWorker = null;
  finishedWorkers.clear();
  mergeActive = false;
  validateActive = false;
  notify(
    "connection",
    "graph",
    "hydration",
    "iteration",
    "logs",
    "selection",
    "worker_logs",
  );
};

/** Dispatch an SSE event into the store. */
export const dispatch = (ev: GuiEvent): void => {
  if (ev.type === "log") {
    const logEv = { ...ev, seq: nextSeq++ } as LogEvent;
    logEvents.push(logEv);
    trimLogBuffer(logEvents, MAX_LOG_EVENTS, TRIMMED_LOG_EVENTS);
    logVersion++;
    let iterationChanged = false;
    // Buffer worker-originated events for modal replay.
    if (logEv.workerId !== undefined) {
      const buf = workerLogBuffers.get(logEv.workerId) ?? [];
      buf.push(logEv);
      trimLogBuffer(buf, MAX_WORKER_LOG_EVENTS, TRIMMED_WORKER_LOG_EVENTS);
      workerLogBuffers.set(logEv.workerId, buf);
      workerLogVersion++;
    }
    // Track iteration from log message.
    const m = logEv.message.match(/Round (\d+):/);
    if (m) {
      const nextIteration = `iteration ${m[1]}`;
      iterationChanged = nextIteration !== iteration;
      iteration = nextIteration;
    }
    notify(
      "logs",
      ...(logEv.workerId !== undefined ? ["worker_logs"] as const : []),
      ...(iterationChanged ? ["iteration"] as const : []),
    );
    return;
  } else if (ev.type === "state") {
    orchestratorState = ev.to as string;
    if (ev.to === "done" || ev.to === "aborted") activeWorkers.clear();
    notify("graph");
    return;
  } else if (ev.type === "worker_active") {
    activeWorkers.set(ev.workerIndex as number, {
      scenario: ev.scenario as string,
      status: "running",
    });
    notify("graph");
    return;
  } else if (ev.type === "worker_done") {
    const scenario = (ev.scenario as string | undefined) ??
      activeWorkers.get(ev.workerIndex as number)?.scenario;
    if (scenario) finishedWorkers.add(scenario);
    const existing = activeWorkers.get(ev.workerIndex as number);
    if (existing) {
      activeWorkers.set(ev.workerIndex as number, {
        ...existing,
        status: "done",
      });
    }
    notify("graph", "worker_logs");
    return;
  } else if (ev.type === "merge_start") {
    mergeActive = true;
    const existing = activeWorkers.get(ev.workerIndex as number);
    if (existing) {
      activeWorkers.set(ev.workerIndex as number, {
        ...existing,
        status: "merging",
      });
    }
    notify("graph");
    return;
  } else if (ev.type === "merge_done") {
    const existing = activeWorkers.get(ev.workerIndex as number);
    if (existing) {
      activeWorkers.set(ev.workerIndex as number, {
        ...existing,
        status: "merged",
      });
    }
    // Check if all workers are merged — if so, merge phase is done
    const allMerged = [...activeWorkers.values()].every(
      (w) => w.status === "merged",
    );
    if (allMerged) mergeActive = false;
    notify("graph");
    return;
  } else if (ev.type === "validate_start") {
    validateActive = true;
    notify("graph");
    return;
  } else if (ev.type === "validate_done") {
    validateActive = false;
    notify("graph");
    return;
  }
};
