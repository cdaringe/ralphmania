// Integration tests for startGuiServer POST /input/:workerId (GUI.d)
import { assertEquals } from "jsr:@std/assert@^1";
import { createAgentInputBus } from "./input-bus.ts";
import { startGuiServer } from "./server.tsx";
import { createEventBus } from "./events.ts";

// Ports unlikely to conflict with other test servers in parallel runs
const P0 = 47201;
const P1 = 47202;
const P2 = 47203;

Deno.test(
  "POST /input/:workerId: sends text to registered worker, returns 200",
  async () => {
    const bus = createEventBus();
    const inputBus = createAgentInputBus();
    const collected: string[] = [];

    const stream = new WritableStream<Uint8Array>({
      write(chunk): void {
        collected.push(new TextDecoder().decode(chunk));
      },
    });
    inputBus.register(0, stream);

    const ac = new AbortController();
    const serverDone = startGuiServer({
      port: P0,
      bus,
      signal: ac.signal,
      agentInputBus: inputBus,
    });

    await new Promise<void>((r) => setTimeout(r, 50));

    const res = await fetch(`http://localhost:${P0}/input/0`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello agent",
    });

    assertEquals(res.status, 200);
    assertEquals(await res.text(), "ok");
    assertEquals(collected.join(""), "hello agent\n");

    ac.abort();
    await serverDone;
  },
);

Deno.test(
  "POST /input/:workerId: returns 404 for unregistered worker",
  async () => {
    const bus = createEventBus();
    const inputBus = createAgentInputBus();
    // no worker registered

    const ac = new AbortController();
    const serverDone = startGuiServer({
      port: P1,
      bus,
      signal: ac.signal,
      agentInputBus: inputBus,
    });

    await new Promise<void>((r) => setTimeout(r, 50));

    const res = await fetch(`http://localhost:${P1}/input/0`, {
      method: "POST",
      body: "hello",
    });

    assertEquals(res.status, 404);
    assertEquals(await res.text(), "no active worker");

    ac.abort();
    await serverDone;
  },
);

Deno.test(
  "POST /input/:workerId: returns 503 when no input bus configured",
  async () => {
    const bus = createEventBus();

    const ac = new AbortController();
    const serverDone = startGuiServer({ port: P2, bus, signal: ac.signal });

    await new Promise<void>((r) => setTimeout(r, 50));

    const res = await fetch(`http://localhost:${P2}/input/0`, {
      method: "POST",
      body: "hello",
    });

    assertEquals(res.status, 503);
    await res.text();

    ac.abort();
    await serverDone;
  },
);
