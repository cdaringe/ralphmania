// coverage:ignore — network I/O and browser integration requiring system-level testing
/**
 * GUI HTTP server. Serves the interactive page at `/` and a
 * Server-Sent Events stream at `/events` for realtime workflow updates.
 *
 * @module
 */
import { GUI_HTML } from "./html.ts";
import type { GuiEventBus } from "./events.ts";
import type { Logger } from "../types.ts";
import { createLogger } from "../logger.ts";

export type GuiServerOptions = {
  readonly port: number;
  readonly bus: GuiEventBus;
  readonly log?: Logger;
  readonly signal?: AbortSignal;
};

/** Start the GUI HTTP server. Resolves when the server closes. */
export const startGuiServer = async (opts: GuiServerOptions): Promise<void> => {
  const { port, bus, signal } = opts;
  const log = opts.log ?? createLogger();

  const handler = (req: Request): Response => {
    const path = new URL(req.url).pathname;

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
