// coverage:ignore — network I/O and browser integration requiring system-level testing
/**
 * GUI HTTP server. Serves the interactive page at `/` and a
 * Server-Sent Events stream at `/events` for realtime workflow updates.
 *
 * Island .tsx files are compiled to browser JS via esbuild at startup
 * and served at `/islands/*.js`.
 *
 * @module
 */
import { App } from "@fresh/core";
import { renderToString } from "preact-render-to-string";
import type { AgentInputBus } from "./input-bus.ts";
import type { Logger } from "../types.ts";
import { createLogger } from "../logger.ts";
import type { StatusDiff } from "../status-diff.ts";
import { generateStatusHtml } from "../status-diff.ts";
import { tailLogDir, writeWorkerLine } from "./log-dir.ts";
import { MainPage } from "./pages/main-page.tsx";
import { WorkerPage } from "./pages/worker-page.tsx";
import type { GuiEvent } from "./events.ts";
import { type CompiledIslands, compileIslands } from "./dev.ts";

/** Returns the current spec-vs-progress status diff. */
export type StatusProvider = () => Promise<StatusDiff>;

export type GuiServerOptions = {
  readonly port: number;
  readonly log?: Logger;
  readonly signal?: AbortSignal;
  readonly agentInputBus?: AgentInputBus;
  readonly statusProvider?: StatusProvider;
  /** Skip island compilation (for unit tests that don't need client JS). */
  readonly skipBuild?: boolean;
};

const htmlResponse = (jsx: preact.VNode): Response =>
  new Response("<!DOCTYPE html>" + renderToString(jsx), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

/** Start the GUI HTTP server. Resolves when the server closes. */
export const startGuiServer = async (
  opts: GuiServerOptions,
): Promise<void> => {
  const { port, signal, agentInputBus, statusProvider } = opts;
  const log = opts.log ?? createLogger();

  // Compile island TypeScript to browser JS (unless skipped for unit tests).
  const islands: CompiledIslands = opts.skipBuild
    ? new Map()
    : await compileIslands();

  const app = new App();

  // GET /islands/:name — serve compiled island JS modules.
  app.get("/islands/:name", (ctx) => {
    const code = islands.get(ctx.params.name);
    return code
      ? new Response(code, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
        },
      })
      : new Response("not found", { status: 404 });
  });

  // POST /input/:workerId — send text to an active agent's stdin.
  // Returns JSON: { ok: true } or { ok: false, error: "..." }
  app.post("/input/:workerId", async (ctx) => {
    const workerId = decodeURIComponent(ctx.params.workerId);
    const text = await ctx.req.text();
    if (!agentInputBus) {
      return Response.json(
        { ok: false, error: "No input bus configured" },
        { status: 503 },
      );
    }
    const result = await agentInputBus.send(workerId, text + "\n");
    if (result.isOk()) {
      writeWorkerLine(workerId, {
        type: "log",
        level: "info",
        tags: ["user", "input"],
        message: text,
        ts: Date.now(),
        workerId,
      });
      return Response.json({ ok: true });
    }
    return Response.json(
      { ok: false, error: result.error.failureMessage },
      { status: 422 },
    );
  });

  // GET /events — SSE stream.
  app.get("/events", (_ctx) => {
    const clientAc = new AbortController();
    const clientSignal = clientAc.signal;
    signal?.addEventListener("abort", () => clientAc.abort(), { once: true });

    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        tailLogDir(
          (event: GuiEvent): void => {
            try {
              controller.enqueue(
                enc.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
            } catch {
              clientAc.abort();
            }
          },
          clientSignal,
        ).then(() => {
          try {
            controller.close();
          } catch { /* already closed */ }
        }).catch(() => {});
      },
      cancel(): void {
        clientAc.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });

  // GET /api/worker-log/:id
  app.get("/api/worker-log/:id", async (ctx) => {
    const id = ctx.params.id;
    try {
      const content = await Deno.readTextFile(
        `.ralph/worker-logs/worker-${id}.log`,
      );
      return new Response(content);
    } catch {
      return new Response("", { status: 200 });
    }
  });

  // GET /worker/:id — per-worker detail page
  app.get("/worker/:id", (_ctx) => htmlResponse(<WorkerPage />));

  // GET /api/status
  app.get("/api/status", async (_ctx) => {
    if (!statusProvider) {
      return Response.json({ specOnly: [], progressOnly: [], shared: [] });
    }
    try {
      return Response.json(await statusProvider());
    } catch {
      return Response.json({ error: "status unavailable" }, { status: 500 });
    }
  });

  // GET /status — HTML status page
  app.get("/status", async (_ctx) => {
    if (!statusProvider) {
      return new Response(
        "<html><body><p>No status provider configured.</p></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }
    try {
      return new Response(generateStatusHtml(await statusProvider()), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch {
      return new Response("<pre>Status unavailable</pre>", {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  });

  // GET / — main GUI page
  app.get("/", (_ctx) => htmlResponse(<MainPage />));

  const handler = await app.handler();
  const server = Deno.serve(
    { port, signal, onListen: (): void => {} },
    handler,
  );
  log({ tags: ["info"], message: `GUI available at http://localhost:${port}` });
  await server.finished;
};
