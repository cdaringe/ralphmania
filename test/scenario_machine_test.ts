import { assertEquals } from "jsr:@std/assert@^1.0.11";
import {
  isTerminalScenario,
  stateToStatus,
  statusToState,
  validateProgressTransitions,
  validateTransition,
} from "../src/scenario-machine.ts";
import type { ScenarioState } from "../src/scenario-machine.ts";

// ---------------------------------------------------------------------------
// statusToState
// ---------------------------------------------------------------------------

Deno.test("statusToState maps empty string to unimplemented", () => {
  const s = statusToState("1.1", "");
  assertEquals(s?.tag, "unimplemented");
  assertEquals(s?.scenario, "1.1");
});

Deno.test("statusToState maps WIP", () => {
  assertEquals(statusToState("2.1", "WIP")?.tag, "wip");
});

Deno.test("statusToState maps WORK_COMPLETE", () => {
  assertEquals(statusToState("3.1", "WORK_COMPLETE")?.tag, "work_complete");
});

Deno.test("statusToState maps VERIFIED", () => {
  assertEquals(statusToState("4.1", "VERIFIED")?.tag, "verified");
});

Deno.test("statusToState maps NEEDS_REWORK with notes", () => {
  const s = statusToState("5.1", "NEEDS_REWORK", "fix the bug");
  assertEquals(s?.tag, "needs_rework");
  if (s?.tag === "needs_rework") {
    assertEquals(s.reworkNotes, "fix the bug");
  }
});

Deno.test("statusToState maps OBSOLETE", () => {
  assertEquals(statusToState("6.1", "OBSOLETE")?.tag, "obsolete");
});

Deno.test("statusToState returns undefined for unknown status", () => {
  assertEquals(statusToState("1", "COMPLETE"), undefined);
  assertEquals(statusToState("1", "DONE"), undefined);
});

Deno.test("statusToState trims whitespace", () => {
  assertEquals(statusToState("1", "  WIP  ")?.tag, "wip");
});

// ---------------------------------------------------------------------------
// stateToStatus
// ---------------------------------------------------------------------------

Deno.test("stateToStatus round-trips", () => {
  assertEquals(stateToStatus({ tag: "unimplemented", scenario: "1" }), "");
  assertEquals(stateToStatus({ tag: "wip", scenario: "1" }), "WIP");
  assertEquals(
    stateToStatus({ tag: "work_complete", scenario: "1" }),
    "WORK_COMPLETE",
  );
  assertEquals(stateToStatus({ tag: "verified", scenario: "1" }), "VERIFIED");
  assertEquals(
    stateToStatus({
      tag: "needs_rework",
      scenario: "1",
      reworkNotes: "",
    }),
    "NEEDS_REWORK",
  );
  assertEquals(stateToStatus({ tag: "obsolete", scenario: "1" }), "OBSOLETE");
});

// ---------------------------------------------------------------------------
// isTerminalScenario
// ---------------------------------------------------------------------------

Deno.test("isTerminalScenario for verified", () => {
  assertEquals(
    isTerminalScenario({ tag: "verified", scenario: "1" }),
    true,
  );
});

Deno.test("isTerminalScenario for obsolete", () => {
  assertEquals(
    isTerminalScenario({ tag: "obsolete", scenario: "1" }),
    true,
  );
});

Deno.test("isTerminalScenario for non-terminal states", () => {
  assertEquals(
    isTerminalScenario({ tag: "unimplemented", scenario: "1" }),
    false,
  );
  assertEquals(isTerminalScenario({ tag: "wip", scenario: "1" }), false);
  assertEquals(
    isTerminalScenario({ tag: "work_complete", scenario: "1" }),
    false,
  );
  assertEquals(
    isTerminalScenario({
      tag: "needs_rework",
      scenario: "1",
      reworkNotes: "",
    }),
    false,
  );
});

// ---------------------------------------------------------------------------
// validateTransition — valid transitions
// ---------------------------------------------------------------------------

const s = (tag: ScenarioState["tag"], scenario = "1"): ScenarioState =>
  tag === "needs_rework"
    ? { tag, scenario, reworkNotes: "" }
    : { tag, scenario } as ScenarioState;

Deno.test("valid: unimplemented → wip", () => {
  assertEquals(
    validateTransition(s("unimplemented"), s("wip")).ok,
    true,
  );
});

Deno.test("valid: unimplemented → work_complete", () => {
  assertEquals(
    validateTransition(s("unimplemented"), s("work_complete")).ok,
    true,
  );
});

Deno.test("valid: unimplemented → obsolete", () => {
  assertEquals(
    validateTransition(s("unimplemented"), s("obsolete")).ok,
    true,
  );
});

Deno.test("valid: wip → work_complete", () => {
  assertEquals(
    validateTransition(s("wip"), s("work_complete")).ok,
    true,
  );
});

Deno.test("valid: work_complete → verified", () => {
  assertEquals(
    validateTransition(s("work_complete"), s("verified")).ok,
    true,
  );
});

Deno.test("valid: work_complete → needs_rework", () => {
  assertEquals(
    validateTransition(s("work_complete"), s("needs_rework")).ok,
    true,
  );
});

Deno.test("valid: needs_rework → wip", () => {
  assertEquals(
    validateTransition(s("needs_rework"), s("wip")).ok,
    true,
  );
});

Deno.test("valid: needs_rework → work_complete", () => {
  assertEquals(
    validateTransition(s("needs_rework"), s("work_complete")).ok,
    true,
  );
});

Deno.test("valid: verified → needs_rework", () => {
  assertEquals(
    validateTransition(s("verified"), s("needs_rework")).ok,
    true,
  );
});

Deno.test("valid: self-transition is always allowed", () => {
  assertEquals(
    validateTransition(s("wip"), s("wip")).ok,
    true,
  );
  assertEquals(
    validateTransition(s("verified"), s("verified")).ok,
    true,
  );
});

// ---------------------------------------------------------------------------
// validateTransition — invalid transitions
// ---------------------------------------------------------------------------

Deno.test("invalid: unimplemented → verified (skips work_complete)", () => {
  const r = validateTransition(s("unimplemented"), s("verified"));
  assertEquals(r.ok, false);
});

Deno.test("invalid: unimplemented → needs_rework", () => {
  assertEquals(
    validateTransition(s("unimplemented"), s("needs_rework")).ok,
    false,
  );
});

Deno.test("invalid: verified → wip (must go through needs_rework)", () => {
  assertEquals(
    validateTransition(s("verified"), s("wip")).ok,
    false,
  );
});

Deno.test("invalid: verified → work_complete", () => {
  assertEquals(
    validateTransition(s("verified"), s("work_complete")).ok,
    false,
  );
});

Deno.test("invalid: obsolete → anything (terminal)", () => {
  assertEquals(
    validateTransition(s("obsolete"), s("wip")).ok,
    false,
  );
  assertEquals(
    validateTransition(s("obsolete"), s("unimplemented")).ok,
    false,
  );
  assertEquals(
    validateTransition(s("obsolete"), s("verified")).ok,
    false,
  );
});

Deno.test("invalid: wip → verified (must go through work_complete)", () => {
  assertEquals(
    validateTransition(s("wip"), s("verified")).ok,
    false,
  );
});

Deno.test("invalid transition includes reason with scenario number", () => {
  const r = validateTransition(
    s("unimplemented", "7.2"),
    s("verified", "7.2"),
  );
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.reason.includes("scenario 7.2"), true);
    assertEquals(r.reason.includes("unimplemented"), true);
    assertEquals(r.reason.includes("verified"), true);
  }
});

// ---------------------------------------------------------------------------
// validateProgressTransitions
// ---------------------------------------------------------------------------

Deno.test("validateProgressTransitions detects invalid transition", () => {
  const old = [{ scenario: "1.1", status: "" }];
  const next = [{ scenario: "1.1", status: "VERIFIED" }];
  const violations = validateProgressTransitions(old, next);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].ok, false);
});

Deno.test("validateProgressTransitions allows valid transition", () => {
  const old = [{ scenario: "1.1", status: "" }];
  const next = [{ scenario: "1.1", status: "WORK_COMPLETE" }];
  const violations = validateProgressTransitions(old, next);
  assertEquals(violations.length, 0);
});

Deno.test("validateProgressTransitions handles multiple scenarios", () => {
  const old = [
    { scenario: "1.1", status: "WORK_COMPLETE" },
    { scenario: "2.1", status: "" },
  ];
  const next = [
    { scenario: "1.1", status: "VERIFIED" }, // valid
    { scenario: "2.1", status: "VERIFIED" }, // invalid: skips work_complete
  ];
  const violations = validateProgressTransitions(old, next);
  assertEquals(violations.length, 1);
  if (!violations[0].ok) {
    assertEquals(violations[0].from, "unimplemented");
    assertEquals(violations[0].to, "verified");
  }
});

Deno.test("validateProgressTransitions ignores unchanged scenarios", () => {
  const old = [{ scenario: "1.1", status: "WIP" }];
  const next = [{ scenario: "1.1", status: "WIP" }];
  assertEquals(validateProgressTransitions(old, next).length, 0);
});

Deno.test("validateProgressTransitions handles new scenarios not in old", () => {
  const old: { scenario: string; status: string }[] = [];
  const next = [{ scenario: "5.1", status: "WORK_COMPLETE" }];
  // Old status defaults to "" (unimplemented), transition to WORK_COMPLETE is valid
  assertEquals(validateProgressTransitions(old, next).length, 0);
});
