/**
 * End-to-end tests for the visual task graph GUI overhaul.
 *
 * Tests cover:
 * - Main page contains React Flow graph infrastructure
 * - Graph nodes for all orchestrator states exist in rendered HTML
 * - Tab switching elements (Graph/Log) present
 * - Worker modal infrastructure present
 * - SSE delivers merge_start and merge_done events
 * - Logger emits merge events from structured log messages
 * - Import map for React/xyflow present
 *
 * @module
 */

import { assert, assertEquals } from "jsr:@std/assert@^1.0.11";
import { startGuiServer } from "../src/gui/server.tsx";
import { createEventBus } from "../src/gui/events.ts";
import type { GuiEvent, GuiEventBus } from "../src/gui/events.ts";
import { createGuiLogger } from "../src/gui/logger.ts";
import { createAgentInputBus } from "../src/gui/input-bus.ts";
import { GUI_HTML } from "../src/gui/html.ts";

const BASE_PORT = 47450;
let portCounter = 0;
const nextPort = (): number => BASE_PORT + portCounter++;

const startServer = async (
  port: number,
  opts: { bus?: GuiEventBus } = {},
): Promise<{ ac: AbortController; done: Promise<void>; bus: GuiEventBus }> => {
  const ac = new AbortController();
  const bus = opts.bus ?? createEventBus();
  const done = startGuiServer({
    port,
    bus,
    signal: ac.signal,
    agentInputBus: createAgentInputBus(),
  });
  await new Promise<void>((r) => setTimeout(r, 80));
  return { ac, done, bus };
};

// ---------------------------------------------------------------------------
// Static HTML structure tests (no server needed)
// ---------------------------------------------------------------------------

Deno.test("GUI_HTML contains React Flow import map", () => {
  assert(GUI_HTML.includes("importmap"));
  assert(GUI_HTML.includes("@xyflow/react"));
  assert(GUI_HTML.includes("react"));
  assert(GUI_HTML.includes("react-dom/client"));
});

Deno.test("GUI_HTML contains graph-root mount point", () => {
  assert(GUI_HTML.includes('id="graph-root"'));
});

Deno.test("GUI_HTML contains tab switching elements", () => {
  assert(GUI_HTML.includes('data-tab="graph"'));
  assert(GUI_HTML.includes('data-tab="log"'));
  assert(GUI_HTML.includes("graph-panel"));
  assert(GUI_HTML.includes("log-panel"));
});

Deno.test("GUI_HTML contains React Flow graph module script", () => {
  assert(GUI_HTML.includes("ReactFlow"));
  assert(GUI_HTML.includes("createRoot"));
  assert(GUI_HTML.includes("graph-root"));
});

Deno.test("GUI_HTML contains orchestrator state node definitions", () => {
  const expectedStates = [
    "init",
    "reading_progress",
    "finding_actionable",
    "running_workers",
    "validating",
    "checking_doneness",
    "done",
    "aborted",
  ];
  for (const state of expectedStates) {
    assert(
      GUI_HTML.includes(`'${state}'`) || GUI_HTML.includes(`"${state}"`),
      `Expected state "${state}" in GUI_HTML`,
    );
  }
});

Deno.test("GUI_HTML contains worker node creation logic", () => {
  assert(GUI_HTML.includes("worker_active"));
  assert(GUI_HTML.includes("worker_done"));
  assert(GUI_HTML.includes("worker-"));
  assert(GUI_HTML.includes("merge"));
});

Deno.test("GUI_HTML contains merge event handling", () => {
  assert(GUI_HTML.includes("merge_start"));
  assert(GUI_HTML.includes("merge_done"));
});

Deno.test("GUI_HTML contains worker modal infrastructure", () => {
  assert(GUI_HTML.includes("worker-modal"));
  assert(GUI_HTML.includes("_openWorkerModal"));
  assert(GUI_HTML.includes("modal-overlay"));
  assert(GUI_HTML.includes("modal-content"));
  assert(GUI_HTML.includes("pop out"));
});

Deno.test("GUI_HTML contains xyflow CSS link", () => {
  assert(GUI_HTML.includes("@xyflow/react"));
  assert(GUI_HTML.includes("style.css"));
});

Deno.test("GUI_HTML contains pulse animation for active nodes", () => {
  assert(GUI_HTML.includes("@keyframes pulse"));
  assert(GUI_HTML.includes("animation"));
});

Deno.test("GUI_HTML graph module defines edge styles for done/active states", () => {
  assert(GUI_HTML.includes("edge-active") || GUI_HTML.includes("edgeStyle"));
  assert(GUI_HTML.includes("#16a34a")); // done green color
  assert(GUI_HTML.includes("#22c55e")); // accent green
  assert(GUI_HTML.includes("#a78bfa")); // loop purple
});

Deno.test("GUI_HTML graph module references smoothstep edge for loop-back", () => {
  assert(GUI_HTML.includes("smoothstep"));
  assert(GUI_HTML.includes("e-loop"));
});

// ---------------------------------------------------------------------------
// Logger merge event emission tests
// ---------------------------------------------------------------------------

Deno.test("createGuiLogger emits merge_start on merge log message", () => {
  const bus = createEventBus();
  const events: GuiEvent[] = [];
  bus.subscribe((e) => events.push(e));

  const logger = createGuiLogger(() => {}, bus);
  logger({
    tags: ["info", "orchestrator"],
    message: "Merging worker 0 (GUI.a)",
  });

  const mergeStartEvents = events.filter((e) => e.type === "merge_start");
  assertEquals(mergeStartEvents.length, 1);
  const ev = mergeStartEvents[0];
  assert(ev.type === "merge_start");
  assertEquals(ev.workerIndex, 0);
  assertEquals(ev.scenario, "GUI.a");
  assert(ev.ts > 0);
});

Deno.test("createGuiLogger emits merge_done with merged outcome", () => {
  const bus = createEventBus();
  const events: GuiEvent[] = [];
  bus.subscribe((e) => events.push(e));

  const logger = createGuiLogger(() => {}, bus);
  logger({
    tags: ["info", "orchestrator"],
    message: "Worker 1 merge: merged",
  });

  const mergeDoneEvents = events.filter((e) => e.type === "merge_done");
  assertEquals(mergeDoneEvents.length, 1);
  const ev = mergeDoneEvents[0];
  assert(ev.type === "merge_done");
  assertEquals(ev.workerIndex, 1);
  assertEquals(ev.outcome, "merged");
});

Deno.test("createGuiLogger emits merge_done with conflict outcome", () => {
  const bus = createEventBus();
  const events: GuiEvent[] = [];
  bus.subscribe((e) => events.push(e));

  const logger = createGuiLogger(() => {}, bus);
  logger({
    tags: ["info", "orchestrator"],
    message: "Worker 0 merge: conflict",
  });

  const mergeDoneEvents = events.filter((e) => e.type === "merge_done");
  assertEquals(mergeDoneEvents.length, 1);
  const ev = mergeDoneEvents[0];
  assert(ev.type === "merge_done");
  assertEquals(ev.outcome, "conflict");
});

Deno.test("createGuiLogger emits merge_done with no-changes outcome", () => {
  const bus = createEventBus();
  const events: GuiEvent[] = [];
  bus.subscribe((e) => events.push(e));

  const logger = createGuiLogger(() => {}, bus);
  logger({
    tags: ["info", "orchestrator"],
    message: "Worker 2 merge: no-changes",
  });

  const mergeDoneEvents = events.filter((e) => e.type === "merge_done");
  assertEquals(mergeDoneEvents.length, 1);
  const ev = mergeDoneEvents[0];
  assert(ev.type === "merge_done");
  assertEquals(ev.workerIndex, 2);
  assertEquals(ev.outcome, "no-changes");
});

Deno.test("createGuiLogger does not emit merge events for unrelated messages", () => {
  const bus = createEventBus();
  const events: GuiEvent[] = [];
  bus.subscribe((e) => events.push(e));

  const logger = createGuiLogger(() => {}, bus);
  logger({
    tags: ["info", "orchestrator"],
    message: "Something about merging but not a match",
  });

  const mergeEvents = events.filter((e) =>
    e.type === "merge_start" || e.type === "merge_done"
  );
  assertEquals(mergeEvents.length, 0);
});

// ---------------------------------------------------------------------------
// SSE e2e: merge events delivered to clients
// ---------------------------------------------------------------------------

Deno.test({
  name: "SSE /events delivers merge_start and merge_done events",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = nextPort();
    const bus = createEventBus();
    const { ac, done } = await startServer(port, { bus });

    const res = await fetch(`http://localhost:${port}/events`);
    assertEquals(res.status, 200);

    const body = res.body;
    if (!body) throw new Error("Expected response body");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const events: unknown[] = [];

    const emitTimer = setTimeout(() => {
      bus.emit({
        type: "merge_start",
        workerIndex: 0,
        scenario: "GUI.a",
        ts: Date.now(),
      });
      bus.emit({
        type: "merge_done",
        workerIndex: 0,
        outcome: "merged",
        ts: Date.now(),
      });
    }, 30);

    const deadline = Date.now() + 2000;
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

    clearTimeout(emitTimer);
    await reader.cancel();
    ac.abort();
    await done;

    const mergeStart = events.find(
      (e: unknown) => (e as { type: string }).type === "merge_start",
    ) as { type: string; workerIndex: number; scenario: string } | undefined;
    assert(mergeStart !== undefined, "Expected merge_start event");
    assertEquals(mergeStart?.workerIndex, 0);
    assertEquals(mergeStart?.scenario, "GUI.a");

    const mergeDone = events.find(
      (e: unknown) => (e as { type: string }).type === "merge_done",
    ) as
      | { type: string; workerIndex: number; outcome: string }
      | undefined;
    assert(mergeDone !== undefined, "Expected merge_done event");
    assertEquals(mergeDone?.workerIndex, 0);
    assertEquals(mergeDone?.outcome, "merged");
  },
});

// ---------------------------------------------------------------------------
// Full stack: logger → bus → SSE for merge events
// ---------------------------------------------------------------------------

Deno.test({
  name: "createGuiLogger merge log → SSE: full stack merge event delivery",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = nextPort();
    const bus = createEventBus();
    const { ac, done } = await startServer(port, { bus });

    const res = await fetch(`http://localhost:${port}/events`);
    const body = res.body;
    if (!body) throw new Error("Expected response body");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const events: unknown[] = [];

    const log = createGuiLogger(() => {}, bus);

    const emitTimer = setTimeout(() => {
      log({
        tags: ["info", "orchestrator"],
        message: "Merging worker 0 (GUI.a)",
      });
      log({
        tags: ["info", "orchestrator"],
        message: "Worker 0 merge: merged",
      });
    }, 30);

    const deadline = Date.now() + 2000;
    let buffer = "";
    // Expect: 2 log events + 1 merge_start + 1 merge_done = 4
    while (events.length < 4 && Date.now() < deadline) {
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

    const mergeStarts = events.filter(
      (e: unknown) => (e as { type: string }).type === "merge_start",
    );
    const mergeDones = events.filter(
      (e: unknown) => (e as { type: string }).type === "merge_done",
    );
    assertEquals(mergeStarts.length, 1, "Expected 1 merge_start event");
    assertEquals(mergeDones.length, 1, "Expected 1 merge_done event");
  },
});

// ---------------------------------------------------------------------------
// Server serves main page with graph infrastructure at /
// ---------------------------------------------------------------------------

Deno.test("GET / serves page with React Flow graph infrastructure", async () => {
  const port = nextPort();
  const { ac, done } = await startServer(port);

  const res = await fetch(`http://localhost:${port}/`);
  assertEquals(res.status, 200);
  const html = await res.text();

  // Verify key graph elements are present
  assert(html.includes("graph-root"), "Missing graph-root mount point");
  assert(html.includes("importmap"), "Missing import map");
  assert(html.includes("@xyflow/react"), "Missing xyflow import");
  assert(html.includes("ReactFlow"), "Missing ReactFlow component");
  assert(html.includes("tab-bar"), "Missing tab bar");

  ac.abort();
  await done;
});
