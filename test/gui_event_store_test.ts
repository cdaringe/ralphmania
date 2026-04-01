import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  dispatch,
  getActiveWorkers,
  getHydrated,
  getOrchestratorState,
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
