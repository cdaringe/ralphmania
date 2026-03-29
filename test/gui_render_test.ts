/**
 * Integration tests for the GUI server serving pages and API endpoints.
 * Uses skipBuild (no esbuild) since pages are now static HTML shells.
 * Browser-level rendering is tested in gui_browser_e2e_test.ts.
 * @module
 */
import { assert, assertEquals } from "jsr:@std/assert@^1";
import { startGuiServer } from "../src/gui/server.tsx";
import { createAgentInputBus } from "../src/gui/input-bus.ts";
import { initLogDir } from "../src/gui/log-dir.ts";

const PORT = 48100;

Deno.test({
  name: "GET / serves HTML with island boot script",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initLogDir();
    const ac = new AbortController();
    const done = startGuiServer({
      port: PORT,
      signal: ac.signal,
      agentInputBus: createAgentInputBus(),
      skipBuild: true,
    });
    await new Promise<void>((r) => setTimeout(r, 80));

    const res = await fetch(`http://localhost:${PORT}/`);
    assertEquals(res.status, 200);
    const html = await res.text();
    assert(html.includes("ralphmania"), "Missing title");
    assert(html.includes("/islands/boot.js"), "Missing boot script");
    assert(html.includes("app-root"), "Missing app mount point");
    assert(html.includes("@xyflow/react"), "Missing xyflow CSS link");
    assert(html.includes("importmap"), "Missing import map");

    ac.abort();
    await done.catch(() => {});
  },
});

Deno.test({
  name: "GET /worker/:id serves HTML with worker boot script",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initLogDir();
    const ac = new AbortController();
    const done = startGuiServer({
      port: PORT + 1,
      signal: ac.signal,
      skipBuild: true,
    });
    await new Promise<void>((r) => setTimeout(r, 80));

    const res = await fetch(`http://localhost:${PORT + 1}/worker/0?scenario=T`);
    assertEquals(res.status, 200);
    const html = await res.text();
    assert(html.includes("ralphmania"), "Missing title");
    assert(html.includes("/islands/worker-boot.js"), "Missing worker boot");

    ac.abort();
    await done.catch(() => {});
  },
});
