// coverage:ignore — network I/O and browser integration requiring system-level testing
/**
 * GUI HTTP server. Serves the interactive page at `/` and a
 * Server-Sent Events stream at `/events` for realtime workflow updates.
 * Accepts POST `/input/:workerId` to route text to a worker's agent stdin.
 *
 * @module
 */
import { GUI_HTML, WORKER_PAGE_HTML } from "./html.ts";
import type { GuiEventBus } from "./events.ts";
import type { AgentInputBus } from "./input-bus.ts";
import type { Logger } from "../types.ts";
import { createLogger } from "../logger.ts";
import type { StatusDiff } from "../status-diff.ts";
import { generateStatusHtml } from "../status-diff.ts";

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

  const handler = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;

    // POST /input/:workerId — send text to an active agent's stdin
    const inputMatch = path.match(/^\/input\/(\d+)$/);
    if (inputMatch && req.method === "POST") {
      const workerIndex = parseInt(inputMatch[1], 10);
      const text = await req.text();
      if (!agentInputBus) {
        return new Response("No input bus configured", { status: 503 });
      }
      const sent = await agentInputBus.send(workerIndex, text + "\n");
      return new Response(sent ? "ok" : "no active worker", {
        status: sent ? 200 : 404,
      });
    }

    if (path === "/events") {
      let unsub: (() => void) | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller): void {
          const enc = new TextEncoder();
          unsub = bus.subscribe((event): void => {
            try {
              controller.enqueue(
                enc.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
            } catch {
              // client disconnected
            }
          });
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
    }

    // Dedicated worker detail page: /worker/:id
    const workerMatch = path.match(/^\/worker\/(\d+)$/);
    if (workerMatch) {
      return new Response(WORKER_PAGE_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // GET /api/status — JSON status diff (GUI.b)
    if (path === "/api/status") {
      if (!statusProvider) {
        return new Response(
          JSON.stringify({ specOnly: [], progressOnly: [], shared: [] }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      try {
        const diff = await statusProvider();
        return new Response(JSON.stringify(diff), {
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        return new Response(
          JSON.stringify({ error: "status unavailable" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    // GET /status — full HTML status page (GUI.b)
    if (path === "/status") {
      if (!statusProvider) {
        return new Response(
          "<html><body><p>No status provider configured.</p></body></html>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      try {
        const diff = await statusProvider();
        return new Response(generateStatusHtml(diff), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch {
        return new Response("<pre>Status unavailable</pre>", {
          status: 500,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

    return new Response(GUI_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };

  const server = Deno.serve(
    { port, signal, onListen: (): void => {} },
    handler,
  );
  log({ tags: ["info"], message: `GUI available at http://localhost:${port}` });
  await server.finished;
};
