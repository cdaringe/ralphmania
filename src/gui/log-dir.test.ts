/**
 * Integration tests for log-dir tailOrchestratorLog and tailWorkerLog.
 *
 * Verifies GUI.g: the default SSE stream tails only the orchestrator log,
 * and worker logs are tailed on demand via a separate function.
 */
import { assertEquals } from "jsr:@std/assert@^1";
import {
  tailOrchestratorLog,
  tailWorkerLog,
  writeOrchestratorEvent,
  writeWorkerLine,
} from "./log-dir.ts";
import type { GuiEvent } from "./events.ts";

const makeLogEvent = (msg: string, workerId?: string): GuiEvent => ({
  type: "log",
  level: "info",
  tags: ["info"],
  message: msg,
  ts: Date.now(),
  ...(workerId !== undefined ? { workerId } : {}),
});

/**
 * Run `tail` until the abort signal fires, collecting events.
 * `writerFn` is called after the tail starts so we capture live writes.
 */
const collectTail = async (
  tail: (
    onEvent: (e: GuiEvent) => void,
    signal: AbortSignal,
  ) => Promise<void>,
  writerFn: () => Promise<void>,
  waitMs = 600,
): Promise<GuiEvent[]> => {
  const collected: GuiEvent[] = [];
  const ac = new AbortController();
  const tailPromise = tail((e) => collected.push(e), ac.signal);
  await writerFn();
  await new Promise<void>((r) => setTimeout(r, waitMs));
  ac.abort();
  await tailPromise;
  return collected;
};

Deno.test(
  "tailOrchestratorLog: receives orchestrator events, ignores worker logs",
  async () => {
    const workerId = `test-orch-${Date.now()}`;
    const orcEvent = makeLogEvent("orchestrator message");
    const workerEvent = makeLogEvent("worker message", workerId);

    const collected = await collectTail(
      tailOrchestratorLog,
      async () => {
        await writeOrchestratorEvent(orcEvent);
        await writeWorkerLine(workerId, workerEvent);
      },
    );

    // Must contain the orchestrator event
    assertEquals(
      collected.some((e) =>
        e.type === "log" && e.message === "orchestrator message"
      ),
      true,
      "orchestrator event should be present",
    );
    // Must NOT contain the worker event
    assertEquals(
      collected.some((e) => e.type === "log" && e.message === "worker message"),
      false,
      "worker event must not appear in orchestrator-only stream",
    );
  },
);

Deno.test(
  "tailWorkerLog: receives only that worker's events",
  async () => {
    const workerId = `test-worker-${Date.now()}`;
    const otherWorkerId = `test-other-${Date.now()}`;
    const targetEvent = makeLogEvent("target worker log", workerId);
    const otherEvent = makeLogEvent("other worker log", otherWorkerId);

    const collected = await collectTail(
      (onEvent, sig) => tailWorkerLog(workerId, onEvent, sig),
      async () => {
        await writeWorkerLine(workerId, targetEvent);
        await writeWorkerLine(otherWorkerId, otherEvent);
      },
    );

    assertEquals(
      collected.some((e) =>
        e.type === "log" && e.message === "target worker log"
      ),
      true,
      "should receive events for the targeted worker",
    );
    assertEquals(
      collected.some((e) =>
        e.type === "log" && e.message === "other worker log"
      ),
      false,
      "must not receive events from a different worker",
    );
  },
);

Deno.test(
  "tailWorkerLog: replays existing content on connect (snapshot)",
  async () => {
    const workerId = `test-snapshot-${Date.now()}`;
    const existing = makeLogEvent("pre-existing log line", workerId);

    // Write before tailing starts — simulates historical content.
    await writeWorkerLine(workerId, existing);

    const collected: GuiEvent[] = [];
    const ac = new AbortController();
    let snapshotFired = false;
    const tailPromise = tailWorkerLog(
      workerId,
      (e) => collected.push(e),
      ac.signal,
      () => {
        snapshotFired = true;
      },
    );

    // Give the initial replay time to complete.
    await new Promise<void>((r) => setTimeout(r, 400));
    ac.abort();
    await tailPromise;

    assertEquals(snapshotFired, true, "onSnapshotComplete should have fired");
    assertEquals(
      collected.some((e) =>
        e.type === "log" && e.message === "pre-existing log line"
      ),
      true,
      "historical content must be replayed",
    );
  },
);

Deno.test(
  "tailOrchestratorLog: stops tailing when signal is aborted",
  async () => {
    const ac = new AbortController();
    const collected: GuiEvent[] = [];
    const tailPromise = tailOrchestratorLog(
      (e) => collected.push(e),
      ac.signal,
    );

    ac.abort();

    // Should resolve promptly after abort. Use a cancellable timeout so no
    // timer leaks when the tail resolves first.
    let timeoutId: number | undefined;
    const timeout = new Promise<"timeout">((r) => {
      timeoutId = setTimeout(() => r("timeout"), 2000) as unknown as number;
    });

    const raceResult = await Promise.race([
      tailPromise.then(() => {
        clearTimeout(timeoutId);
        return "done" as const;
      }),
      timeout,
    ]);
    clearTimeout(timeoutId);
    assertEquals(raceResult, "done", "tail should stop when signal is aborted");
  },
);
