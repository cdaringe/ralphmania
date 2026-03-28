/**
 * End-to-end integration tests for GUI.b: overall status display.
 *
 * Tests the full server stack using injected adapters (no real worktrees
 * or file I/O), verifying:
 * - /api/status returns JSON status diff
 * - /status returns full HTML status page
 * - Main page HTML contains the status section
 * - SSE /events delivers worker_active and worker_done events
 * - Status updates flow through the whole stack
 *
 * @module
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.11";
import { startGuiServer } from "../src/gui/server.ts";
import type { StatusProvider } from "../src/gui/server.ts";
import { createEventBus } from "../src/gui/events.ts";
import type { GuiEventBus } from "../src/gui/events.ts";
import { createAgentInputBus } from "../src/gui/input-bus.ts";
import type { StatusDiff } from "../src/status-diff.ts";

// Ports for e2e tests — chosen to avoid conflicts with other test servers
const BASE_PORT = 47210;
let portCounter = 0;
const nextPort = (): number => BASE_PORT + portCounter++;

/** Helper: create a StatusProvider that returns canned data. */
const stubStatusProvider = (diff: StatusDiff): StatusProvider => () =>
  Promise.resolve(diff);

/** Helper: create a failing StatusProvider. */
const failingStatusProvider = (): StatusProvider => () =>
  Promise.reject(new Error("disk error"));

/** Helper: start server, wait for listen, return cleanup. */
const startServer = async (
  port: number,
  opts: {
    statusProvider?: StatusProvider;
    bus?: GuiEventBus;
  } = {},
): Promise<{ ac: AbortController; done: Promise<void>; bus: GuiEventBus }> => {
  const ac = new AbortController();
  const bus = opts.bus ?? createEventBus();
  const done = startGuiServer({
    port,
    bus,
    signal: ac.signal,
    agentInputBus: createAgentInputBus(),
    statusProvider: opts.statusProvider,
  });
  // Wait for server to start listening
  await new Promise<void>((r) => setTimeout(r, 80));
  return { ac, done, bus };
};

// ---------------------------------------------------------------------------
// /api/status endpoint tests
// ---------------------------------------------------------------------------

Deno.test("GET /api/status returns JSON diff when provider is configured", async () => {
  const port = nextPort();
  const diff: StatusDiff = {
    specOnly: ["NEW.1"],
    progressOnly: ["OLD.1"],
    shared: [{ id: "A.1", status: "VERIFIED", summary: "done" }],
  };
  const { ac, done } = await startServer(port, {
    statusProvider: stubStatusProvider(diff),
  });

  const res = await fetch(`http://localhost:${port}/api/status`);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "application/json");
  const body = await res.json();
  assertEquals(body.specOnly, ["NEW.1"]);
  assertEquals(body.progressOnly, ["OLD.1"]);
  assertEquals(body.shared.length, 1);
  assertEquals(body.shared[0].id, "A.1");
  assertEquals(body.shared[0].status, "VERIFIED");

  ac.abort();
  await done;
});

Deno.test("GET /api/status returns empty diff when no provider", async () => {
  const port = nextPort();
  const { ac, done } = await startServer(port);

  const res = await fetch(`http://localhost:${port}/api/status`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.specOnly, []);
  assertEquals(body.shared, []);
  assertEquals(body.progressOnly, []);

  ac.abort();
  await done;
});

Deno.test("GET /api/status returns 500 when provider throws", async () => {
  const port = nextPort();
  const { ac, done } = await startServer(port, {
    statusProvider: failingStatusProvider(),
  });

  const res = await fetch(`http://localhost:${port}/api/status`);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "status unavailable");

  ac.abort();
  await done;
});

// ---------------------------------------------------------------------------
// /status HTML endpoint tests
// ---------------------------------------------------------------------------

Deno.test("GET /status returns HTML with status diff when provider configured", async () => {
  const port = nextPort();
  const diff: StatusDiff = {
    specOnly: ["B.2"],
    progressOnly: [],
    shared: [
      { id: "A.1", status: "VERIFIED", summary: "all good" },
      { id: "B.1", status: "NEEDS_REWORK", summary: "broken" },
    ],
  };
  const { ac, done } = await startServer(port, {
    statusProvider: stubStatusProvider(diff),
  });

  const res = await fetch(`http://localhost:${port}/status`);
  assertEquals(res.status, 200);
  assertStringIncludes(
    res.headers.get("content-type") ?? "",
    "text/html",
  );
  const html = await res.text();
  assertStringIncludes(html, "Overall Status");
  assertStringIncludes(html, "A.1");
  assertStringIncludes(html, "VERIFIED");
  assertStringIncludes(html, "B.1");
  assertStringIncludes(html, "NEEDS_REWORK");
  assertStringIncludes(html, "B.2");
  assertStringIncludes(html, "NOT_STARTED");
  assertStringIncludes(html, "1 / 3 verified");

  ac.abort();
  await done;
});

Deno.test("GET /status returns fallback HTML when no provider", async () => {
  const port = nextPort();
  const { ac, done } = await startServer(port);

  const res = await fetch(`http://localhost:${port}/status`);
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "No status provider");

  ac.abort();
  await done;
});

Deno.test("GET /status returns 500 when provider throws", async () => {
  const port = nextPort();
  const { ac, done } = await startServer(port, {
    statusProvider: failingStatusProvider(),
  });

  const res = await fetch(`http://localhost:${port}/status`);
  assertEquals(res.status, 500);
  const html = await res.text();
  assertStringIncludes(html, "Status unavailable");

  ac.abort();
  await done;
});

// ---------------------------------------------------------------------------
// Main page HTML contains status section
// ---------------------------------------------------------------------------

Deno.test("GET / returns HTML with status section and fetchStatus JS", async () => {
  const port = nextPort();
  const { ac, done } = await startServer(port, {
    statusProvider: stubStatusProvider({
      specOnly: [],
      progressOnly: [],
      shared: [],
    }),
  });

  const res = await fetch(`http://localhost:${port}/`);
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "status-summary");
  assertStringIncludes(html, "status-list");
  assertStringIncludes(html, "fetchStatus");
  assertStringIncludes(html, "/api/status");
  assertStringIncludes(html, "Progress");

  ac.abort();
  await done;
});

// ---------------------------------------------------------------------------
// SSE event delivery: worker_active and worker_done
// ---------------------------------------------------------------------------

Deno.test({
  name: "SSE /events delivers worker_active and worker_done events",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = nextPort();
    const bus = createEventBus();
    const { ac, done } = await startServer(port, { bus });

    // Connect to SSE
    const res = await fetch(`http://localhost:${port}/events`);
    assertEquals(res.status, 200);
    assertStringIncludes(
      res.headers.get("content-type") ?? "",
      "text/event-stream",
    );

    const body = res.body;
    if (!body) throw new Error("Expected response body");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const events: unknown[] = [];

    // Emit events on the bus after a tiny delay to ensure SSE client is subscribed
    const emitTimer = setTimeout(() => {
      bus.emit({
        type: "worker_active",
        workerIndex: 0,
        scenario: "GUI.b",
        ts: Date.now(),
      });
      bus.emit({
        type: "worker_done",
        workerIndex: 0,
        ts: Date.now(),
      });
      bus.emit({
        type: "state",
        from: "running_workers",
        to: "validating",
        ts: Date.now(),
      });
    }, 30);

    // Read SSE messages with a timeout
    const deadline = Date.now() + 2000;
    let buffer = "";
    while (events.length < 3 && Date.now() < deadline) {
      const timeoutId = { id: 0 };
      const { value, done: streamDone } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((r) => {
          timeoutId.id = setTimeout(
            () => r({ value: undefined, done: true }),
            500,
          );
        }),
      ]);
      clearTimeout(timeoutId.id);
      if (streamDone && !value) break;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const dataLine = line
            .split("\n")
            .find((l: string) => l.startsWith("data: "));
          if (dataLine) {
            events.push(JSON.parse(dataLine.slice(6)));
          }
        }
      }
    }

    clearTimeout(emitTimer);
    await reader.cancel();
    ac.abort();
    await done;

    // Verify events received
    assertEquals(
      events.length >= 2,
      true,
      `expected >= 2 events, got ${events.length}`,
    );
    const workerActive = events.find(
      (e: unknown) => (e as { type: string }).type === "worker_active",
    ) as
      | { type: string; workerIndex: number; scenario: string }
      | undefined;
    assertEquals(workerActive?.workerIndex, 0);
    assertEquals(workerActive?.scenario, "GUI.b");

    const workerDone = events.find(
      (e: unknown) => (e as { type: string }).type === "worker_done",
    ) as { type: string; workerIndex: number } | undefined;
    assertEquals(workerDone?.workerIndex, 0);
  },
});

// ---------------------------------------------------------------------------
// Integration: status updates on state change
// ---------------------------------------------------------------------------

Deno.test("status endpoint reflects updated data on re-fetch", async () => {
  const port = nextPort();
  let callCount = 0;
  const statusProvider: StatusProvider = () => {
    callCount++;
    return Promise.resolve({
      specOnly: callCount === 1 ? ["X.1"] : [],
      progressOnly: [],
      shared: callCount === 1
        ? []
        : [{ id: "X.1", status: "VERIFIED", summary: "done" }],
    });
  };
  const { ac, done } = await startServer(port, { statusProvider });

  // First fetch: X.1 is not started
  const res1 = await fetch(`http://localhost:${port}/api/status`);
  const body1 = await res1.json();
  assertEquals(body1.specOnly, ["X.1"]);
  assertEquals(body1.shared.length, 0);

  // Second fetch: X.1 is verified (simulating progress update)
  const res2 = await fetch(`http://localhost:${port}/api/status`);
  const body2 = await res2.json();
  assertEquals(body2.specOnly, []);
  assertEquals(body2.shared.length, 1);
  assertEquals(body2.shared[0].status, "VERIFIED");

  ac.abort();
  await done;
});

// ---------------------------------------------------------------------------
// Full orchestrator flow: logger emits worker events that reach SSE clients
// ---------------------------------------------------------------------------

Deno.test({
  name: "createGuiLogger emits worker_active events that SSE clients receive",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { createGuiLogger } = await import("../src/gui/logger.ts");
    const port = nextPort();
    const bus = createEventBus();
    const { ac, done } = await startServer(port, { bus });

    // Connect SSE
    const res = await fetch(`http://localhost:${port}/events`);
    const body = res.body;
    if (!body) throw new Error("Expected response body");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const events: unknown[] = [];

    // Create a GUI logger that emits to the bus
    const log = createGuiLogger(() => {}, bus);

    // Simulate the orchestrator logging a worker launch
    const emitTimer = setTimeout(() => {
      log({
        tags: ["info", "orchestrator"],
        message: "Round 0: launching 2 worker(s) for scenarios [GUI.b, GUI.c]",
      });
    }, 30);

    // Read events
    const deadline = Date.now() + 2000;
    let buffer = "";
    while (events.length < 3 && Date.now() < deadline) {
      const timeoutId = { id: 0 };
      const { value, done: streamDone } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((r) => {
          timeoutId.id = setTimeout(
            () => r({ value: undefined, done: true }),
            500,
          );
        }),
      ]);
      clearTimeout(timeoutId.id);
      if (streamDone && !value) break;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const dataLine = line
            .split("\n")
            .find((l: string) => l.startsWith("data: "));
          if (dataLine) {
            events.push(JSON.parse(dataLine.slice(6)));
          }
        }
      }
    }

    clearTimeout(emitTimer);
    await reader.cancel();
    ac.abort();
    await done;

    // Should have: 1 log event + 2 worker_active events
    const workerActives = events.filter(
      (e: unknown) => (e as { type: string }).type === "worker_active",
    ) as { type: string; workerIndex: number; scenario: string }[];
    assertEquals(workerActives.length, 2);
    assertEquals(workerActives[0].workerIndex, 0);
    assertEquals(workerActives[0].scenario, "GUI.b");
    assertEquals(workerActives[1].workerIndex, 1);
    assertEquals(workerActives[1].scenario, "GUI.c");
  },
});
