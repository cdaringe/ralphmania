import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { extname } from "jsr:@std/path@1";
import { RALPH_RECEIPTS_DIRNAME } from "./constants.ts";

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
  /** If provided, server runs for this duration then closes (useful for tests) */
  signal?: AbortSignal;
};

/** Parse serve-subcommand args (everything after "serve receipts"). */
export const parseServeArgs = (
  rawArgs: string[],
): { open: boolean; port: number } => {
  const args = parseArgs(rawArgs, {
    boolean: ["open"],
    string: ["port"],
    alias: { o: "open" },
    default: { open: false, port: "8421" },
  });
  const port = parseInt(String(args.port), 10);
  return { open: args.open as boolean, port: isNaN(port) ? 8421 : port };
};

/** Serve the receipts directory as a static HTTP site. */
export const serveReceipts = async (opts: ServeOptions): Promise<void> => {
  const { open, port, signal } = opts;
  const receiptsDir = opts.receiptsDir ?? RALPH_RECEIPTS_DIRNAME;
  const url = `http://localhost:${port}`;

  const handler = async (req: Request): Promise<Response> => {
    const pathname = new URL(req.url).pathname;
    // Resolve to index.html for directory roots
    const suffix = pathname === "/" ? "/index.html" : pathname;
    const filePath = `${receiptsDir}${suffix}`;

    let data: Uint8Array<ArrayBuffer>;
    try {
      data = await Deno.readFile(filePath) as Uint8Array<ArrayBuffer>;
    } catch {
      // Try index.html fallback for directories
      try {
        data = await Deno.readFile(`${filePath}/index.html`) as Uint8Array<ArrayBuffer>;
        const ct = MIME[".html"] ?? "application/octet-stream";
        return new Response(data, { status: 200, headers: { "content-type": ct } });
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

  console.log(`[ralph:serve] Receipts available at ${url}`);
  console.log(`[ralph:serve] Serving from ./${receiptsDir}`);
  console.log(`[ralph:serve] Press Ctrl+C to stop.`);

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
