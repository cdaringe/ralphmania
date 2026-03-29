import { assert, assertEquals } from "jsr:@std/assert@^1";
import { createInputChannel, executeClaudeSession } from "./sdk-session.ts";
import type { ClaudeSessionDeps } from "./sdk-session.ts";
import { createAgentInputBus } from "../../gui/input-bus.ts";
import { COMPLETION_MARKER } from "../../constants.ts";

const noopLog = (): void => {};

/** Create fake deps that yield the given messages from query(). */
const fakeDeps = (
  messages: unknown[],
  lines: string[] = [],
): ClaudeSessionDeps => ({
  async *query(): AsyncGenerator<unknown> {
    for (const m of messages) yield m;
  },
  onLine: (text) => {
    lines.push(text);
  },
});

Deno.test(
  "executeClaudeSession: returns continue when no completion marker",
  async () => {
    const lines: string[] = [];
    const result = await executeClaudeSession({
      prompt: "do work",
      model: "claude-test",
      effort: undefined,
      iterationNum: 1,
      signal: AbortSignal.timeout(5000),
      log: noopLog,
      cwd: "/tmp",
      workerId: "SC.1",
      agentInputBus: undefined,
      deps: fakeDeps([
        {
          type: "assistant",
          session_id: "s1",
          message: {
            content: [{ type: "text", text: "working on it" }],
          },
        },
      ], lines),
    });
    assertEquals(result.status, "continue");
    assertEquals(lines, ["working on it"]);
  },
);

Deno.test(
  "executeClaudeSession: returns complete when completion marker found",
  async () => {
    const result = await executeClaudeSession({
      prompt: "do work",
      model: "claude-test",
      effort: undefined,
      iterationNum: 1,
      signal: AbortSignal.timeout(5000),
      log: noopLog,
      cwd: "/tmp",
      workerId: "SC.1",
      agentInputBus: undefined,
      deps: fakeDeps([
        {
          type: "assistant",
          session_id: "s1",
          message: {
            content: [{
              type: "text",
              text: `done ${COMPLETION_MARKER}`,
            }],
          },
        },
      ]),
    });
    assertEquals(result.status, "complete");
  },
);

Deno.test(
  "executeClaudeSession: returns timeout on aborted signal",
  async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await executeClaudeSession({
      prompt: "do work",
      model: "claude-test",
      effort: undefined,
      iterationNum: 1,
      signal: ac.signal,
      log: noopLog,
      cwd: "/tmp",
      workerId: "SC.1",
      agentInputBus: undefined,
      deps: fakeDeps([
        {
          type: "assistant",
          session_id: "s1",
          message: { content: [{ type: "text", text: "hi" }] },
        },
      ]),
    });
    assertEquals(result.status, "timeout");
  },
);

Deno.test(
  "executeClaudeSession: registers and unregisters on input bus",
  async () => {
    const bus = createAgentInputBus();
    const registered: string[] = [];
    const unregistered: string[] = [];
    const trackingBus = {
      ...bus,
      registerSession: (id: string, send: (t: string) => Promise<void>) => {
        registered.push(id);
        bus.registerSession(id, send);
      },
      unregister: (id: string) => {
        unregistered.push(id);
        bus.unregister(id);
      },
    };

    await executeClaudeSession({
      prompt: "do work",
      model: "claude-test",
      effort: undefined,
      iterationNum: 1,
      signal: AbortSignal.timeout(5000),
      log: noopLog,
      cwd: "/tmp",
      workerId: "SC.1",
      agentInputBus: trackingBus,
      deps: fakeDeps([]),
    });

    assertEquals(registered, ["SC.1"]);
    assertEquals(unregistered, ["SC.1"]);
  },
);

// ---------------------------------------------------------------------------
// InputChannel unit tests
// ---------------------------------------------------------------------------

Deno.test("createInputChannel: push before pull yields immediately", async () => {
  const ch = createInputChannel();
  ch.push("hello");
  const iter = ch[Symbol.asyncIterator]();
  const result = await iter.next();
  assertEquals(result, { value: "hello", done: false });
  ch.close();
});

Deno.test("createInputChannel: pull before push awaits", async () => {
  const ch = createInputChannel();
  const iter = ch[Symbol.asyncIterator]();
  const pending = iter.next();
  ch.push("delayed");
  const result = await pending;
  assertEquals(result, { value: "delayed", done: false });
  ch.close();
});

Deno.test("createInputChannel: close resolves pending pull as done", async () => {
  const ch = createInputChannel();
  const iter = ch[Symbol.asyncIterator]();
  const pending = iter.next();
  ch.close();
  const result = await pending;
  assertEquals(result.done, true);
});

Deno.test(
  "executeClaudeSession: input bus messages reach query via inputMessages",
  async () => {
    const bus = createAgentInputBus();
    const receivedInputs: string[] = [];
    const deps: ClaudeSessionDeps = {
      async *query(qOpts): AsyncGenerator<unknown> {
        // Consume the inputMessages channel in the background.
        // Simulate: agent yields a message, then user sends feedback,
        // then agent yields another.
        yield {
          type: "assistant",
          session_id: "s1",
          message: { content: [{ type: "text", text: "thinking..." }] },
        };
        // Pull one follow-up message from the input channel.
        const iter = qOpts.inputMessages[Symbol.asyncIterator]();
        const next = await iter.next();
        if (!next.done) receivedInputs.push(next.value);
      },
      onLine: () => {},
    };

    // Start execution — it will register on the bus, then block waiting for input.
    const resultP = executeClaudeSession({
      prompt: "do work",
      model: "claude-test",
      effort: undefined,
      iterationNum: 1,
      signal: AbortSignal.timeout(5000),
      log: noopLog,
      cwd: "/tmp",
      workerId: "SC.1",
      agentInputBus: bus,
      deps,
    });

    // Simulate user sending feedback via the input bus.
    await new Promise((r) => setTimeout(r, 10));
    const sent = await bus.send("SC.1", "try a different approach");
    assert(sent.isOk());

    const result = await resultP;
    assertEquals(result.status, "continue");
    assertEquals(receivedInputs, ["try a different approach"]);
  },
);

Deno.test(
  "executeClaudeSession: skips non-text messages gracefully",
  async () => {
    const lines: string[] = [];
    await executeClaudeSession({
      prompt: "do work",
      model: "claude-test",
      effort: undefined,
      iterationNum: 1,
      signal: AbortSignal.timeout(5000),
      log: noopLog,
      cwd: "/tmp",
      workerId: "SC.1",
      agentInputBus: undefined,
      deps: fakeDeps([
        { type: "system", subtype: "init", session_id: "s1" },
        {
          type: "assistant",
          session_id: "s1",
          message: { content: [{ type: "text", text: "hello" }] },
        },
      ], lines),
    });
    assertEquals(lines, ["[system: init]", "hello"]);
  },
);
