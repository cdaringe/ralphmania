/**
 * Agent input bus: routes text from the GUI to active agent subprocess stdin.
 * Pure domain module — no I/O dependencies.
 *
 * @module
 */

/** Registry mapping worker indices to their subprocess stdin writers. */
export type AgentInputBus = {
  /** Register a worker's subprocess stdin stream when the agent starts. */
  readonly register: (
    workerIndex: number,
    stdin: WritableStream<Uint8Array>,
  ) => void;
  /** Release and deregister the writer when the agent subprocess exits. */
  readonly unregister: (workerIndex: number) => void;
  /**
   * Write `text` to the given worker's stdin.
   * Returns `true` if the text was written, `false` if no worker is registered
   * or the write failed (e.g. process already exited).
   */
  readonly send: (workerIndex: number, text: string) => Promise<boolean>;
};

/** Create a new in-process agent input bus. */
export const createAgentInputBus = (): AgentInputBus => {
  const writers = new Map<number, WritableStreamDefaultWriter<Uint8Array>>();
  const enc = new TextEncoder();

  return {
    register(workerIndex, stdin): void {
      writers.set(workerIndex, stdin.getWriter());
    },
    unregister(workerIndex): void {
      const writer = writers.get(workerIndex);
      if (writer) {
        writer.releaseLock();
        writers.delete(workerIndex);
      }
    },
    async send(workerIndex, text): Promise<boolean> {
      const writer = writers.get(workerIndex);
      if (!writer) return false;
      try {
        await writer.write(enc.encode(text));
        return true;
      } catch {
        // process exited or pipe broken
        return false;
      }
    },
  };
};
