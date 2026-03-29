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
} | null;

// deno-lint-ignore no-explicit-any
type GuiEvent = { readonly type: string; [k: string]: any };

type Subscriber = () => void;

// --- Mutable store ---
let connected = false;
let orchestratorState = "init";
let iteration = "";
const logEvents: LogEvent[] = [];
const workerLogBuffers = new Map<string, LogEvent[]>();
const activeWorkers = new Map<number, WorkerInfo>();
let selectedWorker: SelectedWorker = null;
/** Scenarios whose workers have finished (worker_done received). */
const finishedWorkers = new Set<string>();
const subscribers = new Set<Subscriber>();

const notify = (): void => {
  for (const fn of subscribers) fn();
};

// --- Public read API ---
export const getConnected = (): boolean => connected;
export const getOrchestratorState = (): string => orchestratorState;
export const getIteration = (): string => iteration;
export const getLogEvents = (): readonly LogEvent[] => logEvents;
export const getActiveWorkers = (): ReadonlyMap<number, WorkerInfo> =>
  activeWorkers;
export const getSelectedWorker = (): SelectedWorker => selectedWorker;
export const isWorkerFinished = (scenario: string): boolean =>
  finishedWorkers.has(scenario);
export const getWorkerLogBuffer = (
  workerId: string,
): readonly LogEvent[] => workerLogBuffers.get(workerId) ?? [];

// --- Public write API ---
export const subscribe = (fn: Subscriber): () => void => {
  subscribers.add(fn);
  return (): void => {
    subscribers.delete(fn);
  };
};

export const setConnected = (v: boolean): void => {
  connected = v;
  notify();
};

export const setSelectedWorker = (w: SelectedWorker): void => {
  selectedWorker = w;
  notify();
};

export const clearLogEvents = (): void => {
  logEvents.length = 0;
  notify();
};

/** Dispatch an SSE event into the store. */
export const dispatch = (ev: GuiEvent): void => {
  if (ev.type === "log") {
    const logEv = ev as LogEvent;
    logEvents.push(logEv);
    // Buffer worker-originated events for modal replay.
    if (logEv.workerId !== undefined) {
      const buf = workerLogBuffers.get(logEv.workerId) ?? [];
      buf.push(logEv);
      workerLogBuffers.set(logEv.workerId, buf);
    }
    // Track iteration from log message.
    const m = logEv.message.match(/Round (\d+):/);
    if (m) iteration = `iteration ${m[1]}`;
  } else if (ev.type === "state") {
    orchestratorState = ev.to as string;
    if (ev.to === "done" || ev.to === "aborted") activeWorkers.clear();
  } else if (ev.type === "worker_active") {
    activeWorkers.set(ev.workerIndex as number, {
      scenario: ev.scenario as string,
      status: "running",
    });
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
  } else if (ev.type === "merge_start") {
    const existing = activeWorkers.get(ev.workerIndex as number);
    if (existing) {
      activeWorkers.set(ev.workerIndex as number, {
        ...existing,
        status: "merging",
      });
    }
  } else if (ev.type === "merge_done") {
    const existing = activeWorkers.get(ev.workerIndex as number);
    if (existing) {
      activeWorkers.set(ev.workerIndex as number, {
        ...existing,
        status: "merged",
      });
    }
  }
  notify();
};
