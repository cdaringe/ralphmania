import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  dispatch,
  getActiveWorkers,
  getHydrated,
  getLogEvents,
  getLogVersion,
  getOrchestratorState,
  getWorkerLogBuffer,
  getWorkerLogVersion,
  resetStore,
  setHydrated,
} from "../src/gui/islands/event-store.ts";

Deno.test("event-store reset clears orchestrator and worker state", () => {
  resetStore();

  dispatch({
    type: "worker_active",
    workerIndex: 0,
    scenario: "GUI.a",
    ts: 1,
  });
  dispatch({
    type: "state",
    from: "init",
    to: "running_workers",
    ts: 2,
  });
  setHydrated(true);

  resetStore();

  assertEquals(getOrchestratorState(), "init");
  assertEquals(getHydrated(), false);
  assertEquals(getActiveWorkers().size, 0);
});

Deno.test("event-store does not infer orchestrator state from worker activity", () => {
  resetStore();

  dispatch({
    type: "worker_active",
    workerIndex: 0,
    scenario: "GUI.a",
    ts: 1,
  });
  assertEquals(getOrchestratorState(), "init");
  assertEquals(getActiveWorkers().get(0)?.scenario, "GUI.a");
});

Deno.test("event-store trims retained log history and bumps revisions", () => {
  resetStore();
  const initialLogVersion = getLogVersion();
  const initialWorkerLogVersion = getWorkerLogVersion();

  for (let i = 0; i < 1605; i++) {
    dispatch({
      type: "log",
      level: "info",
      tags: ["info"],
      message: `line ${i}`,
      ts: i,
      workerId: "GUI.a",
    });
  }

  assertEquals(getLogEvents().length, 1304);
  assertEquals(getLogEvents()[0]?.message, "line 301");
  assertEquals(getWorkerLogBuffer("GUI.a").length, 600);
  assertEquals(getWorkerLogBuffer("GUI.a")[0]?.message, "line 1005");
  assertEquals(getLogVersion() - initialLogVersion, 1605);
  assertEquals(getWorkerLogVersion() - initialWorkerLogVersion, 1605);
});
