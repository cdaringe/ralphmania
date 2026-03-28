import { assert, assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  createEventBus,
  type GuiEvent,
  type GuiLogEvent,
  type GuiStateEvent,
} from "../src/gui/events.ts";
import { createGuiLogger } from "../src/gui/logger.ts";
import type { Logger } from "../src/types.ts";

Deno.test("createGuiLogger calls base logger", () => {
  const bus = createEventBus();
  const calls: { tags: readonly string[]; message: string }[] = [];
  const base: Logger = (opts) => calls.push(opts);

  const logger = createGuiLogger(base, bus);
  logger({ tags: ["info"], message: "test message" });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].message, "test message");
});

Deno.test("createGuiLogger emits log event to bus", () => {
  const bus = createEventBus();
  const events: GuiEvent[] = [];
  bus.subscribe((e) => events.push(e));

  const base: Logger = () => {};
  const logger = createGuiLogger(base, bus);

  logger({ tags: ["info", "orchestrator"], message: "round started" });

  const logEvents = events.filter((e) => e.type === "log");
  assertEquals(logEvents.length, 1);
  const ev = logEvents[0] as GuiLogEvent;
  assertEquals(ev.type, "log");
  assertEquals(ev.level, "info");
  assertEquals(ev.tags[0], "info");
  assertEquals(ev.tags[1], "orchestrator");
  assertEquals(ev.message, "round started");
  assert(ev.ts > 0);
});

Deno.test("createGuiLogger calls base before emitting to bus", () => {
  const order: string[] = [];
  const bus = createEventBus();
  bus.subscribe(() => order.push("bus"));

  const base: Logger = () => order.push("base");
  const logger = createGuiLogger(base, bus);

  logger({ tags: ["info"], message: "test" });

  assertEquals(order[0], "base");
  assert(order.includes("bus"));
});

Deno.test("createGuiLogger propagates error level tag", () => {
  const bus = createEventBus();
  const events: GuiEvent[] = [];
  bus.subscribe((e) => events.push(e));

  const logger = createGuiLogger(() => {}, bus);
  logger({ tags: ["error"], message: "something failed" });

  const logEv = events.find((e) => e.type === "log") as GuiLogEvent;
  assertEquals(logEv.level, "error");
  assertEquals(logEv.message, "something failed");
});

Deno.test("createGuiLogger emits state event for transition log messages", () => {
  const bus = createEventBus();
  const events: GuiEvent[] = [];
  bus.subscribe((e) => events.push(e));

  const logger = createGuiLogger(() => {}, bus);
  logger({
    tags: ["debug", "orchestrator", "transition"],
    message: "reading_progress \u2192 finding_actionable",
  });

  const stateEvents = events.filter((e) => e.type === "state");
  assertEquals(stateEvents.length, 1);
  const ev = stateEvents[0] as GuiStateEvent;
  assertEquals(ev.from, "reading_progress");
  assertEquals(ev.to, "finding_actionable");
});

Deno.test("createGuiLogger does not emit state event for non-transition logs", () => {
  const bus = createEventBus();
  const events: GuiEvent[] = [];
  bus.subscribe((e) => events.push(e));

  const logger = createGuiLogger(() => {}, bus);
  logger({ tags: ["info", "orchestrator"], message: "some info message" });

  const stateEvents = events.filter((e) => e.type === "state");
  assertEquals(stateEvents.length, 0);
});

Deno.test("createGuiLogger emits both log and state events for transitions", () => {
  const bus = createEventBus();
  const events: GuiEvent[] = [];
  bus.subscribe((e) => events.push(e));

  const logger = createGuiLogger(() => {}, bus);
  logger({
    tags: ["debug", "orchestrator", "transition"],
    message: "init \u2192 reading_progress",
  });

  assertEquals(events.length, 2);
  assertEquals(events[0].type, "log");
  assertEquals(events[1].type, "state");
  assertEquals((events[1] as GuiStateEvent).to, "reading_progress");
});
