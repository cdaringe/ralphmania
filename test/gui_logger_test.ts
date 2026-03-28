import { assert, assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  createEventBus,
  type GuiEvent,
  type GuiLogEvent,
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

  assertEquals(events.length, 1);
  const ev = events[0] as GuiLogEvent;
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

  assertEquals(order, ["base", "bus"]);
});

Deno.test("createGuiLogger propagates error level tag", () => {
  const bus = createEventBus();
  const events: GuiEvent[] = [];
  bus.subscribe((e) => events.push(e));

  const logger = createGuiLogger(() => {}, bus);
  logger({ tags: ["error"], message: "something failed" });

  const ev = events[0] as GuiLogEvent;
  assertEquals(ev.level, "error");
  assertEquals(ev.message, "something failed");
});
