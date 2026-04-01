import { assert, assertEquals } from "jsr:@std/assert@^1";
import * as path from "jsr:@std/path@^1";
import { publishContainedGui } from "../src/gui/publish.ts";

Deno.test({
  name: "publish GUI artifacts serve end-to-end as static site",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const outDir = await Deno.makeTempDir({ prefix: "gui-publish-e2e-" });
    const publish = await publishContainedGui({ outDir });
    assert(
      publish.isOk(),
      publish.isErr() ? publish.error : "expected ok publish result",
    );

    const ac = new AbortController();
    const server = Deno.serve({
      port: 0,
      signal: ac.signal,
      onListen: () => {},
    }, async (req) => {
      const url = new URL(req.url);
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = path.join(outDir, pathname.slice(1));
      try {
        const content = await Deno.readTextFile(filePath);
        return new Response(content, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      } catch {
        return new Response("not found", { status: 404 });
      }
    });

    try {
      const port = server.addr.port;
      const indexRes = await fetch(`http://localhost:${port}/`);
      assertEquals(indexRes.status, 200);
      const indexHtml = await indexRes.text();
      assert(indexHtml.includes("ralphmania · live"));
      assert(indexHtml.includes('<script type="module">'));

      const workerRes = await fetch(`http://localhost:${port}/worker.html`);
      assertEquals(workerRes.status, 200);
      const workerHtml = await workerRes.text();
      assert(workerHtml.includes("ralphmania · worker"));

      const scenarioRes = await fetch(`http://localhost:${port}/scenario.html`);
      assertEquals(scenarioRes.status, 200);
      const scenarioHtml = await scenarioRes.text();
      assert(scenarioHtml.includes("ralphmania · scenario"));

      const missRes = await fetch(`http://localhost:${port}/missing.html`);
      assertEquals(missRes.status, 404);
    } finally {
      ac.abort();
      await server.finished.catch(() => {});
      await Deno.remove(outDir, { recursive: true }).catch(() => {});
    }
  },
});
