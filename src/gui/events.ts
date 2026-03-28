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

export type GuiEvent =
  | GuiLogEvent
  | GuiStateEvent
  | GuiWorkerActiveEvent
  | GuiWorkerDoneEvent;

/** Unsubscribe function returned by {@link GuiEventBus.subscribe}. */
export type Unsubscribe = () => void;

/** Event bus that bridges the orchestrator to SSE clients. */
export type GuiEventBus = {
  readonly emit: (event: GuiEvent) => void;
  readonly subscribe: (handler: (event: GuiEvent) => void) => Unsubscribe;
};

/** Create a new in-process GUI event bus. */
export const createEventBus = (): GuiEventBus => {
  const handlers = new Set<(event: GuiEvent) => void>();
  return {
    emit: (event: GuiEvent): void => {
      for (const h of handlers) h(event);
    },
    subscribe: (handler: (event: GuiEvent) => void): Unsubscribe => {
      handlers.add(handler);
      return (): void => {
        handlers.delete(handler);
      };
    },
  };
};
