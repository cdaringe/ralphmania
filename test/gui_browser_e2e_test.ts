// deno-lint-ignore-file no-undef triple-slash-reference
/// <reference lib="dom" />
/**
 * Browser-based end-to-end tests for the visual task graph GUI.
 *
 * Uses Puppeteer to launch a real headless Chrome instance and verify:
 * - React Flow graph renders with all orchestrator state nodes
 * - Tab switching works (Graph/Log)
 * - State transitions highlight the correct node
 * - Dynamic worker nodes appear on worker_active events
 * - Worker nodes become clickable and open the modal
 * - Merge events update the merge node
 * - The loop-back edge exists
 *
 * @module
 */

import { assert, assertEquals } from "jsr:@std/assert@^1.0.11";
import puppeteer from "npm:puppeteer-core@23";
import { startGuiServer } from "../src/gui/server.tsx";
import { createAgentInputBus } from "../src/gui/input-bus.ts";
import { initLogDir, writeOrchestratorEvent } from "../src/gui/log-dir.ts";

const CHROME_PATH = `${
  Deno.env.get("HOME")
}/.cache/puppeteer/chrome/linux-147.0.7727.24/chrome-linux64/chrome`;

const BASE_PORT = 47350;
let portCounter = 0;
const nextPort = (): number => BASE_PORT + portCounter++;

interface TestContext {
  ac: AbortController;
  done: Promise<void>;
  port: number;
  browser: Awaited<ReturnType<typeof puppeteer.launch>>;
  page: Awaited<
    ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>
  >;
}

async function setup(): Promise<TestContext> {
  const port = nextPort();
  await initLogDir();
  const ac = new AbortController();
  const done = startGuiServer({
    port,
    signal: ac.signal,
    agentInputBus: createAgentInputBus(),
  });
  // Builder esbuild compilation + server startup needs time.
  await new Promise<void>((r) => setTimeout(r, 10000));

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  page.on("console", (msg: { type: () => string; text: () => string }) =>
    console.log(`[browser:${msg.type()}] ${msg.text()}`)
  );
  page.on("pageerror", (err: { message: string }) =>
    console.log(`[browser:error] ${err.message}`)
  );
  // Use 'load' not 'networkidle0' — SSE keeps the connection alive forever
  await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });

  return { ac, done, port, browser, page };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.page.close();
  await ctx.browser.close();
  ctx.ac.abort();
  await ctx.done.catch(() => {});
  // Wait for port + file watcher cleanup
  await new Promise<void>((r) => setTimeout(r, 200));
}

// ---------------------------------------------------------------------------
// Graph rendering
// ---------------------------------------------------------------------------

Deno.test({
  name: "browser: React Flow graph renders with orchestrator state nodes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      // Wait for React Flow to render (the .react-flow container)
      await ctx.page.waitForSelector(".react-flow", { timeout: 15000 });

      // Check that state nodes exist in the rendered graph
      // React Flow renders nodes as divs with data-id attributes
      const nodeIds = await ctx.page.evaluate(() => {
        const nodes = document.querySelectorAll(".react-flow__node");
        return Array.from(nodes).map((n) => n.getAttribute("data-id"));
      });

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
          nodeIds.includes(state),
          `Expected node "${state}" in graph, got: ${JSON.stringify(nodeIds)}`,
        );
      }
    } finally {
      await teardown(ctx);
    }
  },
});

Deno.test({
  name: "browser: Graph has edges connecting state nodes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      await ctx.page.waitForSelector(".react-flow", { timeout: 15000 });

      const edgeCount = await ctx.page.evaluate(() => {
        return document.querySelectorAll(".react-flow__edge").length;
      });

      // Should have at least the main chain edges + loop + abort
      assert(edgeCount >= 7, `Expected at least 7 edges, got ${edgeCount}`);
    } finally {
      await teardown(ctx);
    }
  },
});

Deno.test({
  name: "browser: init node is active by default (has pulse animation)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      await ctx.page.waitForSelector(".react-flow", { timeout: 15000 });

      // The init node should have the active styling (animation)
      const initNodeStyle = await ctx.page.evaluate(() => {
        const node = document.querySelector(
          '.react-flow__node[data-id="init"]',
        );
        if (!node) return null;
        const inner = node.querySelector(".react-flow__node-default") ||
          node;
        return inner.getAttribute("style") || "";
      });

      assert(initNodeStyle !== null, "init node not found");
      // Active nodes have the pulse animation in their inline style
      assert(
        initNodeStyle.includes("animation") ||
          initNodeStyle.includes("pulse"),
        `Expected init node to have pulse animation, got style: ${initNodeStyle}`,
      );
    } finally {
      await teardown(ctx);
    }
  },
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

Deno.test({
  name: "browser: Tab switching shows/hides Graph and Log panels",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      // Graph panel should be visible initially
      const graphVisible = await ctx.page.evaluate(() => {
        const panel = document.getElementById("graph-panel");
        return panel?.classList.contains("active") ?? false;
      });
      assertEquals(
        graphVisible,
        true,
        "Graph panel should be active initially",
      );

      // Click Log tab
      await ctx.page.click('[data-tab="log"]');
      await new Promise<void>((r) => setTimeout(r, 100));

      const afterLogClick = await ctx.page.evaluate(() => {
        const graph = document.getElementById("graph-panel");
        const log = document.getElementById("log-panel");
        return {
          graphActive: graph?.classList.contains("active") ?? false,
          logActive: log?.classList.contains("active") ?? false,
        };
      });
      assertEquals(
        afterLogClick.graphActive,
        false,
        "Graph should be hidden after Log click",
      );
      assertEquals(
        afterLogClick.logActive,
        true,
        "Log should be visible after Log click",
      );

      // Click Graph tab to switch back
      await ctx.page.click('[data-tab="graph"]');
      await new Promise<void>((r) => setTimeout(r, 100));

      const afterGraphClick = await ctx.page.evaluate(() => {
        const graph = document.getElementById("graph-panel");
        return graph?.classList.contains("active") ?? false;
      });
      assertEquals(
        afterGraphClick,
        true,
        "Graph should be visible after Graph click",
      );
    } finally {
      await teardown(ctx);
    }
  },
});

// ---------------------------------------------------------------------------
// State transitions via SSE
// ---------------------------------------------------------------------------

Deno.test({
  name: "browser: state event updates active node in graph",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      await ctx.page.waitForSelector(".react-flow", { timeout: 15000 });

      // Emit a state transition
      await writeOrchestratorEvent({
        type: "state",
        from: "init",
        to: "reading_progress",
        ts: Date.now(),
      });

      // Wait for the graph to update
      await new Promise<void>((r) => setTimeout(r, 500));

      // reading_progress node should now be active (have animation)
      const rpStyle = await ctx.page.evaluate(() => {
        const node = document.querySelector(
          '.react-flow__node[data-id="reading_progress"]',
        );
        if (!node) return "";
        const inner = node.querySelector(".react-flow__node-default") ||
          node;
        return inner.getAttribute("style") || "";
      });

      // Active nodes have animation or pulse in style, or green accent border
      assert(
        rpStyle.includes("animation") || rpStyle.includes("pulse") ||
          rpStyle.includes("34, 197, 94") || rpStyle.includes("#22c55e"),
        `Expected reading_progress to be active after state event, got: ${rpStyle}`,
      );

      // init node should be "done" styled (green)
      const initStyle = await ctx.page.evaluate(() => {
        const node = document.querySelector(
          '.react-flow__node[data-id="init"]',
        );
        if (!node) return "";
        const inner = node.querySelector(".react-flow__node-default") ||
          node;
        return inner.getAttribute("style") || "";
      });

      // Browser renders hex as rgb(), so check for both
      assert(
        initStyle.includes("#dcfce7") || initStyle.includes("#15803d") ||
          initStyle.includes("16a34a") ||
          initStyle.includes("220, 252, 231") ||
          initStyle.includes("22, 163, 74"),
        `Expected init node to have done styling (green), got: ${initStyle}`,
      );
    } finally {
      await teardown(ctx);
    }
  },
});

// ---------------------------------------------------------------------------
// Dynamic worker nodes
// ---------------------------------------------------------------------------

Deno.test({
  name: "browser: worker_active events create dynamic worker nodes in graph",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      await ctx.page.waitForSelector(".react-flow", { timeout: 15000 });

      // Transition to running_workers
      await writeOrchestratorEvent({
        type: "state",
        from: "finding_actionable",
        to: "running_workers",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 200));

      // Emit worker_active events
      await writeOrchestratorEvent({
        type: "worker_active",
        workerIndex: 0,
        scenario: "GUI.a",
        ts: Date.now(),
      });
      await writeOrchestratorEvent({
        type: "worker_active",
        workerIndex: 1,
        scenario: "GUI.b",
        ts: Date.now(),
      });

      // Wait for React to re-render
      await new Promise<void>((r) => setTimeout(r, 1000));

      // Check for worker nodes
      const nodeIds = await ctx.page.evaluate(() => {
        const nodes = document.querySelectorAll(".react-flow__node");
        return Array.from(nodes).map((n) => n.getAttribute("data-id"));
      });

      assert(
        nodeIds.includes("worker-0"),
        `Expected worker-0 node, got: ${JSON.stringify(nodeIds)}`,
      );
      assert(
        nodeIds.includes("worker-1"),
        `Expected worker-1 node, got: ${JSON.stringify(nodeIds)}`,
      );
      assert(
        nodeIds.includes("merge"),
        `Expected merge node, got: ${JSON.stringify(nodeIds)}`,
      );
    } finally {
      await teardown(ctx);
    }
  },
});

Deno.test({
  name: "browser: worker_done marks worker node as done",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      await ctx.page.waitForSelector(".react-flow", { timeout: 15000 });

      // Set up workers
      await writeOrchestratorEvent({
        type: "state",
        from: "finding_actionable",
        to: "running_workers",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 200));

      await writeOrchestratorEvent({
        type: "worker_active",
        workerIndex: 0,
        scenario: "TEST.1",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 500));

      // Complete the worker
      await writeOrchestratorEvent({
        type: "worker_done",
        workerIndex: 0,
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 500));

      // Worker node should have done styling (green background)
      const workerStyle = await ctx.page.evaluate(() => {
        const node = document.querySelector(
          '.react-flow__node[data-id="worker-0"]',
        );
        if (!node) return "NOT_FOUND";
        const inner = node.querySelector(".react-flow__node-default") ||
          node;
        return inner.getAttribute("style") || "";
      });

      assert(
        workerStyle.includes("#dcfce7") || workerStyle.includes("#16a34a") ||
          workerStyle.includes("220, 252, 231") ||
          workerStyle.includes("22, 163, 74"),
        `Expected worker-0 to have done styling, got: ${workerStyle}`,
      );
    } finally {
      await teardown(ctx);
    }
  },
});

// ---------------------------------------------------------------------------
// Merge events
// ---------------------------------------------------------------------------

Deno.test({
  name: "browser: merge_start activates merge node",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      await ctx.page.waitForSelector(".react-flow", { timeout: 15000 });

      // Set up workers
      await writeOrchestratorEvent({
        type: "state",
        from: "finding_actionable",
        to: "running_workers",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 200));

      await writeOrchestratorEvent({
        type: "worker_active",
        workerIndex: 0,
        scenario: "M.1",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 500));

      // Start merge
      await writeOrchestratorEvent({
        type: "merge_start",
        workerIndex: 0,
        scenario: "M.1",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 500));

      // Merge node should be active (amber/pulsing)
      const mergeStyle = await ctx.page.evaluate(() => {
        const node = document.querySelector(
          '.react-flow__node[data-id="merge"]',
        );
        if (!node) return "NOT_FOUND";
        const inner = node.querySelector(".react-flow__node-default") ||
          node;
        return inner.getAttribute("style") || "";
      });

      assert(
        mergeStyle.includes("#fefce8") || mergeStyle.includes("#f59e0b") ||
          mergeStyle.includes("animation"),
        `Expected merge node to be active, got: ${mergeStyle}`,
      );
    } finally {
      await teardown(ctx);
    }
  },
});

// ---------------------------------------------------------------------------
// Worker modal
// ---------------------------------------------------------------------------

Deno.test({
  name: "browser: clicking worker node opens modal",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      await ctx.page.waitForSelector(".react-flow", { timeout: 15000 });

      // Set up a worker
      await writeOrchestratorEvent({
        type: "state",
        from: "finding_actionable",
        to: "running_workers",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 200));

      await writeOrchestratorEvent({
        type: "worker_active",
        workerIndex: 0,
        scenario: "MODAL.1",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 1000));

      // Click the worker node
      const workerNode = await ctx.page.$(
        '.react-flow__node[data-id="worker-0"]',
      );
      assert(workerNode !== null, "Worker node not found");
      await workerNode.click();
      await new Promise<void>((r) => setTimeout(r, 500));

      // Modal should be visible
      const modalVisible = await ctx.page.evaluate(() => {
        const modal = document.getElementById("worker-modal");
        return modal && modal.style.display !== "none" &&
          modal.innerHTML.length > 0;
      });

      assert(modalVisible, "Expected worker modal to be visible after click");

      // Modal should contain the worker info
      const modalContent = await ctx.page.evaluate(() => {
        const modal = document.getElementById("worker-modal");
        return modal?.textContent || "";
      });

      assert(
        modalContent.includes("MODAL.1"),
        `Expected modal to contain scenario name, got: ${modalContent}`,
      );
    } finally {
      await teardown(ctx);
    }
  },
});

// ---------------------------------------------------------------------------
// Sidebar updates
// ---------------------------------------------------------------------------

Deno.test({
  name: "browser: sidebar state-val updates on state events",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      await ctx.page.waitForSelector("#state-val", { timeout: 5000 });

      await writeOrchestratorEvent({
        type: "state",
        from: "init",
        to: "finding_actionable",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 300));

      const stateText = await ctx.page.evaluate(() => {
        return document.getElementById("state-val")?.textContent || "";
      });

      assertEquals(stateText, "finding_actionable");
    } finally {
      await teardown(ctx);
    }
  },
});

Deno.test({
  name: "browser: sidebar workers list updates on worker_active",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      await ctx.page.waitForSelector("#workers", { timeout: 5000 });

      await writeOrchestratorEvent({
        type: "worker_active",
        workerIndex: 0,
        scenario: "SIDE.1",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 300));

      const workersHtml = await ctx.page.evaluate(() => {
        return document.getElementById("workers")?.innerHTML || "";
      });

      assert(workersHtml.includes("W0"), "Expected W0 in sidebar workers");
      assert(
        workersHtml.includes("SIDE.1"),
        "Expected scenario in sidebar workers",
      );
    } finally {
      await teardown(ctx);
    }
  },
});

// ---------------------------------------------------------------------------
// Log panel
// ---------------------------------------------------------------------------

Deno.test({
  name: "browser: log events appear in log panel",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      // Switch to log tab
      await ctx.page.click('[data-tab="log"]');
      await new Promise<void>((r) => setTimeout(r, 100));

      // Emit a log event
      await writeOrchestratorEvent({
        type: "log",
        level: "info",
        tags: ["info", "orchestrator"],
        message: "browser test log message",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 300));

      const logContent = await ctx.page.evaluate(() => {
        return document.getElementById("log")?.textContent || "";
      });

      assert(
        logContent.includes("browser test log message"),
        `Expected log message in log panel, got: ${
          logContent.substring(0, 200)
        }`,
      );
    } finally {
      await teardown(ctx);
    }
  },
});
