import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  createEventBus,
  type GuiEvent,
  type GuiLogEvent,
} from "../src/gui/events.ts";

Deno.test("createEventBus emits to subscriber", () => {
  const bus = createEventBus();
  const received: GuiEvent[] = [];
  bus.subscribe((e) => received.push(e));

  const event: GuiLogEvent = {
    type: "log",
    level: "info",
    tags: ["info"],
    message: "hello",
    ts: 1,
  };
  bus.emit(event);

  assertEquals(received.length, 1);
  assertEquals(received[0], event);
});

Deno.test("createEventBus emits to multiple subscribers", () => {
  const bus = createEventBus();
  const r1: GuiEvent[] = [];
  const r2: GuiEvent[] = [];
  bus.subscribe((e) => r1.push(e));
  bus.subscribe((e) => r2.push(e));

  bus.emit({ type: "state", from: "init", to: "reading_progress", ts: 1 });

  assertEquals(r1.length, 1);
  assertEquals(r2.length, 1);
  assertEquals(r1[0], r2[0]);
});

Deno.test("createEventBus unsubscribe stops delivery", () => {
  const bus = createEventBus();
  const received: GuiEvent[] = [];
  const unsub = bus.subscribe((e) => received.push(e));

  bus.emit({
    type: "log",
    level: "info",
    tags: ["info"],
    message: "before",
    ts: 1,
  });
  unsub();
  bus.emit({
    type: "log",
    level: "info",
    tags: ["info"],
    message: "after",
    ts: 2,
  });

  assertEquals(received.length, 1);
  assertEquals((received[0] as GuiLogEvent).message, "before");
});

Deno.test("createEventBus handles worker_active and worker_done events", () => {
  const bus = createEventBus();
  const received: GuiEvent[] = [];
  bus.subscribe((e) => received.push(e));

  bus.emit({ type: "worker_active", workerIndex: 0, scenario: "GUI.a", ts: 1 });
  bus.emit({ type: "worker_done", workerIndex: 0, ts: 2 });

  assertEquals(received.length, 2);
  assertEquals(received[0].type, "worker_active");
  assertEquals(received[1].type, "worker_done");
});

Deno.test("createEventBus second unsubscribe is a no-op", () => {
  const bus = createEventBus();
  const received: GuiEvent[] = [];
  const unsub = bus.subscribe((e) => received.push(e));

  unsub();
  unsub(); // should not throw

  bus.emit({ type: "state", from: "init", to: "done", ts: 1 });
  assertEquals(received.length, 0);
});

Deno.test("createEventBus with no subscribers does not throw", () => {
  const bus = createEventBus();
  bus.emit({ type: "state", from: "init", to: "reading_progress", ts: 1 });
  // no assertion needed — just ensuring no throw
});
