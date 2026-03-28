import { assert, assertEquals } from "jsr:@std/assert@^1.0.11";
import { createEventBus } from "../src/gui/events.ts";
import { startGuiServer } from "../src/gui/server.ts";
import { GUI_HTML } from "../src/gui/html.ts";

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
});
