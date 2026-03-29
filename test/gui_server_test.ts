import { assert, assertEquals } from "jsr:@std/assert@^1.0.11";
import { startGuiServer } from "../src/gui/server.tsx";
import { initLogDir, writeOrchestratorEvent } from "../src/gui/log-dir.ts";

Deno.test("startGuiServer serves HTML page at /", async () => {
  const ctrl = new AbortController();
  const serverPromise = startGuiServer({
    port: 18440,
    signal: ctrl.signal,
    skipBuild: true,
  });

  await new Promise<void>((r) => setTimeout(r, 50));

  const res = await fetch("http://localhost:18440/");
  assertEquals(res.status, 200);
  assert(
    res.headers.get("content-type")?.toLowerCase().includes("text/html"),
  );
  const text = await res.text();
  assert(text.includes("ralphmania"));

  ctrl.abort();
  await serverPromise.catch((): void => {});
});

Deno.test("startGuiServer returns 404 for unknown paths", async () => {
  const ctrl = new AbortController();
  const serverPromise = startGuiServer({
    port: 18441,
    signal: ctrl.signal,
    skipBuild: true,
  });

  await new Promise<void>((r) => setTimeout(r, 50));

  const res = await fetch("http://localhost:18441/anything");
  assertEquals(res.status, 404);
  await res.body?.cancel();

  ctrl.abort();
  await serverPromise.catch((): void => {});
});

Deno.test({
  name: "startGuiServer SSE endpoint has correct content-type",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const ctrl = new AbortController();
    const serverPromise = startGuiServer({
      port: 18442,
      signal: ctrl.signal,
      skipBuild: true,
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
  },
});

Deno.test({
  name: "startGuiServer SSE stream delivers events written to log files",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    await initLogDir();
    const ctrl = new AbortController();
    const serverPromise = startGuiServer({
      port: 18443,
      signal: ctrl.signal,
      skipBuild: true,
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

    setTimeout(async () => {
      await writeOrchestratorEvent({
        type: "log" as const,
        level: "info",
        tags: ["info"] as readonly string[],
        message: "workflow started",
        ts: 42,
      });
    }, 200);

    const deadline = Date.now() + 3000;
    let text = "";
    while (!text.includes("workflow started") && Date.now() < deadline) {
      const race = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((r) =>
          setTimeout(() => r({ value: undefined, done: true }), 500)
        ),
      ]);
      if (race.value) text += dec.decode(race.value);
    }
    assert(text.includes('"workflow started"'), `Expected event, got: ${text}`);

    reqCtrl.abort();
    await reader.cancel().catch((): void => {});

    ctrl.abort();
    await serverPromise.catch((): void => {});
  },
});

Deno.test("startGuiServer serves worker page at /worker/:id", async () => {
  const ctrl = new AbortController();
  const serverPromise = startGuiServer({
    port: 18445,
    signal: ctrl.signal,
    skipBuild: true,
  });

  await new Promise<void>((r) => setTimeout(r, 50));

  const res = await fetch("http://localhost:18445/worker/0");
  assertEquals(res.status, 200);
  assert(
    res.headers.get("content-type")?.toLowerCase().includes("text/html"),
  );
  const text = await res.text();
  assert(text.includes("ralphmania"));

  ctrl.abort();
  await serverPromise.catch((): void => {});
});
