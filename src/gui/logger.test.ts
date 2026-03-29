// Tests for createGuiLogger — including merge event detection (GUI.0)
import { assertEquals } from "jsr:@std/assert@^1";
import { createGuiLogger } from "./logger.ts";
import { createEventBus } from "./events.ts";
import type { GuiEvent } from "./events.ts";

function makeLogger(): {
  events: GuiEvent[];
  logger: ReturnType<typeof createGuiLogger>;
} {
  const bus = createEventBus();
  const events: GuiEvent[] = [];
  bus.subscribe((ev) => events.push(ev));
  const logger = createGuiLogger(() => {}, bus);
  return { events, logger };
}

Deno.test("createGuiLogger: emits log event for every call", () => {
  const { events, logger } = makeLogger();
  logger({ tags: ["info"], message: "hello" });
  const logEvents = events.filter((e) => e.type === "log");
  assertEquals(logEvents.length, 1);
  assertEquals((logEvents[0] as { message: string }).message, "hello");
});

Deno.test("createGuiLogger: emits state event on transition log", () => {
  const { events, logger } = makeLogger();
  logger({
    tags: ["debug", "orchestrator", "transition"],
    message: "init \u2192 reading_progress",
  });
  const stateEvents = events.filter((e) => e.type === "state");
  assertEquals(stateEvents.length, 1);
  const ev = stateEvents[0] as { from: string; to: string };
  assertEquals(ev.from, "init");
  assertEquals(ev.to, "reading_progress");
});

Deno.test("createGuiLogger: emits worker_active events on launch log", () => {
  const { events, logger } = makeLogger();
  logger({
    tags: ["info", "orchestrator"],
    message: "Round 0: launching 2 worker(s) for scenarios [GUI.0, ARCH.1]",
  });
  const workerEvents = events.filter((e) => e.type === "worker_active");
  assertEquals(workerEvents.length, 2);
  const e0 = workerEvents[0] as { workerIndex: number; scenario: string };
  assertEquals(e0.workerIndex, 0);
  assertEquals(e0.scenario, "GUI.0");
  const e1 = workerEvents[1] as { workerIndex: number; scenario: string };
  assertEquals(e1.workerIndex, 1);
  assertEquals(e1.scenario, "ARCH.1");
});

Deno.test("createGuiLogger: emits worker_done on resolution log", () => {
  const { events, logger } = makeLogger();
  logger({
    tags: ["info", "orchestrator"],
    message: "Scenario GUI.0: resolved by worker 0",
  });
  const doneEvents = events.filter((e) => e.type === "worker_done");
  assertEquals(doneEvents.length, 1);
  assertEquals((doneEvents[0] as { workerIndex: number }).workerIndex, 0);
});

Deno.test("createGuiLogger: emits merge_start on merge log", () => {
  const { events, logger } = makeLogger();
  logger({
    tags: ["info", "orchestrator"],
    message: "Merging worker 1 (GUI.0)",
  });
  const mergeEvents = events.filter((e) => e.type === "merge_start");
  assertEquals(mergeEvents.length, 1);
  const ev = mergeEvents[0] as { workerIndex: number; scenario: string };
  assertEquals(ev.workerIndex, 1);
  assertEquals(ev.scenario, "GUI.0");
});

Deno.test("createGuiLogger: emits merge_done with outcome", () => {
  const { events, logger } = makeLogger();
  logger({
    tags: ["info", "orchestrator"],
    message: "Worker 2 merge: conflict",
  });
  const mergeDone = events.filter((e) => e.type === "merge_done");
  assertEquals(mergeDone.length, 1);
  const ev = mergeDone[0] as { workerIndex: number; outcome: string };
  assertEquals(ev.workerIndex, 2);
  assertEquals(ev.outcome, "conflict");
});

Deno.test("createGuiLogger: merge_done recognises all outcomes", () => {
  for (const outcome of ["merged", "conflict", "no-changes"] as const) {
    const { events, logger } = makeLogger();
    logger({ tags: ["info"], message: `Worker 0 merge: ${outcome}` });
    const ev = events.find((e) => e.type === "merge_done") as
      | { outcome: string }
      | undefined;
    assertEquals(ev?.outcome, outcome);
  }
});
