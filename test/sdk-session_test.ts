import { assert, assertEquals } from "jsr:@std/assert@^1";
import { createAgentInputBus } from "../src/gui/input-bus.ts";
import { COMPLETION_MARKER } from "../src/constants.ts";
import {
  createInputChannel,
  executeClaudeSession,
} from "../src/agents/claude/sdk-session.ts";
import type { ClaudeSessionDeps } from "../src/agents/claude/sdk-session.ts";

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
  "executeClaudeSession: returns timeout after idle output period",
  async () => {
    const logMessages: string[] = [];
    const result = await executeClaudeSession({
      prompt: "do work",
      model: "claude-test",
      effort: undefined,
      iterationNum: 1,
      signal: AbortSignal.timeout(5000),
      log: ({ message }) => {
        logMessages.push(message);
      },
      cwd: "/tmp",
      workerId: "SC.1",
      agentInputBus: undefined,
      deps: {
        async *query(qOpts): AsyncGenerator<unknown> {
          await new Promise((resolve) => setTimeout(resolve, 30));
          qOpts.signal.throwIfAborted();
          yield {
            type: "system",
            subtype: "timeout",
          };
        },
        onLine: () => {},
      },
      timeouts: { idleTimeoutMs: 10 },
    });
    assertEquals(result.status, "timeout");
    assertEquals(
      logMessages.some((message) =>
        message.includes("no new output for 10 ms")
      ),
      true,
    );
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
        yield {
          type: "assistant",
          session_id: "s1",
          message: { content: [{ type: "text", text: "thinking..." }] },
        };
        const iter = qOpts.inputMessages[Symbol.asyncIterator]();
        const next = await iter.next();
        if (!next.done) receivedInputs.push(next.value);
      },
      onLine: () => {},
    };

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
        { type: "assistant", session_id: "s1", message: { content: [] } },
        { type: "system", subtype: "note" },
      ], lines),
    });
    assertEquals(result.status, "continue");
    assertEquals(lines, ["[system: note]"]);
  },
);
