/**
 * Agent input bus: routes text from the GUI to active agent sessions.
 *
 * Two delivery modes:
 * - **steer**: interrupts current generation with a new direction
 * - **followUp**: queues a message for after the current turn finishes
 *
 * @module
 */
import type { InputMode, Result } from "../types.ts";
import { err, ok } from "../types.ts";

/** Async function that delivers a message into an ongoing agent session. */
export type SessionSender = (text: string, mode: InputMode) => Promise<void>;

/** Per-worker state for routing input. */
type WorkerEntry = { send: SessionSender };

/** Failure detail returned when input delivery fails. */
export type SendFailure = { readonly failureMessage: string };

/** Registry mapping worker IDs (scenario names) to their input context. */
export type AgentInputBus = {
  readonly registerSession: (
    workerId: string,
    send: SessionSender,
  ) => void;
  readonly unregister: (workerId: string) => void;
  readonly send: (
    workerId: string,
    text: string,
    mode: InputMode,
  ) => Promise<Result<true, SendFailure>>;
};

/** Create a new in-process agent input bus. */
export const createAgentInputBus = (): AgentInputBus => {
  const workers = new Map<string, WorkerEntry>();

  return {
    registerSession(workerId, send): void {
      workers.set(workerId, { send });
    },
    unregister(workerId): void {
      workers.delete(workerId);
    },
    async send(workerId, text, mode): Promise<Result<true, SendFailure>> {
      const entry = workers.get(workerId);
      if (!entry) {
        return err({
          failureMessage:
            `No active worker "${workerId}". The agent may have finished or not started yet.`,
        });
      }
      try {
        await entry.send(text, mode);
        return ok(true);
      } catch (e) {
        return err({
          failureMessage: `Session delivery failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        });
      }
    },
  };
};
