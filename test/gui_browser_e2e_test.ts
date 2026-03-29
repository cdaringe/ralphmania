// deno-lint-ignore-file no-undef triple-slash-reference
/// <reference lib="dom" />
/**
 * Browser-based end-to-end tests for the visual task graph GUI.
 *
 * Uses Puppeteer with a single shared browser instance and parallel pages
 * to verify the full GUI: graph rendering, tabs, SSE-driven state
 * transitions, worker/merge nodes, modal, sidebar, log panel, and layout.
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

// ---------------------------------------------------------------------------
// Shared browser — launched once, reused by all tests
// ---------------------------------------------------------------------------

let sharedBrowser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

async function getBrowser(): Promise<
  Awaited<ReturnType<typeof puppeteer.launch>>
> {
  if (!sharedBrowser) {
    sharedBrowser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return sharedBrowser;
}

interface TestContext {
  ac: AbortController;
  done: Promise<void>;
  port: number;
  page: Awaited<
    ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>
  >;
}

async function setup(): Promise<TestContext> {
  await initLogDir();
  const ac = new AbortController();
  const handle = await startGuiServer({
    port: 0,
    signal: ac.signal,
    agentInputBus: createAgentInputBus(),
  });
  const { port } = handle;
  const done = handle.finished;

  const browser = await getBrowser();
  const page = await browser.newPage();
  page.on(
    "console",
    (msg: { type: () => string; text: () => string }) =>
      console.log(`[browser:${msg.type()}] ${msg.text()}`),
  );
  page.on(
    "pageerror",
    (err: { message: string }) => console.log(`[browser:error] ${err.message}`),
  );
  await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });

  return { ac, done, port, page };
}

async function teardown(ctx: TestContext): Promise<void> {
  await ctx.page.close();
  ctx.ac.abort();
  await ctx.done.catch(() => {});
  await new Promise<void>((r) => setTimeout(r, 100));
}

// ---------------------------------------------------------------------------
// 1. Static graph rendering, tabs, and layout
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "browser: graph renders nodes/edges, init is active, tabs switch, layout fills viewport",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      await ctx.page.waitForSelector(".react-flow", { timeout: 15000 });

      // -- Nodes --
      const nodeIds = await ctx.page.evaluate(() => {
        const nodes = document.querySelectorAll(".react-flow__node");
        return Array.from(nodes).map((n) => n.getAttribute("data-id"));
      });
      for (
        const state of [
          "init",
          "reading_progress",
          "finding_actionable",
          "running_workers",
          "validating",
          "checking_doneness",
          "done",
          "aborted",
        ]
      ) {
        assert(
          nodeIds.includes(state),
          `Expected node "${state}" in graph, got: ${JSON.stringify(nodeIds)}`,
        );
      }

      // -- Edges --
      const edgeCount = await ctx.page.evaluate(() => {
        return document.querySelectorAll(".react-flow__edge").length;
      });
      assert(edgeCount >= 7, `Expected at least 7 edges, got ${edgeCount}`);

      // -- Init node is active (pulse animation) --
      const initNodeStyle = await ctx.page.evaluate(() => {
        const node = document.querySelector(
          '.react-flow__node[data-id="init"]',
        );
        if (!node) return null;
        const inner = node.querySelector(".react-flow__node-default") || node;
        return inner.getAttribute("style") || "";
      });
      assert(initNodeStyle !== null, "init node not found");
      assert(
        initNodeStyle.includes("animation") ||
          initNodeStyle.includes("pulse"),
        `Expected init node to have pulse animation, got style: ${initNodeStyle}`,
      );

      // -- Tab switching --
      const graphVisible = await ctx.page.evaluate(() => {
        const panel = document.getElementById("graph-panel");
        return panel?.classList.contains("active") ?? false;
      });
      assertEquals(
        graphVisible,
        true,
        "Graph panel should be active initially",
      );

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

      // -- Layout: app-root fills viewport --
      const heights = await ctx.page.evaluate(() => {
        const appRoot = document.getElementById("app-root");
        const vh = globalThis.innerHeight;
        return {
          appRootHeight: appRoot?.getBoundingClientRect().height ?? 0,
          viewportHeight: vh,
        };
      });
      assert(
        heights.appRootHeight >= heights.viewportHeight * 0.9,
        `app-root (${heights.appRootHeight}px) should fill viewport (${heights.viewportHeight}px)`,
      );
    } finally {
      await teardown(ctx);
    }
  },
});

// ---------------------------------------------------------------------------
// 2. SSE state transitions update the graph
// ---------------------------------------------------------------------------

Deno.test({
  name: "browser: state event updates active node, previous goes green",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      await ctx.page.waitForSelector(".react-flow", { timeout: 15000 });

      await writeOrchestratorEvent({
        type: "state",
        from: "init",
        to: "reading_progress",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 500));

      // reading_progress should be active
      const rpStyle = await ctx.page.evaluate(() => {
        const node = document.querySelector(
          '.react-flow__node[data-id="reading_progress"]',
        );
        if (!node) return "";
        const inner = node.querySelector(".react-flow__node-default") || node;
        return inner.getAttribute("style") || "";
      });
      assert(
        rpStyle.includes("animation") || rpStyle.includes("pulse") ||
          rpStyle.includes("34, 197, 94") || rpStyle.includes("#22c55e"),
        `Expected reading_progress to be active, got: ${rpStyle}`,
      );

      // init should be "done" (green)
      const initStyle = await ctx.page.evaluate(() => {
        const node = document.querySelector(
          '.react-flow__node[data-id="init"]',
        );
        if (!node) return "";
        const inner = node.querySelector(".react-flow__node-default") || node;
        return inner.getAttribute("style") || "";
      });
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
// 3. Worker lifecycle: active, done, merge, modal, inactive badge
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "browser: worker_active creates nodes, worker_done marks done, merge_start activates merge, modal opens with input, worker_done disables input",
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

      // -- Worker active events create nodes --
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
      await new Promise<void>((r) => setTimeout(r, 1000));

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

      // -- Click worker-0 node to open modal --
      const workerNode = await ctx.page.$(
        '.react-flow__node[data-id="worker-0"]',
      );
      assert(workerNode !== null, "Worker node not found");
      await workerNode.click();
      await new Promise<void>((r) => setTimeout(r, 500));

      const modalVisible = await ctx.page.evaluate(() => {
        const modal = document.getElementById("worker-modal");
        return modal && modal.style.display !== "none" &&
          modal.innerHTML.length > 0;
      });
      assert(modalVisible, "Expected worker modal to be visible after click");

      const modalContent = await ctx.page.evaluate(() => {
        const modal = document.getElementById("worker-modal");
        return modal?.textContent || "";
      });
      assert(
        modalContent.includes("GUI.a"),
        `Expected modal to contain scenario name, got: ${modalContent}`,
      );

      // Verify input is enabled while worker is running
      const enabledBefore = await ctx.page.evaluate(() => {
        const ta = document.querySelector(
          "#worker-modal textarea",
        ) as HTMLTextAreaElement | null;
        return ta ? !ta.disabled : null;
      });
      assertEquals(
        enabledBefore,
        true,
        "Input should be enabled while running",
      );

      // -- Merge start activates merge node --
      await writeOrchestratorEvent({
        type: "merge_start",
        workerIndex: 0,
        scenario: "GUI.a",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 500));

      const mergeStyle = await ctx.page.evaluate(() => {
        const node = document.querySelector(
          '.react-flow__node[data-id="merge"]',
        );
        if (!node) return "NOT_FOUND";
        const inner = node.querySelector(".react-flow__node-default") || node;
        return inner.getAttribute("style") || "";
      });
      assert(
        mergeStyle.includes("#fefce8") || mergeStyle.includes("#f59e0b") ||
          mergeStyle.includes("animation"),
        `Expected merge node to be active, got: ${mergeStyle}`,
      );

      // -- Worker done marks node as done and disables modal input --
      await writeOrchestratorEvent({
        type: "worker_done",
        workerIndex: 0,
        scenario: "GUI.a",
        ts: Date.now(),
      });
      await new Promise<void>((r) => setTimeout(r, 500));

      const workerStyle = await ctx.page.evaluate(() => {
        const node = document.querySelector(
          '.react-flow__node[data-id="worker-0"]',
        );
        if (!node) return "NOT_FOUND";
        const inner = node.querySelector(".react-flow__node-default") || node;
        return inner.getAttribute("style") || "";
      });
      assert(
        workerStyle.includes("#dcfce7") || workerStyle.includes("#16a34a") ||
          workerStyle.includes("220, 252, 231") ||
          workerStyle.includes("22, 163, 74"),
        `Expected worker-0 to have done styling, got: ${workerStyle}`,
      );

      const stateAfter = await ctx.page.evaluate(() => {
        const ta = document.querySelector(
          "#worker-modal textarea",
        ) as HTMLTextAreaElement | null;
        const badge = document.querySelector(".worker-status-badge");
        return {
          inputDisabled: ta?.disabled ?? null,
          hasBadge: badge !== null,
          badgeText: badge?.textContent ?? "",
        };
      });
      assertEquals(
        stateAfter.inputDisabled,
        true,
        "Input should be disabled after worker_done",
      );
      assert(stateAfter.hasBadge, "Should show inactive badge");
      assert(
        stateAfter.badgeText.includes("inactive"),
        `Badge should say inactive, got: ${stateAfter.badgeText}`,
      );
    } finally {
      await teardown(ctx);
    }
  },
});

// ---------------------------------------------------------------------------
// 4. Sidebar + log panel updates via SSE
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "browser: sidebar state-val and workers update on events, log panel shows messages",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctx = await setup();
    try {
      await ctx.page.waitForSelector("#state-val", { timeout: 5000 });

      // -- State updates sidebar --
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

      // -- Worker active updates sidebar workers list --
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

      // -- Log events appear in log panel --
      await ctx.page.click('[data-tab="log"]');
      await new Promise<void>((r) => setTimeout(r, 100));

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

// ---------------------------------------------------------------------------
// Cleanup: close shared browser after all tests
// ---------------------------------------------------------------------------

Deno.test({
  name: "browser: cleanup shared browser",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    if (sharedBrowser) {
      await sharedBrowser.close();
      sharedBrowser = null;
    }
  },
});
