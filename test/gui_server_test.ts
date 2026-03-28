import { assert, assertEquals } from "jsr:@std/assert@^1.0.11";
import { createEventBus } from "../src/gui/events.ts";
import { startGuiServer } from "../src/gui/server.ts";
import { GUI_HTML, WORKER_PAGE_HTML } from "../src/gui/html.ts";

Deno.test("startGuiServer serves HTML page at /", async () => {
  const bus = createEventBus();
  const ctrl = new AbortController();
  const serverPromise = startGuiServer({
    port: 18440,
    bus,
    signal: ctrl.signal,
  });

  await new Promise<void>((r) => setTimeout(r, 50));

  const res = await fetch("http://localhost:18440/");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
  const text = await res.text();
  assert(text.includes("ralphmania"));

  ctrl.abort();
  await serverPromise.catch((): void => {});
});

Deno.test("startGuiServer serves HTML for unknown paths", async () => {
  const bus = createEventBus();
  const ctrl = new AbortController();
  const serverPromise = startGuiServer({
    port: 18441,
    bus,
    signal: ctrl.signal,
  });

  await new Promise<void>((r) => setTimeout(r, 50));

  const res = await fetch("http://localhost:18441/anything");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
  await res.body?.cancel();

  ctrl.abort();
  await serverPromise.catch((): void => {});
});

Deno.test("startGuiServer SSE endpoint has correct content-type", async () => {
  const bus = createEventBus();
  const ctrl = new AbortController();
  const serverPromise = startGuiServer({
    port: 18442,
    bus,
    signal: ctrl.signal,
  });

  await new Promise<void>((r) => setTimeout(r, 50));

  const reqCtrl = new AbortController();
  const res = await fetch("http://localhost:18442/events", {
    signal: reqCtrl.signal,
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/event-stream");

  reqCtrl.abort();
  await res.body?.cancel().catch((): void => {});

  ctrl.abort();
  await serverPromise.catch((): void => {});
});

Deno.test("startGuiServer SSE stream delivers emitted events", async () => {
  const bus = createEventBus();
  const ctrl = new AbortController();
  const serverPromise = startGuiServer({
    port: 18443,
    bus,
    signal: ctrl.signal,
  });

  await new Promise<void>((r) => setTimeout(r, 50));

  const reqCtrl = new AbortController();
  const res = await fetch("http://localhost:18443/events", {
    signal: reqCtrl.signal,
  });
  assertEquals(res.status, 200);

  const body = res.body;
  assert(body !== null);
  const reader = body.getReader();
  const dec = new TextDecoder();

  // Emit an event and read it back
  const expected = {
    type: "log" as const,
    level: "info",
    tags: ["info"],
    message: "workflow started",
    ts: 42,
  };
  bus.emit(expected);

  const { value } = await reader.read();
  assert(value !== undefined);
  const text = dec.decode(value);
  assert(text.includes(JSON.stringify(expected)));

  reqCtrl.abort();
  await reader.cancel().catch((): void => {});

  ctrl.abort();
  await serverPromise.catch((): void => {});
});

Deno.test("GUI_HTML contains expected UI elements", () => {
  assert(GUI_HTML.includes("ralphmania"));
  assert(GUI_HTML.includes("/events")); // SSE endpoint reference
  assert(GUI_HTML.includes("EventSource")); // SSE client code
  assert(GUI_HTML.includes("Orchestrator")); // state display
  assert(GUI_HTML.includes("Workers")); // workers panel
  assert(GUI_HTML.includes("state-val")); // state panel element
  assert(GUI_HTML.includes("launching")); // worker launch parsing
  assert(GUI_HTML.includes("/worker/")); // worker detail page links
});

Deno.test("startGuiServer serves WORKER_PAGE_HTML at /worker/:id", async () => {
  const bus = createEventBus();
  const ctrl = new AbortController();
  const serverPromise = startGuiServer({
    port: 18445,
    bus,
    signal: ctrl.signal,
  });

  await new Promise<void>((r) => setTimeout(r, 50));

  const res = await fetch("http://localhost:18445/worker/0");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
  const text = await res.text();
  assert(text.includes("ralphmania"));
  assert(text.includes("worker-title")); // worker header element
  assert(text.includes("scenario-val")); // scenario display element
  assert(text.includes("state-val")); // state display element
  assert(text.includes("/events")); // connects to SSE stream

  ctrl.abort();
  await serverPromise.catch((): void => {});
});

Deno.test("startGuiServer serves WORKER_PAGE_HTML for any worker id", async () => {
  const bus = createEventBus();
  const ctrl = new AbortController();
  const serverPromise = startGuiServer({
    port: 18446,
    bus,
    signal: ctrl.signal,
  });

  await new Promise<void>((r) => setTimeout(r, 50));

  const res = await fetch("http://localhost:18446/worker/3");
  assertEquals(res.status, 200);
  const text = await res.text();
  assert(text === WORKER_PAGE_HTML);

  ctrl.abort();
  await serverPromise.catch((): void => {});
});

Deno.test("WORKER_PAGE_HTML contains required worker page elements", () => {
  assert(WORKER_PAGE_HTML.includes("ralphmania")); // brand
  assert(WORKER_PAGE_HTML.includes("worker-title")); // worker index display
  assert(WORKER_PAGE_HTML.includes("scenario-val")); // scenario display
  assert(WORKER_PAGE_HTML.includes("state-val")); // state display
  assert(WORKER_PAGE_HTML.includes("/events")); // SSE stream connection
  assert(WORKER_PAGE_HTML.includes("worker_active")); // handles worker_active event
  assert(WORKER_PAGE_HTML.includes("worker_done")); // handles worker_done event
  assert(WORKER_PAGE_HTML.includes("overview")); // back link to main page
  assert(WORKER_PAGE_HTML.includes("workerIndex")); // filters by worker index
});
