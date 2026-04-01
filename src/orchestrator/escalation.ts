import type { EscalationLevel, EscalationState, Logger } from "../types.ts";
import { ESCALATION_FILE } from "../constants.ts";

/** Injectable I/O deps for escalation persistence. */
export type EscalationIODeps = {
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
};

/* c8 ignore start — thin Deno I/O wiring */
const defaultEscalationIO: EscalationIODeps = {
  readTextFile: (p) => Deno.readTextFile(p),
  writeTextFile: (p, c) => Deno.writeTextFile(p, c),
  mkdir: (p, o) => Deno.mkdir(p, o),
};
/* c8 ignore stop */

const clampLevel = (n: number): EscalationLevel => n >= 1 ? 1 : 0;

/**
 * Pure escalation-state transition.
 *
 * - Scenarios still in rework: bump level (capped at 3).
 * - Scenarios newly in rework: start at level 1.
 * - Scenarios no longer in rework: removed from state.
 */
export const updateEscalationState = (
  { current, reworkScenarios }: {
    current: EscalationState;
    reworkScenarios: string[];
  },
): EscalationState =>
  Object.fromEntries(
    [...new Set(reworkScenarios)].map((key) => [
      key,
      clampLevel(current[key] !== undefined ? current[key] + 1 : 1),
    ]),
  );

/**
 * Compute the effective escalation level for a given scenario by combining
 * the per-scenario state from `.ralph/escalation.json` with the operator's
 * floor (`minLevel`). Result is clamped to the binary {@link EscalationLevel}
 * range (0 | 1). Pure derivation — no I/O.
 */
export const computeEffectiveLevel = (
  scenario: string | undefined,
  escalation: EscalationState,
  minLevel: EscalationLevel | undefined,
): EscalationLevel => {
  const scenarioLevel = scenario !== undefined
    ? (escalation[scenario] ?? 0)
    : 0;
  return clampLevel(Math.max(minLevel ?? 0, scenarioLevel));
};

/** Read persisted escalation state, defaulting to `{}` if missing. */
export const readEscalationState = async (
  log: Logger,
  io: EscalationIODeps = defaultEscalationIO,
): Promise<EscalationState> => {
  try {
    return JSON.parse(await io.readTextFile(ESCALATION_FILE));
  } catch {
    log({
      tags: ["debug", "escalation"],
      message: "No escalation state found, starting fresh",
    });
    return {};
  }
};

/** Serialize concurrent writes so parallel workers don't clobber each other. */
let writeLock: Promise<void> = Promise.resolve();

/** Persist escalation state to `.ralph/escalation.json`. */
export const writeEscalationState = async (
  state: EscalationState,
  log: Logger,
  io: EscalationIODeps = defaultEscalationIO,
): Promise<void> => {
  // Chain writes so concurrent calls are serialized, not interleaved.
  const prev = writeLock;
  writeLock = prev.then(async () => {
    try {
      await io.mkdir(".ralph", { recursive: true });
      await io.writeTextFile(ESCALATION_FILE, JSON.stringify(state));
    } catch (e) {
      log({
        tags: ["error", "escalation"],
        message: `Failed to write escalation state: ${e}`,
      });
    }
  });
  await writeLock;
};
