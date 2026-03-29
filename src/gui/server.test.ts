// Integration tests for startGuiServer POST /input/:workerId
import { assert, assertEquals } from "jsr:@std/assert@^1";
import { createAgentInputBus } from "./input-bus.ts";
import { startGuiServer } from "./server.tsx";

const P0 = 47201;
const P1 = 47202;
const P2 = 47203;

Deno.test(
  "POST /input/:workerId: sends text to registered worker, returns ok JSON",
  async () => {
    const inputBus = createAgentInputBus();
    const collected: string[] = [];

    const stream = new WritableStream<Uint8Array>({
      write(chunk): void {
        collected.push(new TextDecoder().decode(chunk));
      },
    });
    inputBus.register("GUI.0", stream);

    const ac = new AbortController();
    const serverDone = startGuiServer({
      port: P0,
      signal: ac.signal,
      agentInputBus: inputBus,
      skipBuild: true,
    });

    await new Promise<void>((r) => setTimeout(r, 50));

    const res = await fetch(`http://localhost:${P0}/input/GUI.0`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello agent",
    });

    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.ok, true);
    assertEquals(collected.join(""), "hello agent\n");

    ac.abort();
    await serverDone;
  },
);

Deno.test(
  "POST /input/:workerId: returns 422 with error for unregistered worker",
  async () => {
    const inputBus = createAgentInputBus();

    const ac = new AbortController();
    const serverDone = startGuiServer({
      port: P1,
      signal: ac.signal,
      agentInputBus: inputBus,
      skipBuild: true,
    });

    await new Promise<void>((r) => setTimeout(r, 50));

    const res = await fetch(`http://localhost:${P1}/input/NOBODY`, {
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
    await serverDone;
  },
);

Deno.test(
  "POST /input/:workerId: returns 503 when no input bus configured",
  async () => {
    const ac = new AbortController();
    const serverDone = startGuiServer({
      port: P2,
      signal: ac.signal,
      skipBuild: true,
    });

    await new Promise<void>((r) => setTimeout(r, 50));

    const res = await fetch(`http://localhost:${P2}/input/NOBODY`, {
      method: "POST",
      body: "hello",
    });

    assertEquals(res.status, 503);
    const json = await res.json();
    assertEquals(json.ok, false);

    ac.abort();
    await serverDone;
  },
);
