/**
 * End-to-end integration tests for GUI.b: overall status display.
 *
 * Tests the full server stack using injected adapters (no real worktrees
 * or file I/O), verifying:
 * - /api/status returns JSON status diff
 * - /status returns full HTML status page
 * - Main page HTML contains the status section
 * - SSE /events delivers events written to log files
 * - Status updates flow through the whole stack
 *
 * @module
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.11";
import { startGuiServer } from "../src/gui/server.tsx";
import type { StatusProvider } from "../src/gui/server.tsx";
import { createAgentInputBus } from "../src/gui/input-bus.ts";
import { initLogDir, writeOrchestratorEvent } from "../src/gui/log-dir.ts";
import type { StatusDiff } from "../src/status-diff.ts";

/** Helper: create a StatusProvider that returns canned data. */
const stubStatusProvider = (diff: StatusDiff): StatusProvider => () =>
  Promise.resolve(diff);

/** Helper: create a failing StatusProvider. */
const failingStatusProvider = (): StatusProvider => () =>
  Promise.reject(new Error("disk error"));

/** Helper: start server, return cleanup. */
const startServer = async (
  opts: {
    statusProvider?: StatusProvider;
  } = {},
): Promise<{ ac: AbortController; done: Promise<void>; port: number }> => {
  await initLogDir();
  const ac = new AbortController();
  const handle = await startGuiServer({
    port: 0,
    signal: ac.signal,
    agentInputBus: createAgentInputBus(),
    statusProvider: opts.statusProvider,
  });
  return { ac, done: handle.finished, port: handle.port };
};

// ---------------------------------------------------------------------------
// /api/status endpoint tests
// ---------------------------------------------------------------------------

Deno.test("GET /api/status returns JSON diff when provider is configured", async () => {
  const diff: StatusDiff = {
    specOnly: ["NEW.1"],
    progressOnly: ["OLD.1"],
    shared: [{ id: "A.1", status: "VERIFIED", summary: "done" }],
  };
  const { ac, done, port } = await startServer({
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
  const { ac, done, port } = await startServer();

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
  const { ac, done, port } = await startServer({
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
  const diff: StatusDiff = {
    specOnly: ["B.2"],
    progressOnly: [],
    shared: [
      { id: "A.1", status: "VERIFIED", summary: "all good" },
      { id: "B.1", status: "NEEDS_REWORK", summary: "broken" },
    ],
  };
  const { ac, done, port } = await startServer({
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
  const { ac, done, port } = await startServer();

  const res = await fetch(`http://localhost:${port}/status`);
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "No status provider");

  ac.abort();
  await done;
});

Deno.test("GET /status returns 500 when provider throws", async () => {
  const { ac, done, port } = await startServer({
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

Deno.test("GET / returns HTML shell with app-root and boot island", async () => {
  const { ac, done, port } = await startServer({
    statusProvider: stubStatusProvider({
      specOnly: [],
      progressOnly: [],
      shared: [],
    }),
  });

  const res = await fetch(`http://localhost:${port}/`);
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "app-root");
  assertStringIncludes(html, "/islands/boot.js");
  assertStringIncludes(html, "ralphmania");

  ac.abort();
  await done;
});

// ---------------------------------------------------------------------------
// SSE event delivery via file tailing
// ---------------------------------------------------------------------------

Deno.test({
  name: "SSE /events delivers events written to orchestrator log file",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initLogDir();
    const { ac, done, port } = await startServer();

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

    // Write events to the log file (file watcher delivers them)
    setTimeout(async () => {
      await writeOrchestratorEvent({
        type: "worker_active",
        workerIndex: 0,
        scenario: "GUI.b",
        ts: Date.now(),
      });
      await writeOrchestratorEvent({
        type: "worker_done",
        workerIndex: 0,
        ts: Date.now(),
      });
    }, 200);

    // Read SSE messages with a timeout
    const deadline = Date.now() + 3000;
    let buffer = "";
    while (events.length < 2 && Date.now() < deadline) {
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

    await reader.cancel();
    ac.abort();
    await done;

    // Verify events received
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

Deno.test({
  name: "status endpoint reflects updated data on re-fetch",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
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
    const { ac, done, port } = await startServer({ statusProvider });

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
  },
});
