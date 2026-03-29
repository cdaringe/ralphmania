/**
 * Agent input bus: routes text from the GUI to active agent workers.
 *
 * Two delivery mechanisms:
 * - **stdin pipe**: for agents that read stdin mid-session (e.g., codex)
 * - **session send**: for claude SDK sessions that accept multi-turn input
 *
 * @module
 */
import type { Result } from "../types.ts";
import { err, ok } from "../types.ts";

/** Async function that delivers a message into an ongoing agent session. */
export type SessionSender = (text: string) => Promise<void>;

/** Per-worker state for routing input. */
type WorkerEntry =
  | { mode: "stdin"; writer: WritableStreamDefaultWriter<Uint8Array> }
  | { mode: "session"; send: SessionSender };

/** Failure detail returned when input delivery fails. */
export type SendFailure = { readonly failureMessage: string };

/** Registry mapping worker IDs (scenario names) to their input context. */
export type AgentInputBus = {
  readonly register: (
    workerId: string,
    stdin: WritableStream<Uint8Array>,
  ) => void;
  readonly registerSession: (
    workerId: string,
    send: SessionSender,
  ) => void;
  readonly unregister: (workerId: string) => void;
  readonly send: (
    workerId: string,
    text: string,
  ) => Promise<Result<true, SendFailure>>;
};

/** Create a new in-process agent input bus. */
export const createAgentInputBus = (): AgentInputBus => {
  const workers = new Map<string, WorkerEntry>();
  const enc = new TextEncoder();

  return {
    register(workerId, stdin): void {
      workers.set(workerId, { mode: "stdin", writer: stdin.getWriter() });
    },
    registerSession(workerId, send): void {
      workers.set(workerId, { mode: "session", send });
    },
    unregister(workerId): void {
      const entry = workers.get(workerId);
      if (entry?.mode === "stdin") entry.writer.releaseLock();
      workers.delete(workerId);
    },
    async send(workerId, text): Promise<Result<true, SendFailure>> {
      const entry = workers.get(workerId);
      if (!entry) {
        return err({
          failureMessage:
            `No active worker "${workerId}". The agent may have finished or not started yet.`,
        });
      }
      try {
        entry.mode === "stdin"
          ? await entry.writer.write(enc.encode(text))
          : await entry.send(text);
        return ok(true);
      } catch (e) {
        return err({
          failureMessage: entry.mode === "stdin"
            ? `Stdin pipe broken: ${e instanceof Error ? e.message : String(e)}`
            : `Session delivery failed: ${
              e instanceof Error ? e.message : String(e)
            }`,
        });
      }
    },
  };
};
