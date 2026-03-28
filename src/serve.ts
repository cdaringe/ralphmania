// coverage:ignore — Network server and OS browser-open requiring system integration
import { extname } from "jsr:@std/path@1";
import { RALPH_RECEIPTS_DIRNAME } from "./constants.ts";
import type { Logger } from "./types.ts";
import { createLogger } from "./logger.ts";
import { DEFAULT_FILE_PATHS, parseScenarioIds } from "./progress.ts";
import { parseProgressRows } from "./parsers/progress-rows.ts";
import { computeStatusDiff, generateStatusHtml } from "./status-diff.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export type ServeOptions = {
  open: boolean;
  port: number;
  receiptsDir?: string;
  log?: Logger;
  /** If provided, server runs until aborted (useful for tests) */
  signal?: AbortSignal;
  /** Path to specification.md for the /status endpoint. */
  specFile?: string;
  /** Path to progress.md for the /status endpoint. */
  progressFile?: string;
};

/** Serve the receipts directory as a static HTTP site. */
export const serveReceipts = async (opts: ServeOptions): Promise<void> => {
  const { open, port, signal } = opts;
  const log = opts.log ?? createLogger();
  const receiptsDir = opts.receiptsDir ?? RALPH_RECEIPTS_DIRNAME;
  const specFile = opts.specFile ?? DEFAULT_FILE_PATHS.specFile;
  const progressFile = opts.progressFile ?? DEFAULT_FILE_PATHS.progressFile;
  const url = `http://localhost:${port}`;

  const handler = async (req: Request): Promise<Response> => {
    const pathname = new URL(req.url).pathname;

    if (pathname === "/status") {
      try {
        const [specContent, progressContent] = await Promise.all([
          Deno.readTextFile(specFile),
          Deno.readTextFile(progressFile),
        ]);
        const specIds = parseScenarioIds(specContent);
        const progressResult = parseProgressRows(progressContent);
        const progressRows = progressResult.isOk() ? progressResult.value : [];
        const diff = computeStatusDiff(specIds, progressRows);
        const html = generateStatusHtml(diff);
        return new Response(html, {
          status: 200,
          headers: { "content-type": MIME[".html"] ?? "text/html" },
        });
      } catch (e) {
        return new Response(
          `<pre>Error generating status: ${String(e)}</pre>`,
          {
            status: 500,
            headers: { "content-type": MIME[".html"] ?? "text/html" },
          },
        );
      }
    }

    // Resolve to index.html for directory roots
    const suffix = pathname === "/" ? "/index.html" : pathname;
    const filePath = `${receiptsDir}${suffix}`;

    let data: Uint8Array<ArrayBuffer>;
    try {
      data = await Deno.readFile(filePath) as Uint8Array<ArrayBuffer>;
    } catch {
      // Try index.html fallback for directories
      try {
        data = await Deno.readFile(`${filePath}/index.html`) as Uint8Array<
          ArrayBuffer
        >;
        const ct = MIME[".html"] ?? "application/octet-stream";
        return new Response(data, {
          status: 200,
          headers: { "content-type": ct },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME[ext] ?? "application/octet-stream";
    return new Response(data, {
      status: 200,
      headers: { "content-type": contentType },
    });
  };

  const server = Deno.serve({ port, signal, onListen: () => {} }, handler);

  log({ tags: ["info"], message: `Receipts available at ${url}` });
  log({ tags: ["info"], message: `Serving from ./${receiptsDir}` });
  log({ tags: ["info"], message: "Press Ctrl+C to stop." });

  if (open) {
    const opener = Deno.build.os === "darwin"
      ? "open"
      : Deno.build.os === "windows"
      ? "start"
      : "xdg-open";
    await new Deno.Command(opener, { args: [url] }).spawn().status.catch(
      () => {},
    );
  }

  await server.finished;
};
