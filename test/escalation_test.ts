import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  computeEffectiveLevel,
  readEscalationState,
  updateEscalationState,
  writeEscalationState,
} from "../src/orchestrator/escalation.ts";
import { ESCALATION_FILE } from "../src/constants.ts";
import { noopLog } from "./fixtures.ts";

// updateEscalationState tests

Deno.test("updateEscalationState adds new rework scenarios at level 1", () => {
  const result = updateEscalationState({
    current: {},
    reworkScenarios: ["3.1", "7.2"],
  });
  assertEquals(result, { "3.1": 1, "7.2": 1 });
});

Deno.test("updateEscalationState bumps existing scenarios capped at 1", () => {
  const result = updateEscalationState({
    current: { "3.1": 1, "7.2": 1 },
    reworkScenarios: ["3.1", "7.2"],
  });
  assertEquals(result, { "3.1": 1, "7.2": 1 });
});

Deno.test("updateEscalationState caps at level 1", () => {
  const result = updateEscalationState({
    current: { "3.1": 1 },
    reworkScenarios: ["3.1"],
  });
  assertEquals(result, { "3.1": 1 });
});

Deno.test("updateEscalationState removes cleared scenarios", () => {
  const result = updateEscalationState({
    current: { "3.1": 1, "7.2": 1 },
    reworkScenarios: ["3.1"],
  });
  assertEquals(result, { "3.1": 1 });
});

Deno.test("updateEscalationState handles mix of new, bump, and clear", () => {
  const result = updateEscalationState({
    current: { "1.1": 1, "5.1": 1 },
    reworkScenarios: ["1.1", "9.1"],
  });
  assertEquals(result, { "1.1": 1, "9.1": 1 });
});

// readEscalationState / writeEscalationState tests

Deno.test("readEscalationState returns {} when file missing", async () => {
  let existed = false;
  try {
    await Deno.rename(ESCALATION_FILE, ESCALATION_FILE + ".bak");
    existed = true;
  } catch { /* file doesn't exist */ }
  try {
    const result = await readEscalationState(noopLog);
    assertEquals(result, {});
  } finally {
    if (existed) {
      await Deno.rename(ESCALATION_FILE + ".bak", ESCALATION_FILE);
    }
  }
});

Deno.test("readEscalationState reads valid state", async () => {
  const original = await Deno.readTextFile(ESCALATION_FILE).catch(() => null);
  try {
    await Deno.mkdir(".ralph", { recursive: true });
    await Deno.writeTextFile(ESCALATION_FILE, '{"3":1}');
    const result = await readEscalationState(noopLog);
    assertEquals(result, { "3": 1 });
  } finally {
    if (original !== null) {
      await Deno.writeTextFile(ESCALATION_FILE, original);
    } else {
      await Deno.remove(ESCALATION_FILE).catch(() => {});
    }
  }
});

Deno.test("writeEscalationState persists state", async () => {
  const original = await Deno.readTextFile(ESCALATION_FILE).catch(() => null);
  try {
    await writeEscalationState({ "5": 1 }, noopLog);
    const content = JSON.parse(await Deno.readTextFile(ESCALATION_FILE));
    assertEquals(content, { "5": 1 });
  } finally {
    if (original !== null) {
      await Deno.writeTextFile(ESCALATION_FILE, original);
    } else {
      await Deno.remove(ESCALATION_FILE).catch(() => {});
    }
  }
});

// computeEffectiveLevel tests

Deno.test("computeEffectiveLevel: returns 0 when both minLevel and scenario level are 0", () => {
  assertEquals(computeEffectiveLevel("1", { "1": 0 }, 0), 0);
});

Deno.test("computeEffectiveLevel: scenario level 1 overrides minLevel 0", () => {
  assertEquals(computeEffectiveLevel("1", { "1": 1 }, 0), 1);
});

Deno.test("computeEffectiveLevel: minLevel 1 overrides scenario level 0", () => {
  assertEquals(computeEffectiveLevel("1", { "1": 0 }, 1), 1);
});

Deno.test("computeEffectiveLevel: undefined scenario returns 0 when minLevel is 0", () => {
  assertEquals(computeEffectiveLevel(undefined, {}, 0), 0);
});

Deno.test("computeEffectiveLevel: undefined scenario uses minLevel", () => {
  assertEquals(computeEffectiveLevel(undefined, {}, 1), 1);
});

Deno.test("computeEffectiveLevel: missing scenario in state defaults to 0", () => {
  assertEquals(computeEffectiveLevel("99", {}, undefined), 0);
});
