/**
 * GUI event bus: routes workflow events to SSE clients.
 * Pure domain module — no I/O dependencies.
 *
 * @module
 */

export type GuiLogEvent = {
  readonly type: "log";
  readonly level: string;
  readonly tags: readonly string[];
  readonly message: string;
  readonly ts: number;
};

export type GuiStateEvent = {
  readonly type: "state";
  readonly from: string;
  readonly to: string;
  readonly ts: number;
};

export type GuiWorkerActiveEvent = {
  readonly type: "worker_active";
  readonly workerIndex: number;
  readonly scenario: string;
  readonly ts: number;
};

export type GuiWorkerDoneEvent = {
  readonly type: "worker_done";
  readonly workerIndex: number;
  readonly ts: number;
};

export type GuiMergeStartEvent = {
  readonly type: "merge_start";
  readonly workerIndex: number;
  readonly scenario: string;
  readonly ts: number;
};

export type GuiMergeDoneEvent = {
  readonly type: "merge_done";
  readonly workerIndex: number;
  readonly outcome: "merged" | "conflict" | "no-changes";
  readonly ts: number;
};

export type GuiEvent =
  | GuiLogEvent
  | GuiStateEvent
  | GuiWorkerActiveEvent
  | GuiWorkerDoneEvent
  | GuiMergeStartEvent
  | GuiMergeDoneEvent;

/** Unsubscribe function returned by {@link GuiEventBus.subscribe}. */
export type Unsubscribe = () => void;

/** Event bus that bridges the orchestrator to SSE clients. */
export type GuiEventBus = {
  readonly emit: (event: GuiEvent) => void;
  readonly subscribe: (handler: (event: GuiEvent) => void) => Unsubscribe;
  /** Returns the latest snapshot events for replay to new SSE clients. */
  readonly snapshot: () => readonly GuiEvent[];
};

/** Create a new in-process GUI event bus. */
export const createEventBus = (): GuiEventBus => {
  const handlers = new Set<(event: GuiEvent) => void>();

  // Snapshot: track latest state + active workers for replay to late joiners
  let lastState: GuiStateEvent | null = null;
  const activeWorkers = new Map<number, GuiWorkerActiveEvent>();

  return {
    emit: (event: GuiEvent): void => {
      // Update snapshot tracking
      if (event.type === "state") {
        lastState = event;
        // Clear workers on non-running_workers transitions
        if (
          event.to !== "running_workers"
        ) {
          activeWorkers.clear();
        }
      } else if (event.type === "worker_active") {
        activeWorkers.set(event.workerIndex, event);
      } else if (event.type === "worker_done") {
        activeWorkers.delete(event.workerIndex);
      }

      for (const h of handlers) h(event);
    },
    subscribe: (handler: (event: GuiEvent) => void): Unsubscribe => {
      handlers.add(handler);
      return (): void => {
        handlers.delete(handler);
      };
    },
    snapshot: (): readonly GuiEvent[] => {
      const events: GuiEvent[] = [];
      if (lastState) events.push(lastState);
      for (const w of activeWorkers.values()) events.push(w);
      return events;
    },
  };
};
