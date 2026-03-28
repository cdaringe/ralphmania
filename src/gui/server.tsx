// coverage:ignore — network I/O and browser integration requiring system-level testing
/**
 * GUI HTTP server built on Hono. Serves the interactive page at `/` and a
 * Server-Sent Events stream at `/events` for realtime workflow updates.
 * Accepts POST `/input/:workerId` to route text to a worker's agent stdin.
 *
 * @module
 */
import { Hono } from "hono";
import type { GuiEvent, GuiEventBus } from "./events.ts";
import type { AgentInputBus } from "./input-bus.ts";
import type { Logger } from "../types.ts";
import { createLogger } from "../logger.ts";
import type { StatusDiff } from "../status-diff.ts";
import { generateStatusHtml } from "../status-diff.ts";
import { MainPage } from "./pages/main-page.tsx";
import { WorkerPage } from "./pages/worker-page.tsx";

/** Returns the current spec-vs-progress status diff. */
export type StatusProvider = () => Promise<StatusDiff>;

export type GuiServerOptions = {
  readonly port: number;
  readonly bus: GuiEventBus;
  readonly log?: Logger;
  readonly signal?: AbortSignal;
  /** When provided, POST /input/:workerId routes text to agent subprocess stdin. */
  readonly agentInputBus?: AgentInputBus;
  /** When provided, enables /api/status (JSON) and /status (HTML) endpoints. */
  readonly statusProvider?: StatusProvider;
};

/** Start the GUI HTTP server. Resolves when the server closes. */
export const startGuiServer = async (opts: GuiServerOptions): Promise<void> => {
  const { port, bus, signal, agentInputBus, statusProvider } = opts;
  const log = opts.log ?? createLogger();

  const app = new Hono();

  // POST /input/:workerId — send text to an active agent's stdin
  app.post("/input/:workerId", async (c) => {
    const workerIndex = parseInt(c.req.param("workerId"), 10);
    const text = await c.req.text();
    if (!agentInputBus) {
      return c.text("No input bus configured", 503);
    }
    const sent = await agentInputBus.send(workerIndex, text + "\n");
    return c.text(sent ? "ok" : "no active worker", sent ? 200 : 404);
  });

  // GET /events — Server-Sent Events stream
  app.get("/events", (_c) => {
    let unsub: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        const enc = new TextEncoder();
        const send = (event: GuiEvent): void => {
          try {
            controller.enqueue(
              enc.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          } catch {
            // client disconnected
          }
        };

        // Replay in-memory state snapshot so late-joining clients
        // see the current orchestrator state and active workers.
        for (const event of bus.snapshot()) send(event);

        // All subsequent events are delivered in real-time.
        unsub = bus.subscribe(send);
        signal?.addEventListener(
          "abort",
          (): void => {
            unsub?.();
            try {
              controller.close();
            } catch {
              // already closed
            }
          },
          { once: true },
        );
      },
      cancel(): void {
        unsub?.();
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

  // GET /api/worker-log/:id — replay worker log file for late-joining clients
  app.get("/api/worker-log/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const content = await Deno.readTextFile(
        `.ralph/worker-logs/worker-${id}.log`,
      );
      return c.text(content);
    } catch {
      return c.text("", 200); // No log file yet — return empty
    }
  });

  // GET /worker/:id — per-worker detail page
  app.get("/worker/:id", (c) => {
    return c.html(<WorkerPage />);
  });

  // GET /api/status — JSON status diff
  app.get("/api/status", async (c) => {
    if (!statusProvider) {
      return c.json({ specOnly: [], progressOnly: [], shared: [] });
    }
    try {
      const diff = await statusProvider();
      return c.json(diff);
    } catch {
      return c.json({ error: "status unavailable" }, 500);
    }
  });

  // GET /status — full HTML status page
  app.get("/status", async (c) => {
    if (!statusProvider) {
      return c.html(
        "<html><body><p>No status provider configured.</p></body></html>",
      );
    }
    try {
      const diff = await statusProvider();
      return c.html(generateStatusHtml(diff));
    } catch {
      return c.html("<pre>Status unavailable</pre>", 500);
    }
  });

  // GET / — main GUI page
  app.get("/", (c) => {
    return c.html(<MainPage />);
  });

  const server = Deno.serve(
    { port, signal, onListen: (): void => {} },
    app.fetch,
  );
  log({ tags: ["info"], message: `GUI available at http://localhost:${port}` });
  await server.finished;
};
