/**
 * End-to-end tests for the visual task graph GUI.
 *
 * Tests cover:
 * - Server serves pages with graph infrastructure
 * - SSE delivers merge_start and merge_done events
 * - Logger emits merge events from structured log messages
 *
 * @module
 */

import { assert, assertEquals } from "jsr:@std/assert@^1.0.11";
import { startGuiServer } from "../src/gui/server.tsx";
import { createEventBus } from "../src/gui/events.ts";
import type { GuiEvent } from "../src/gui/events.ts";
import { createGuiLogger } from "../src/gui/logger.ts";
import { createAgentInputBus } from "../src/gui/input-bus.ts";
import { initLogDir, writeOrchestratorEvent } from "../src/gui/log-dir.ts";

const BASE_PORT = 47450;
let portCounter = 0;
const nextPort = (): number => BASE_PORT + portCounter++;

const startServer = async (
  port: number,
): Promise<{ ac: AbortController; done: Promise<void> }> => {
  await initLogDir();
  const ac = new AbortController();
  const done = startGuiServer({
    port,
    signal: ac.signal,
    agentInputBus: createAgentInputBus(),
    skipBuild: true,
  });
  await new Promise<void>((r) => setTimeout(r, 80));
  return { ac, done };
};

// ---------------------------------------------------------------------------
// Island source file existence tests (replaces static HTML tests)
// ---------------------------------------------------------------------------

Deno.test("Island files exist for all GUI components", async () => {
  const islands = [
    "event-store.ts",
    "sse-provider.tsx",
    "connection-status.tsx",
    "log-panel.tsx",
    "sidebar.tsx",
    "tab-switcher.tsx",
    "workflow-graph.tsx",
    "worker-modal.tsx",
    "worker-page-app.tsx",
  ];
  for (const name of islands) {
    const stat = await Deno.stat(`src/gui/islands/${name}`).catch(() => null);
    assert(stat !== null, `Missing island: src/gui/islands/${name}`);
  }
});

Deno.test("workflow-graph.tsx contains all orchestrator states", async () => {
  const src = await Deno.readTextFile("src/gui/islands/workflow-graph.tsx");
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
    assert(src.includes(state), `Missing state "${state}" in workflow-graph`);
  }
});

Deno.test("workflow-graph.tsx handles worker and merge events", async () => {
  const src = await Deno.readTextFile("src/gui/islands/workflow-graph.tsx");
  assert(src.includes("worker_active") || src.includes("getActiveWorkers"));
  assert(src.includes("merge"));
  assert(src.includes("smoothstep"));
});

Deno.test("main-page.tsx has no dangerouslySetInnerHTML script tags", async () => {
  const src = await Deno.readTextFile("src/gui/pages/main-page.tsx");
  assert(!src.includes("MAIN_PAGE_VANILLA_SCRIPT"));
  assert(!src.includes("GRAPH_MODULE_SCRIPT"));
  assert(!src.includes("WORKER_PAGE_SCRIPT"));
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
  name: "SSE /events delivers merge events written to log file",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = nextPort();
    const { ac, done } = await startServer(port);

    const res = await fetch(`http://localhost:${port}/events`);
    assertEquals(res.status, 200);

    const body = res.body;
    if (!body) throw new Error("Expected response body");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const events: unknown[] = [];

    setTimeout(async () => {
      await writeOrchestratorEvent({
        type: "merge_start",
        workerIndex: 0,
        scenario: "GUI.a",
        ts: Date.now(),
      });
      await writeOrchestratorEvent({
        type: "merge_done",
        workerIndex: 0,
        outcome: "merged",
        ts: Date.now(),
      });
    }, 200);

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
// Server serves main page at /
// ---------------------------------------------------------------------------

Deno.test({
  name: "GET / serves page with graph infrastructure",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = nextPort();
    const { ac, done } = await startServer(port);

    const res = await fetch(`http://localhost:${port}/`);
    assertEquals(res.status, 200);
    const html = await res.text();

    assert(html.includes("ralphmania"), "Missing title");
    assert(html.includes("app-root"), "Missing app mount point");
    assert(html.includes("/islands/boot.js"), "Missing boot script");

    ac.abort();
    await done;
  },
});
