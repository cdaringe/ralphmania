import { assertEquals } from "jsr:@std/assert@^1";
import {
  isTerminalScenario,
  stateToStatus,
  statusToState,
  validateProgressTransitions,
  validateTransition,
} from "./scenario-machine.ts";

// ---------------------------------------------------------------------------
// statusToState
// ---------------------------------------------------------------------------

Deno.test("statusToState: empty string → unimplemented", () => {
  const s = statusToState("ARCH.1", "");
  assertEquals(s?.tag, "unimplemented");
  assertEquals(s?.scenario, "ARCH.1");
});

Deno.test("statusToState: WIP → wip", () => {
  const s = statusToState("1", "WIP");
  assertEquals(s?.tag, "wip");
});

Deno.test("statusToState: WORK_COMPLETE → work_complete", () => {
  const s = statusToState("2", "WORK_COMPLETE");
  assertEquals(s?.tag, "work_complete");
});

Deno.test("statusToState: VERIFIED → verified", () => {
  const s = statusToState("3", "VERIFIED");
  assertEquals(s?.tag, "verified");
});

Deno.test("statusToState: NEEDS_REWORK → needs_rework with reworkNotes", () => {
  const s = statusToState("4", "NEEDS_REWORK", "fix the tests");
  assertEquals(s?.tag, "needs_rework");
  if (s?.tag === "needs_rework") {
    assertEquals(s.reworkNotes, "fix the tests");
  }
});

Deno.test("statusToState: OBSOLETE → obsolete", () => {
  const s = statusToState("5", "OBSOLETE");
  assertEquals(s?.tag, "obsolete");
});

Deno.test("statusToState: unknown status → undefined", () => {
  const s = statusToState("6", "INVALID_STATUS");
  assertEquals(s, undefined);
});

Deno.test("statusToState: trims whitespace from status", () => {
  const s = statusToState("7", "  WIP  ");
  assertEquals(s?.tag, "wip");
});

// ---------------------------------------------------------------------------
// stateToStatus
// ---------------------------------------------------------------------------

Deno.test("stateToStatus: unimplemented → empty string", () => {
  assertEquals(stateToStatus({ tag: "unimplemented", scenario: "1" }), "");
});

Deno.test("stateToStatus: wip → WIP", () => {
  assertEquals(stateToStatus({ tag: "wip", scenario: "1" }), "WIP");
});

Deno.test("stateToStatus: work_complete → WORK_COMPLETE", () => {
  assertEquals(
    stateToStatus({ tag: "work_complete", scenario: "1" }),
    "WORK_COMPLETE",
  );
});

Deno.test("stateToStatus: verified → VERIFIED", () => {
  assertEquals(stateToStatus({ tag: "verified", scenario: "1" }), "VERIFIED");
});

Deno.test("stateToStatus: needs_rework → NEEDS_REWORK", () => {
  assertEquals(
    stateToStatus({ tag: "needs_rework", scenario: "1", reworkNotes: "" }),
    "NEEDS_REWORK",
  );
});

Deno.test("stateToStatus: obsolete → OBSOLETE", () => {
  assertEquals(stateToStatus({ tag: "obsolete", scenario: "1" }), "OBSOLETE");
});

// ---------------------------------------------------------------------------
// isTerminalScenario
// ---------------------------------------------------------------------------

Deno.test("isTerminalScenario: verified is terminal", () => {
  assertEquals(isTerminalScenario({ tag: "verified", scenario: "1" }), true);
});

Deno.test("isTerminalScenario: obsolete is terminal", () => {
  assertEquals(isTerminalScenario({ tag: "obsolete", scenario: "1" }), true);
});

Deno.test("isTerminalScenario: wip is not terminal", () => {
  assertEquals(isTerminalScenario({ tag: "wip", scenario: "1" }), false);
});

Deno.test("isTerminalScenario: needs_rework is not terminal", () => {
  assertEquals(
    isTerminalScenario({ tag: "needs_rework", scenario: "1", reworkNotes: "" }),
    false,
  );
});

// ---------------------------------------------------------------------------
// validateTransition — valid paths
// ---------------------------------------------------------------------------

Deno.test("validateTransition: unimplemented → wip is valid", () => {
  const result = validateTransition(
    { tag: "unimplemented", scenario: "1" },
    { tag: "wip", scenario: "1" },
  );
  assertEquals(result.ok, true);
});

Deno.test("validateTransition: unimplemented → work_complete is valid", () => {
  const result = validateTransition(
    { tag: "unimplemented", scenario: "1" },
    { tag: "work_complete", scenario: "1" },
  );
  assertEquals(result.ok, true);
});

Deno.test("validateTransition: unimplemented → obsolete is valid", () => {
  const result = validateTransition(
    { tag: "unimplemented", scenario: "1" },
    { tag: "obsolete", scenario: "1" },
  );
  assertEquals(result.ok, true);
});

Deno.test("validateTransition: wip → work_complete is valid", () => {
  const result = validateTransition(
    { tag: "wip", scenario: "1" },
    { tag: "work_complete", scenario: "1" },
  );
  assertEquals(result.ok, true);
});

Deno.test("validateTransition: wip → needs_rework is valid", () => {
  const result = validateTransition(
    { tag: "wip", scenario: "1" },
    { tag: "needs_rework", scenario: "1", reworkNotes: "" },
  );
  assertEquals(result.ok, true);
});

Deno.test("validateTransition: wip → obsolete is valid", () => {
  const result = validateTransition(
    { tag: "wip", scenario: "1" },
    { tag: "obsolete", scenario: "1" },
  );
  assertEquals(result.ok, true);
});

Deno.test("validateTransition: work_complete → verified is valid", () => {
  const result = validateTransition(
    { tag: "work_complete", scenario: "1" },
    { tag: "verified", scenario: "1" },
  );
  assertEquals(result.ok, true);
});

Deno.test("validateTransition: work_complete → needs_rework is valid", () => {
  const result = validateTransition(
    { tag: "work_complete", scenario: "1" },
    { tag: "needs_rework", scenario: "1", reworkNotes: "" },
  );
  assertEquals(result.ok, true);
});

Deno.test("validateTransition: needs_rework → wip is valid", () => {
  const result = validateTransition(
    { tag: "needs_rework", scenario: "1", reworkNotes: "" },
    { tag: "wip", scenario: "1" },
  );
  assertEquals(result.ok, true);
});

Deno.test("validateTransition: needs_rework → work_complete is valid", () => {
  const result = validateTransition(
    { tag: "needs_rework", scenario: "1", reworkNotes: "" },
    { tag: "work_complete", scenario: "1" },
  );
  assertEquals(result.ok, true);
});

Deno.test("validateTransition: verified → needs_rework is valid", () => {
  const result = validateTransition(
    { tag: "verified", scenario: "1" },
    { tag: "needs_rework", scenario: "1", reworkNotes: "" },
  );
  assertEquals(result.ok, true);
});

Deno.test("validateTransition: verified → obsolete is valid", () => {
  const result = validateTransition(
    { tag: "verified", scenario: "1" },
    { tag: "obsolete", scenario: "1" },
  );
  assertEquals(result.ok, true);
});

Deno.test("validateTransition: self-transition is always valid", () => {
  const result = validateTransition(
    { tag: "wip", scenario: "1" },
    { tag: "wip", scenario: "1" },
  );
  assertEquals(result.ok, true);
});

// ---------------------------------------------------------------------------
// validateTransition — invalid paths
// ---------------------------------------------------------------------------

Deno.test("validateTransition: unimplemented → verified is invalid", () => {
  const result = validateTransition(
    { tag: "unimplemented", scenario: "1" },
    { tag: "verified", scenario: "1" },
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.from, "unimplemented");
    assertEquals(result.to, "verified");
  }
});

Deno.test("validateTransition: verified → wip is invalid", () => {
  const result = validateTransition(
    { tag: "verified", scenario: "1" },
    { tag: "wip", scenario: "1" },
  );
  assertEquals(result.ok, false);
});

Deno.test("validateTransition: obsolete → anything is invalid", () => {
  const result = validateTransition(
    { tag: "obsolete", scenario: "1" },
    { tag: "wip", scenario: "1" },
  );
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.from, "obsolete");
  }
});

Deno.test("validateTransition: wip → verified is invalid (must pass work_complete)", () => {
  const result = validateTransition(
    { tag: "wip", scenario: "1" },
    { tag: "verified", scenario: "1" },
  );
  assertEquals(result.ok, false);
});

// ---------------------------------------------------------------------------
// validateProgressTransitions
// ---------------------------------------------------------------------------

Deno.test("validateProgressTransitions: no changes → no violations", () => {
  const rows = [{ scenario: "1", status: "WIP" }];
  const violations = validateProgressTransitions(rows, rows);
  assertEquals(violations.length, 0);
});

Deno.test("validateProgressTransitions: valid WIP → WORK_COMPLETE", () => {
  const old = [{ scenario: "1", status: "WIP" }];
  const next = [{ scenario: "1", status: "WORK_COMPLETE" }];
  const violations = validateProgressTransitions(old, next);
  assertEquals(violations.length, 0);
});

Deno.test("validateProgressTransitions: invalid jump → reports violation", () => {
  const old = [{ scenario: "1", status: "WIP" }];
  const next = [{ scenario: "1", status: "VERIFIED" }];
  const violations = validateProgressTransitions(old, next);
  assertEquals(violations.length, 1);
  assertEquals(violations[0]?.ok, false);
  if (!violations[0]?.ok) {
    assertEquals(violations[0].from, "wip");
    assertEquals(violations[0].to, "verified");
  }
});

Deno.test("validateProgressTransitions: new scenario (no old entry) treated as unimplemented", () => {
  const old: Array<{ scenario: string; status: string }> = [];
  const next = [{ scenario: "1", status: "WIP" }];
  const violations = validateProgressTransitions(old, next);
  assertEquals(violations.length, 0);
});

Deno.test("validateProgressTransitions: logs transitions when log provided", () => {
  const messages: string[] = [];
  const log = (opts: { message: string }): void => {
    messages.push(opts.message);
  };
  const old = [{ scenario: "1", status: "WIP" }];
  const next = [{ scenario: "1", status: "WORK_COMPLETE" }];
  validateProgressTransitions(
    old,
    next,
    log as Parameters<typeof validateProgressTransitions>[2],
  );
  assertEquals(messages.length > 0, true);
});

Deno.test("validateProgressTransitions: skips unknown status rows", () => {
  const old = [{ scenario: "1", status: "UNKNOWN" }];
  const next = [{ scenario: "1", status: "ALSO_UNKNOWN" }];
  const violations = validateProgressTransitions(old, next);
  assertEquals(violations.length, 0);
});

Deno.test("validateProgressTransitions: multiple scenarios, one violation", () => {
  const old = [
    { scenario: "1", status: "WIP" },
    { scenario: "2", status: "WORK_COMPLETE" },
  ];
  const next = [
    { scenario: "1", status: "WORK_COMPLETE" }, // valid
    { scenario: "2", status: "WIP" }, // invalid: work_complete → wip
  ];
  const violations = validateProgressTransitions(old, next);
  assertEquals(violations.length, 1);
  if (!violations[0]?.ok) {
    assertEquals(violations[0]?.from, "work_complete");
    assertEquals(violations[0]?.to, "wip");
  }
});
