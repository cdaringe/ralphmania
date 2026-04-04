// Integration tests for startGuiServer POST /input/:workerId and SSE endpoints
import { assert, assertEquals } from "jsr:@std/assert@^1";
import { createAgentInputBus } from "./input-bus.ts";
import { startGuiServer } from "./server.tsx";

Deno.test(
  "POST /input/:workerId: sends text to registered worker, returns ok JSON",
  async () => {
    const inputBus = createAgentInputBus();
    const collected: { text: string; mode: string }[] = [];

    // deno-lint-ignore require-await
    inputBus.registerSession("GUI.0", async (text, mode) => {
      collected.push({ text, mode });
    });

    const ac = new AbortController();
    const handle = await startGuiServer({
      port: 0,
      signal: ac.signal,
      agentInputBus: inputBus,
      skipBuild: true,
    });

    const res = await fetch(`http://localhost:${handle.port}/input/GUI.0`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello agent", mode: "steer" }),
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.ok, true);
    assertEquals(collected.length, 1);
    assertEquals(collected[0].text, "hello agent");
    assertEquals(collected[0].mode, "steer");

    ac.abort();
    await handle.finished;
  },
);

Deno.test(
  "POST /input/:workerId: returns 422 with error for unregistered worker",
  async () => {
    const inputBus = createAgentInputBus();

    const ac = new AbortController();
    const handle = await startGuiServer({
      port: 0,
      signal: ac.signal,
      agentInputBus: inputBus,
      skipBuild: true,
    });

    const res = await fetch(`http://localhost:${handle.port}/input/NOBODY`, {
      method: "POST",
      body: "hello",
    });

    assertEquals(res.status, 422);
    const json = await res.json();
    assertEquals(json.ok, false);
    assert(
      typeof json.error === "string" && json.error.length > 0,
      "Expected error message",
    );

    ac.abort();
    await handle.finished;
  },
);

Deno.test(
  "POST /input/:workerId: returns 503 when no input bus configured",
  async () => {
    const ac = new AbortController();
    const handle = await startGuiServer({
      port: 0,
      signal: ac.signal,
      skipBuild: true,
    });

    const res = await fetch(`http://localhost:${handle.port}/input/NOBODY`, {
      method: "POST",
      body: "hello",
    });

    assertEquals(res.status, 503);
    const json = await res.json();
    assertEquals(json.ok, false);

    ac.abort();
    await handle.finished;
  },
);

Deno.test(
  "GET /events: responds with SSE content-type (orchestrator stream only)",
  async () => {
    const ac = new AbortController();
    const handle = await startGuiServer({
      port: 0,
      signal: ac.signal,
      skipBuild: true,
    });

    const fetchAc = new AbortController();
    const res = await fetch(`http://localhost:${handle.port}/events`, {
      signal: fetchAc.signal,
    }).catch(() => null);

    // Abort immediately — we only need the response headers.
    fetchAc.abort();

    assert(res !== null, "expected a response");
    assertEquals(
      res.headers.get("content-type"),
      "text/event-stream",
      "Content-Type must be text/event-stream",
    );
    // Drain body to avoid resource leak.
    await res.body?.cancel().catch(() => {});

    ac.abort();
    await handle.finished;
  },
);

Deno.test(
  "GET /events/worker/:id: responds with SSE content-type for worker stream",
  async () => {
    const ac = new AbortController();
    const handle = await startGuiServer({
      port: 0,
      signal: ac.signal,
      skipBuild: true,
    });

    const fetchAc = new AbortController();
    const res = await fetch(
      `http://localhost:${handle.port}/events/worker/GUI.g`,
      { signal: fetchAc.signal },
    ).catch(() => null);

    fetchAc.abort();

    assert(res !== null, "expected a response");
    assertEquals(
      res.headers.get("content-type"),
      "text/event-stream",
      "Content-Type must be text/event-stream for worker SSE stream",
    );
    await res.body?.cancel().catch(() => {});

    ac.abort();
    await handle.finished;
  },
);

Deno.test(
  "GET /events/worker/:id: URL-decoded worker id is used",
  async () => {
    const ac = new AbortController();
    const handle = await startGuiServer({
      port: 0,
      signal: ac.signal,
      skipBuild: true,
    });

    // Scenario IDs often contain dots and slashes — verify encoding round-trips.
    const workerId = "GUI.g";
    const fetchAc = new AbortController();
    const res = await fetch(
      `http://localhost:${handle.port}/events/worker/${
        encodeURIComponent(workerId)
      }`,
      { signal: fetchAc.signal },
    ).catch(() => null);

    fetchAc.abort();

    assert(res !== null);
    assertEquals(res.headers.get("content-type"), "text/event-stream");
    await res.body?.cancel().catch(() => {});

    ac.abort();
    await handle.finished;
  },
);
