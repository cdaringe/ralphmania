import type {
  Agent,
  EscalationLevel,
  EscalationState,
  Logger,
  ModelSelection,
  Result,
} from "./types.ts";
import { err, ok } from "./types.ts";
import {
  CLAUDE_CODER,
  CLAUDE_ESCALATED,
  CLAUDE_VERIFIER,
  ESCALATION_FILE,
  REWORK_THRESHOLD,
} from "./constants.ts";

export const getModel = (
  { agent, mode }: { agent: Agent; mode: "fast" | "general" | "strong" },
): string =>
  (agent === "claude"
    ? {
      fast: "haiku",
      general: "sonnet",
      strong: "opus",
    } as const
    : {
      fast: "gpt-5.1-codex",
      general: "gpt-5.1-codex-max",
      strong: "gpt-5.3-codex",
    } as const)[mode];

export const detectScenarioFromProgress = (
  content: string,
): Result<number | undefined, string> => {
  const reworkLine = content.split("\n")
    .find((line) => /^\|\s*\d+\s*\|\s*NEEDS_REWORK\s*\|/.test(line));
  const scenario = reworkLine
    ? parseInt(reworkLine.match(/^\|\s*(\d+)/)?.[1] ?? "", 10)
    : NaN;

  return !reworkLine
    ? ok(undefined)
    : isNaN(scenario)
    ? err(`Failed to parse scenario number from line: ${reworkLine}`)
    : ok(scenario);
};

/** Find ALL scenario numbers with NEEDS_REWORK status. */
export const findReworkScenarios = (content: string): number[] => {
  const matches = content.matchAll(/^\|\s*(\d+)\s*\|\s*NEEDS_REWORK\s*\|/gm);
  return [...matches].map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n));
};

/**
 * Pure escalation-state transition.
 *
 * - Scenarios still in rework: bump level (capped at 3).
 * - Scenarios newly in rework: start at level 1.
 * - Scenarios no longer in rework: removed from state.
 */
const clampLevel = (n: number): EscalationLevel => n >= 1 ? 1 : 0;

export const updateEscalationState = (
  { current, reworkScenarios }: {
    current: EscalationState;
    reworkScenarios: number[];
  },
): EscalationState =>
  Object.fromEntries(
    [...new Set(reworkScenarios.map(String))].map((key) => [
      key,
      clampLevel(current[key] !== undefined ? current[key] + 1 : 1),
    ]),
  );

export const computeModelSelection = (
  { content, agent, escalationLevel, isVerifierMode }: {
    content: string;
    agent: Agent;
    escalationLevel?: EscalationLevel;
    isVerifierMode?: boolean;
  },
): Result<ModelSelection, string> => {
  const scenarioResult = detectScenarioFromProgress(content);

  return !scenarioResult.ok
    ? scenarioResult
    : agent === "claude" && escalationLevel !== undefined
    ? ok({
      ...(escalationLevel >= 1
        ? CLAUDE_ESCALATED
        : isVerifierMode
        ? CLAUDE_VERIFIER
        : CLAUDE_CODER),
      targetScenario: scenarioResult.value,
    })
    : (() => {
      const reworkCount = (content.match(/NEEDS_REWORK/g) ?? []).length;
      const mode = reworkCount > REWORK_THRESHOLD
        ? "strong" as const
        : reworkCount > 0
        ? "general" as const
        : "fast" as const;
      return ok({
        model: getModel({ agent, mode }),
        mode,
        targetScenario: scenarioResult.value,
        effort: undefined,
      });
    })();
};

/** Count rows with COMPLETE or VERIFIED status in progress.md content. */
export const parseImplementedCount = (content: string): number =>
  (content.match(/^\|\s*\d+\s*\|\s*(COMPLETE|VERIFIED)\s*\|/gm) ?? []).length;

/** Count total scenario rows in progress.md content. */
export const parseTotalCount = (content: string): number =>
  (content.match(/^\|\s*\d+\s*\|/gm) ?? []).length;

/** Find scenario numbers that are not COMPLETE or VERIFIED (i.e. actionable). */
export const findActionableScenarios = (content: string): number[] => {
  const total = [...content.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) =>
    parseInt(m[1], 10)
  );
  const done = new Set(
    [...content.matchAll(/^\|\s*(\d+)\s*\|\s*(COMPLETE|VERIFIED)\s*\|/gm)].map(
      (m) => parseInt(m[1], 10),
    ),
  );
  return total.filter((n) => !done.has(n));
};

/** Check whether every scenario row is VERIFIED. */
export const isAllVerified = (content: string): boolean => {
  const totalCount = parseTotalCount(content);
  if (totalCount === 0) return false;
  const verifiedCount =
    (content.match(/^\|\s*\d+\s*\|\s*VERIFIED\s*\|/gm) ?? []).length;
  return verifiedCount === totalCount;
};

/** Read persisted escalation state, defaulting to `{}` if missing. */
export const readEscalationState = async (
  log: Logger,
): Promise<EscalationState> => {
  try {
    return JSON.parse(await Deno.readTextFile(ESCALATION_FILE));
  } catch {
    log({
      tags: ["debug", "escalation"],
      message: "No escalation state found, starting fresh",
    });
    return {};
  }
};

/** Persist escalation state to `.ralph/escalation.json`. */
export const writeEscalationState = async (
  state: EscalationState,
  log: Logger,
): Promise<void> => {
  try {
    await Deno.mkdir(".ralph", { recursive: true });
    await Deno.writeTextFile(ESCALATION_FILE, JSON.stringify(state));
  } catch (e) {
    log({
      tags: ["error", "escalation"],
      message: `Failed to write escalation state: ${e}`,
    });
  }
};

export const resolveModelSelection = async (
  { agent, log, minLevel }: {
    agent: Agent;
    log: Logger;
    minLevel?: EscalationLevel;
  },
): Promise<ModelSelection> => {
  const defaultMode = "fast" as const;
  const defaults: ModelSelection = {
    model: getModel({ agent, mode: defaultMode }),
    mode: defaultMode,
    targetScenario: undefined,
    effort: undefined,
  };

  const rawContent = await Deno.readTextFile("./progress.md").catch(() => "");
  const content = rawContent.split("END_DEMO")[1];

  if (!content) {
    log({
      tags: ["error", "model"],
      message: "progress.md missing or lacks END_DEMO sigil",
    });
    return defaults;
  }

  // Claude per-scenario escalation
  if (agent === "claude") {
    const currentState = await readEscalationState(log);
    const reworkScenarios = findReworkScenarios(content);
    const newState = updateEscalationState({
      current: currentState,
      reworkScenarios,
    });
    await writeEscalationState(newState, log);

    const scenarioResult = detectScenarioFromProgress(content);
    if (!scenarioResult.ok) {
      log({ tags: ["error", "model"], message: scenarioResult.error });
      return defaults;
    }

    const target = scenarioResult.value;
    const stateLevel: EscalationLevel =
      (target !== undefined ? newState[String(target)] : undefined) ?? 0;

    // Role detection
    const isVerifierMode = reworkScenarios.length === 0 &&
      parseImplementedCount(content) === parseTotalCount(content);
    const effectiveLevel: EscalationLevel = reworkScenarios.length > 0
      ? clampLevel(Math.max(1, stateLevel, minLevel ?? 0))
      : clampLevel(Math.max(stateLevel, minLevel ?? 0));

    const result = computeModelSelection({
      content,
      agent,
      escalationLevel: effectiveLevel,
      isVerifierMode,
    });

    if (!result.ok) {
      log({ tags: ["error", "model"], message: result.error });
      return defaults;
    }

    const { model, mode, effort, targetScenario } = result.value;
    const reworkCount = reworkScenarios.length;
    const statusMessage = reworkCount > 0
      ? `${reworkCount} NEEDS_REWORK entries → ${model} (effort: ${effort}, level: ${effectiveLevel})`
      : `Status: ${parseImplementedCount(content)} of ${
        parseTotalCount(content)
      } implemented, finding next task...`;
    log({ tags: ["info", "model"], message: statusMessage });

    if (mode === "strong" && targetScenario !== undefined) {
      log({
        tags: ["info", "scenario"],
        message: `strong-model pass scoped to scenario ${targetScenario}`,
      });
    }

    return result.value;
  }

  // Codex path: existing 3-tier rework-count escalation
  const result = computeModelSelection({ content, agent });
  if (!result.ok) {
    log({ tags: ["error", "model"], message: result.error });
    return defaults;
  }

  const { model, mode, targetScenario } = result.value;
  const reworkCount = (content.match(/NEEDS_REWORK/g) ?? []).length;
  const statusMessage = reworkCount > 0
    ? `${reworkCount} NEEDS_REWORK entries → using ${model}`
    : `Status: ${parseImplementedCount(content)} of ${
      parseTotalCount(content)
    } implemented, finding next task...`;
  log({ tags: ["info", "model"], message: statusMessage });

  if (mode === "strong" && targetScenario !== undefined) {
    log({
      tags: ["info", "scenario"],
      message: `strong-model pass scoped to scenario ${targetScenario}`,
    });
  }

  return result.value;
};
