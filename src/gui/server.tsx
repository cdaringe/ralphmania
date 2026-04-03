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
import { extname } from "jsr:@std/path@1";
import { renderToString } from "preact-render-to-string";
import type { AgentInputBus } from "./input-bus.ts";
import type { Logger } from "../types.ts";
import { createLogger } from "../logger.ts";
import type { ScenarioDetail, StatusDiff } from "../status-diff.ts";
import { generateStatusHtml } from "../status-diff.ts";
import { tailLogDir, writeWorkerLine } from "./log-dir.ts";
import { MainPage } from "./pages/main-page.tsx";
import { ScenarioPage } from "./pages/scenario-page.tsx";
import { WorkerPage } from "./pages/worker-page.tsx";
import type { GuiEvent } from "./events.ts";
import { type CompiledIslands, compileIslands } from "./dev.ts";
import { loadCssFiles } from "./css.ts";

/** Returns the current spec-vs-progress status diff. */
export type StatusProvider = () => Promise<StatusDiff>;

/** Returns full detail for a single scenario by ID. */
export type ScenarioDetailProvider = (
  id: string,
) => Promise<ScenarioDetail | undefined>;

/** Applies a status + rework-notes update to a single progress row. */
export type ProgressRowUpdater = (update: {
  readonly scenarioId: string;
  readonly status: string;
  readonly reworkNotes: string;
}) => Promise<{ ok: true } | { ok: false; error: string }>;

export type GuiServerOptions = {
  readonly port: number;
  readonly log?: Logger;
  readonly signal?: AbortSignal;
  readonly agentInputBus?: AgentInputBus;
  readonly statusProvider?: StatusProvider;
  readonly scenarioDetailProvider?: ScenarioDetailProvider;
  readonly progressRowUpdater?: ProgressRowUpdater;
  /** Skip island compilation (for unit tests that don't need client JS). */
  readonly skipBuild?: boolean;
};

const htmlResponse = (jsx: preact.VNode): Response =>
  new Response("<!DOCTYPE html>" + renderToString(jsx), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

const ALLOWED_STATUSES = new Set([
  "WIP",
  "WORK_COMPLETE",
  "VERIFIED",
  "NEEDS_REWORK",
  "OBSOLETE",
]);

export type GuiServerHandle = {
  /** The actual port the server is listening on. */
  readonly port: number;
  /** Resolves when the server closes. */
  readonly finished: Promise<void>;
};

/** Compute a short content hash for cache-busting asset URLs. */
const computeBuildHash = async (
  ...maps: ReadonlyMap<string, string>[]
): Promise<string> => {
  const parts = maps.flatMap((m) => [...m.values()]);
  const data = new TextEncoder().encode(parts.join(""));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/** Start the GUI HTTP server. Returns the bound port and a finish promise. */
export const startGuiServer = async (
  opts: GuiServerOptions,
): Promise<GuiServerHandle> => {
  const {
    port,
    signal,
    agentInputBus,
    statusProvider,
    scenarioDetailProvider,
    progressRowUpdater,
  } = opts;
  const log = opts.log ?? createLogger();

  // Compile island TypeScript to browser JS (unless skipped for unit tests).
  const islands: CompiledIslands = opts.skipBuild
    ? new Map()
    : await compileIslands();

  // Load CSS files from disk.
  const cssFiles = opts.skipBuild
    ? new Map<string, string>()
    : await loadCssFiles();

  // Build hash for cache-busting asset URLs.
  const buildHash = opts.skipBuild
    ? ""
    : await computeBuildHash(islands, cssFiles);

  const app = new App();

  // Cache-control for compiled assets: immutable for the lifetime of
  // this server process (content is compiled once at startup, the build
  // hash in the query string busts the cache on restart).
  const assetCache = buildHash
    ? "public, max-age=86400, immutable"
    : "no-cache";

  // GET /css/:name — serve CSS files.
  app.get("/css/:name", (ctx) => {
    const content = cssFiles.get(ctx.params.name);
    return content
      ? new Response(content, {
        headers: {
          "content-type": "text/css; charset=utf-8",
          "cache-control": assetCache,
        },
      })
      : new Response("not found", { status: 404 });
  });

  // GET /islands/:name — serve compiled island JS modules.
  app.get("/islands/:name", (ctx) => {
    const code = islands.get(ctx.params.name);
    return code
      ? new Response(code, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": assetCache,
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

  // GET /events — SSE stream backed by tailing .ralph/worker-logs/*.log.
  // Each new connection receives:
  // 1. a full replay of current log-backed GUI state/history
  // 2. one transport marker indicating initial sync is complete
  // 3. live incremental events going forward
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
          (): void => {
            try {
              controller.enqueue(
                enc.encode(": initial_sync_complete\n\n"),
              );
            } catch {
              clientAc.abort();
            }
          },
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

  // GET /api/scenario/:id — full detail for a single scenario.
  app.get("/api/scenario/:id", async (ctx) => {
    const id = decodeURIComponent(ctx.params.id);
    if (!scenarioDetailProvider) {
      return Response.json(
        { error: "No scenario detail provider configured" },
        { status: 503 },
      );
    }
    try {
      const detail = await scenarioDetailProvider(id);
      return detail
        ? Response.json(detail)
        : Response.json({ error: "Scenario not found" }, { status: 404 });
    } catch {
      return Response.json(
        { error: "Failed to load scenario detail" },
        { status: 500 },
      );
    }
  });

  // PATCH /api/scenario/:id — update status + rework notes for one scenario.
  app.patch("/api/scenario/:id", async (ctx) => {
    const scenarioId = decodeURIComponent(ctx.params.id);
    if (!progressRowUpdater) {
      return Response.json(
        { ok: false, error: "No progress updater configured" },
        { status: 503 },
      );
    }
    try {
      const body = await ctx.req.json();
      const status = typeof body.status === "string"
        ? body.status.trim().toUpperCase()
        : "";
      const reworkNotesRaw = typeof body.reworkNotes === "string"
        ? body.reworkNotes
        : "";
      if (!status) {
        return Response.json(
          { ok: false, error: "status is required" },
          { status: 400 },
        );
      }
      if (!ALLOWED_STATUSES.has(status)) {
        return Response.json(
          { ok: false, error: "invalid status" },
          { status: 400 },
        );
      }
      const reworkNotes = status === "OBSOLETE"
        ? ""
        : reworkNotesRaw.replace(/\s+/g, " ").trim();
      if (status === "NEEDS_REWORK" && reworkNotes.length === 0) {
        return Response.json(
          { ok: false, error: "reworkNotes required for NEEDS_REWORK" },
          { status: 400 },
        );
      }
      const result = await progressRowUpdater({
        scenarioId,
        status,
        reworkNotes,
      });
      return result.ok ? Response.json({ ok: true }) : Response.json(
        { ok: false, error: result.error },
        { status: 422 },
      );
    } catch {
      return Response.json(
        { ok: false, error: "Failed to update scenario" },
        { status: 500 },
      );
    }
  });

  // GET /docs/* — serve project doc files so summary links resolve.
  app.get("/docs/:path*", async (ctx) => {
    const docsMime: Record<string, string> = {
      ".md": "text/markdown; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".txt": "text/plain; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
    };
    const filePath = `docs/${ctx.params.path}`;
    try {
      const data = await Deno.readFile(filePath);
      const ext = extname(filePath).toLowerCase();
      return new Response(data, {
        headers: {
          "content-type": docsMime[ext] ?? "application/octet-stream",
        },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });

  // GET /scenario/:id — scenario detail page
  app.get(
    "/scenario/:id",
    (_ctx) => htmlResponse(<ScenarioPage v={buildHash} />),
  );

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
  app.get("/worker/:id", (_ctx) => htmlResponse(<WorkerPage v={buildHash} />));

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
  app.get("/", (_ctx) => htmlResponse(<MainPage v={buildHash} />));

  const handler = await app.handler();
  const server = Deno.serve(
    { port, signal, onListen: (): void => {} },
    handler,
  );
  const actualPort = server.addr.port;
  log({
    tags: ["info"],
    message: `GUI available at http://localhost:${actualPort}`,
  });
  return { port: actualPort, finished: server.finished };
};
