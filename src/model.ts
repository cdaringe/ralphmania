import type {
  Agent,
  EffortLevel,
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
  VALID_STATUSES,
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
  const actionableScenarios = findActionableScenarios(content);

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
      actionableScenarios,
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
        actionableScenarios,
      });
    })();
};

/** Count rows with WORK_COMPLETE or VERIFIED status in progress.md content. */
export const parseImplementedCount = (content: string): number =>
  (content.match(/^\|\s*\d+\s*\|\s*(WORK_COMPLETE|VERIFIED)\s*\|/gm) ?? [])
    .length;

/** Count total non-OBSOLETE scenario rows in progress.md content. */
export const parseTotalCount = (content: string): number =>
  (content.match(/^\|\s*\d+\s*\|/gm) ?? []).length -
  (content.match(/^\|\s*\d+\s*\|\s*OBSOLETE\s*\|/gm) ?? []).length;

/** Find scenario numbers that are not WORK_COMPLETE, VERIFIED, or OBSOLETE (i.e. actionable). */
export const findActionableScenarios = (content: string): number[] => {
  const total = [...content.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) =>
    parseInt(m[1], 10)
  );
  const done = new Set(
    [
      ...content.matchAll(
        /^\|\s*(\d+)\s*\|\s*(WORK_COMPLETE|VERIFIED|OBSOLETE)\s*\|/gm,
      ),
    ].map((m) => parseInt(m[1], 10)),
  );
  return total.filter((n) => !done.has(n));
};

/** Check whether every non-OBSOLETE scenario row is VERIFIED. */
export const isAllVerified = (
  content: string,
  expectedCount: number,
): boolean =>
  expectedCount > 0 &&
  (content.match(/^\|\s*\d+\s*\|\s*VERIFIED\s*\|/gm) ?? []).length +
        (content.match(/^\|\s*\d+\s*\|\s*OBSOLETE\s*\|/gm) ?? []).length ===
    expectedCount;

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

/**
 * Validate that every scenario row in progress.md uses a recognized status.
 * Returns an array of `{ scenario, status }` for each invalid entry.
 */
export const validateProgressStatuses = (
  content: string,
): { scenario: number; status: string }[] => {
  const validSet = new Set<string>(VALID_STATUSES);
  const rows = [...content.matchAll(/^\|\s*(\d+)\s*\|\s*([^\s|]+)\s*\|/gm)];
  return rows
    .map((m) => ({ scenario: parseInt(m[1], 10), status: m[2] }))
    .filter((r) => !validSet.has(r.status));
};

const formatStatusMessage = (
  { reworkCount, model, content, effort, level }: {
    reworkCount: number;
    model: string;
    content: string;
    effort?: EffortLevel;
    level?: EscalationLevel;
  },
): string =>
  reworkCount > 0
    ? `${reworkCount} NEEDS_REWORK entries → ${
      effort !== undefined
        ? `${model} (effort: ${effort}, level: ${level})`
        : `using ${model}`
    }`
    : `Status: ${parseImplementedCount(content)} of ${
      parseTotalCount(content)
    } implemented, finding next task...`;

const logStrongScope = (
  log: Logger,
  selection: ModelSelection,
): void => {
  selection.mode === "strong" && selection.targetScenario !== undefined &&
    log({
      tags: ["info", "scenario"],
      message:
        `strong-model pass scoped to scenario ${selection.targetScenario}`,
    });
};

const resolveClaudeSelection = async (
  { content, log, minLevel, defaults }: {
    content: string;
    log: Logger;
    minLevel?: EscalationLevel;
    defaults: ModelSelection;
  },
): Promise<ModelSelection> => {
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

  const isVerifierMode = reworkScenarios.length === 0 &&
    parseImplementedCount(content) === parseTotalCount(content);
  const effectiveLevel: EscalationLevel = reworkScenarios.length > 0
    ? clampLevel(Math.max(1, stateLevel, minLevel ?? 0))
    : clampLevel(Math.max(stateLevel, minLevel ?? 0));

  const result = computeModelSelection({
    content,
    agent: "claude",
    escalationLevel: effectiveLevel,
    isVerifierMode,
  });

  if (!result.ok) {
    log({ tags: ["error", "model"], message: result.error });
    return defaults;
  }

  // When no NEEDS_REWORK but unimplemented scenarios exist, scope to the
  // first actionable one so the agent doesn't overlook empty rows.
  const resolvedTarget = result.value.targetScenario === undefined &&
      !isVerifierMode
    ? result.value.actionableScenarios[0]
    : result.value.targetScenario;
  const selection = { ...result.value, targetScenario: resolvedTarget };

  log({
    tags: ["info", "model"],
    message: formatStatusMessage({
      reworkCount: reworkScenarios.length,
      model: selection.model,
      content,
      effort: selection.effort,
      level: effectiveLevel,
    }),
  });
  logStrongScope(log, selection);

  return selection;
};

const resolveCodexSelection = (
  { content, agent, log, defaults }: {
    content: string;
    agent: Agent;
    log: Logger;
    defaults: ModelSelection;
  },
): ModelSelection => {
  const result = computeModelSelection({ content, agent });
  if (!result.ok) {
    log({ tags: ["error", "model"], message: result.error });
    return defaults;
  }

  const reworkCount = (content.match(/NEEDS_REWORK/g) ?? []).length;
  log({
    tags: ["info", "model"],
    message: formatStatusMessage({
      reworkCount,
      model: result.value.model,
      content,
    }),
  });
  logStrongScope(log, result.value);

  return result.value;
};

export const resolveModelSelection = async (
  { agent, log, minLevel, progressFile = "./progress.md" }: {
    agent: Agent;
    log: Logger;
    minLevel?: EscalationLevel;
    progressFile?: string;
  },
): Promise<ModelSelection> => {
  const defaultMode = "fast" as const;
  const defaults: ModelSelection = {
    model: getModel({ agent, mode: defaultMode }),
    mode: defaultMode,
    targetScenario: undefined,
    effort: undefined,
    actionableScenarios: [],
  };

  const rawContent = await Deno.readTextFile(progressFile).catch(() => "");
  const content = rawContent.split("END_DEMO")[1];

  if (!content) {
    log({
      tags: ["error", "model"],
      message: "progress.md missing or lacks END_DEMO sigil",
    });
    return defaults;
  }

  return agent === "claude"
    ? await resolveClaudeSelection({ content, log, minLevel, defaults })
    : resolveCodexSelection({ content, agent, log, defaults });
};
