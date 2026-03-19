import { assertEquals } from "jsr:@std/assert@^1.0.11";
import { parseServeArgs, serveReceipts } from "../src/serve.ts";

Deno.test("parseServeArgs defaults", () => {
  const result = parseServeArgs([]);
  assertEquals(result.open, false);
  assertEquals(result.port, 8421);
});

Deno.test("parseServeArgs --open flag", () => {
  const result = parseServeArgs(["--open"]);
  assertEquals(result.open, true);
});

Deno.test("parseServeArgs -o short flag", () => {
  const result = parseServeArgs(["-o"]);
  assertEquals(result.open, true);
});

Deno.test("parseServeArgs --port flag", () => {
  const result = parseServeArgs(["--port", "9000"]);
  assertEquals(result.port, 9000);
});

Deno.test("parseServeArgs --open and --port together", () => {
  const result = parseServeArgs(["--open", "--port", "3000"]);
  assertEquals(result.open, true);
  assertEquals(result.port, 3000);
});

Deno.test("parseServeArgs invalid port falls back to default", () => {
  const result = parseServeArgs(["--port", "abc"]);
  assertEquals(result.port, 8421);
});

Deno.test("serveReceipts serves files from receiptsDir", async () => {
  const tmpDir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmpDir}/index.html`, "<h1>Receipts</h1>");

  const controller = new AbortController();
  const port = 18421;

  const serverPromise = serveReceipts({
    open: false,
    port,
    receiptsDir: tmpDir,
    signal: controller.signal,
  });

  // Give server a moment to start
  await new Promise((resolve) => setTimeout(resolve, 50));

  const res = await fetch(`http://localhost:${port}/index.html`);
  assertEquals(res.status, 200);
  const text = await res.text();
  assertEquals(text, "<h1>Receipts</h1>");

  // Root path redirects to index.html
  const rootRes = await fetch(`http://localhost:${port}/`);
  assertEquals(rootRes.status, 200);
  const rootText = await rootRes.text();
  assertEquals(rootText, "<h1>Receipts</h1>");

  controller.abort();
  await serverPromise.catch(() => {}); // ignore abort error

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("serveReceipts returns 404 for missing file", async () => {
  const tmpDir = await Deno.makeTempDir();

  const controller = new AbortController();
  const port = 18422;

  const serverPromise = serveReceipts({
    open: false,
    port,
    receiptsDir: tmpDir,
    signal: controller.signal,
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const res = await fetch(`http://localhost:${port}/nonexistent.html`);
  assertEquals(res.status, 404);
  await res.body?.cancel();

  controller.abort();
  await serverPromise.catch(() => {});

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("serveReceipts serves correct MIME types", async () => {
  const tmpDir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmpDir}/style.css`, "body { color: red; }");
  await Deno.writeTextFile(`${tmpDir}/app.js`, "console.log('hi');");

  const controller = new AbortController();
  const port = 18423;

  const serverPromise = serveReceipts({
    open: false,
    port,
    receiptsDir: tmpDir,
    signal: controller.signal,
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const cssRes = await fetch(`http://localhost:${port}/style.css`);
  assertEquals(cssRes.status, 200);
  assertEquals(cssRes.headers.get("content-type"), "text/css; charset=utf-8");
  await cssRes.body?.cancel();

  const jsRes = await fetch(`http://localhost:${port}/app.js`);
  assertEquals(jsRes.status, 200);
  assertEquals(
    jsRes.headers.get("content-type"),
    "text/javascript; charset=utf-8",
  );
  await jsRes.body?.cancel();

  controller.abort();
  await serverPromise.catch(() => {});

  await Deno.remove(tmpDir, { recursive: true });
});
