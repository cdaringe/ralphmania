/**
 * Claude Agent SDK session executor.
 *
 * Pure domain logic for running a claude session and interpreting results.
 * All I/O (SDK calls, GUI log writes, terminal output) is injected via
 * {@link ClaudeSessionDeps} so the module is testable without real SDK.
 *
 * The V1 `query` API accepts an `AsyncIterable<UserMessage>` as the prompt,
 * enabling multi-turn conversations. This module creates an input channel
 * that the {@link AgentInputBus} can push follow-up messages into.
 *
 * @module
 */
import type { AgentInputBus } from "../../gui/input-bus.ts";
import type { IterationResult, Logger } from "../../types.ts";
import {
  COMPLETION_MARKER,
  formatDuration,
  TIMEOUT_MS,
  WORKER_IDLE_TIMEOUT_MS,
} from "../../constants.ts";
import { createIdleWatchdog } from "../../idle-watchdog.ts";
import { extractSDKText } from "./sdk-text.ts";

/**
 * An async-iterable input channel. The SDK pulls user messages from this,
 * and external callers push new messages via {@link push}.
 */
export type InputChannel = AsyncIterable<string> & {
  readonly push: (text: string) => void;
  readonly close: () => void;
  /** Number of messages waiting to be consumed by the SDK. */
  readonly pending: () => number;
  /** Total messages pushed (consumed + pending). */
  readonly totalPushed: () => number;
  /** Total messages consumed by the SDK. */
  readonly totalConsumed: () => number;
};

/** Create a buffered async channel for user input. */
export const createInputChannel = (): InputChannel => {
  const queue: string[] = [];
  let waiter: ((v: IteratorResult<string>) => void) | undefined;
  let closed = false;
  let pushed = 0;
  let consumed = 0;

  const channel: InputChannel = {
    push: (text: string): void => {
      if (closed) return;
      pushed++;
      waiter
        ? (consumed++, waiter({ value: text, done: false }), waiter = undefined)
        : queue.push(text);
    },
    close: (): void => {
      closed = true;
      waiter?.({ value: undefined as unknown as string, done: true });
      waiter = undefined;
    },
    pending: () => queue.length,
    totalPushed: () => pushed,
    totalConsumed: () => consumed,
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<string>> =>
        queue.length > 0
          ? (consumed++,
            Promise.resolve({ value: queue.shift() as string, done: false }))
          : closed
          ? Promise.resolve({
            value: undefined as unknown as string,
            done: true,
          })
          : new Promise((resolve) => {
            waiter = resolve;
          }),
    }),
  };
  return channel;
};

/** Injected I/O dependencies for the claude session executor. */
export type ClaudeSessionDeps = {
  /**
   * Start an SDK query. `inputMessages` is an async iterable of follow-up
   * user messages (after the initial prompt) for multi-turn interaction.
   */
  readonly query: (opts: {
    prompt: string;
    inputMessages: AsyncIterable<string>;
    model: string;
    cwd: string;
    effort: string | undefined;
    signal: AbortSignal;
  }) => AsyncIterable<unknown>;
  /** Write a line to the terminal and GUI worker log. Awaited to ensure flush. */
  readonly onLine: (text: string) => void | Promise<void>;
};

type ExecuteOpts = {
  readonly prompt: string;
  readonly model: string;
  readonly effort: string | undefined;
  readonly iterationNum: number;
  readonly signal: AbortSignal;
  readonly log: Logger;
  readonly cwd: string;
  readonly workerId: string | undefined;
  readonly agentInputBus: AgentInputBus | undefined;
  readonly deps: ClaudeSessionDeps;
  readonly timeouts?: {
    hardTimeoutMs?: number;
    idleTimeoutMs?: number;
  };
};

/**
 * Execute a claude agent iteration using injected SDK deps.
 *
 * Follow-up user messages are delivered via the input bus and fed into
 * the SDK conversation as new turns through an async input channel.
 */
export const executeClaudeSession = async (
  opts: ExecuteOpts,
): Promise<IterationResult> => {
  const {
    prompt,
    model,
    effort,
    iterationNum,
    signal,
    log,
    cwd,
    workerId,
    agentInputBus,
    deps,
    timeouts,
  } = opts;

  const inputChannel = createInputChannel();
  const hardTimeoutMs = timeouts?.hardTimeoutMs ?? TIMEOUT_MS;
  const idleTimeoutMs = timeouts?.idleTimeoutMs ?? WORKER_IDLE_TIMEOUT_MS;
  const watchdog = createIdleWatchdog(signal, {
    hardTimeoutMs,
    idleTimeoutMs,
  });

  // Register the input channel on the bus so the GUI can push messages.
  // After each push, emit a queue status event so the UX can display it.
  if (agentInputBus && workerId) {
    // deno-lint-ignore require-await
    agentInputBus.registerSession(workerId, async (text: string) => {
      inputChannel.push(text);
      deps.onLine(
        `[input queued] "${text.substring(0, 60)}${
          text.length > 60 ? "..." : ""
        }" ` +
          `(${inputChannel.pending()} queued, ${inputChannel.totalConsumed()} consumed, ` +
          `${inputChannel.totalPushed()} total)`,
      );
    });
  }

  try {
    const conversation = deps.query({
      prompt,
      inputMessages: inputChannel,
      model,
      cwd,
      effort,
      signal: watchdog.signal,
    });

    let foundCompletionMarker = false;

    for await (const msg of conversation) {
      if (signal.aborted) break;
      const extracted = extractSDKText(msg);
      if (extracted) {
        watchdog.touch();
        await deps.onLine(extracted);
        if (extracted.includes(COMPLETION_MARKER)) {
          foundCompletionMarker = true;
        }
      }
    }

    inputChannel.close();
    if (agentInputBus && workerId) agentInputBus.unregister(workerId);
    watchdog.stop();

    if (signal.aborted || watchdog.timedOut() !== undefined) {
      log({
        tags: ["error"],
        message: watchdog.timedOut() === "idle"
          ? `TIMEOUT: iteration ${iterationNum} produced no new output for ${
            formatDuration(idleTimeoutMs)
          }`
          : `TIMEOUT: iteration ${iterationNum} exceeded ${
            formatDuration(hardTimeoutMs)
          }`,
      });
      return { status: "timeout" };
    }

    return foundCompletionMarker
      ? (log({
        tags: ["info"],
        message: `specification complete after ${iterationNum} iterations.`,
      }),
        { status: "complete" })
      : (log({
        tags: ["info"],
        message: `Iteration ${iterationNum} complete.`,
      }),
        { status: "continue" });
  } catch (error) {
    inputChannel.close();
    if (agentInputBus && workerId) agentInputBus.unregister(workerId);
    watchdog.stop();
    if (
      (error instanceof DOMException && error.name === "AbortError") ||
      signal.aborted ||
      watchdog.signal.aborted
    ) {
      log({
        tags: ["error"],
        message: watchdog.timedOut() === "idle"
          ? `TIMEOUT: iteration ${iterationNum} produced no new output for ${
            formatDuration(idleTimeoutMs)
          }`
          : `TIMEOUT: iteration ${iterationNum} exceeded ${
            formatDuration(hardTimeoutMs)
          }`,
      });
      return { status: "timeout" };
    }
    throw error;
  }
};
