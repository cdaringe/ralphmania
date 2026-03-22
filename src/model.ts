import type {
  Agent,
  EffortLevel,
  EscalationLevel,
  EscalationState,
  Logger,
  ModelSelection,
  Result,
} from "./types.ts";
import { ok } from "./types.ts";
import {
  CLAUDE_CODER,
  CLAUDE_ESCALATED,
  CLAUDE_VERIFIER,
  ESCALATION_FILE,
  REWORK_THRESHOLD,
  Status,
  VALID_STATUSES,
} from "./constants.ts";
export { parseProgressRows } from "./parsers/progress-rows.ts";
export type { ProgressRow } from "./parsers/progress-rows.ts";
import { parseProgressRows } from "./parsers/progress-rows.ts";

/** Injectable I/O deps for model resolution functions. */
export type ModelIODeps = {
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
};

/* c8 ignore start — thin Deno I/O wiring */
const defaultModelIO: ModelIODeps = {
  readTextFile: (p) => Deno.readTextFile(p),
  writeTextFile: (p, c) => Deno.writeTextFile(p, c),
  mkdir: (p, o) => Deno.mkdir(p, o),
};
/* c8 ignore stop */

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
  const rework = parseProgressRows(content).find((r) =>
    r.status === Status.NEEDS_REWORK
  );
  return ok(rework?.scenario);
};

/** Find ALL scenario numbers with NEEDS_REWORK status. */
export const findReworkScenarios = (content: string): number[] =>
  parseProgressRows(content)
    .filter((r) => r.status === Status.NEEDS_REWORK)
    .map((r) => r.scenario);

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

  if (!scenarioResult.ok) return scenarioResult;

  if (agent === "claude" && escalationLevel !== undefined) {
    const config = escalationLevel >= 1
      ? CLAUDE_ESCALATED
      : isVerifierMode
      ? CLAUDE_VERIFIER
      : CLAUDE_CODER;
    return ok({
      ...config,
      targetScenario: scenarioResult.value,
      actionableScenarios,
    });
  }

  const reworkCount =
    parseProgressRows(content).filter((r) => r.status === Status.NEEDS_REWORK)
      .length;
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
};

/** Count rows with WORK_COMPLETE or VERIFIED status in progress.md content. */
export const parseImplementedCount = (content: string): number =>
  parseProgressRows(content).filter((r) =>
    r.status === Status.WORK_COMPLETE || r.status === Status.VERIFIED
  ).length;

/** Count total non-OBSOLETE scenario rows in progress.md content. */
export const parseTotalCount = (content: string): number =>
  parseProgressRows(content).filter((r) => r.status !== Status.OBSOLETE).length;

/** Find scenario numbers that are not VERIFIED or OBSOLETE (i.e. actionable).
 * WORK_COMPLETE is actionable — it means "ready for verification", not "done". */
export const findActionableScenarios = (content: string): number[] => {
  const done: Set<string> = new Set([Status.VERIFIED, Status.OBSOLETE]);
  return parseProgressRows(content)
    .filter((r) => !done.has(r.status))
    .map((r) => r.scenario);
};

/** Check whether every expected scenario is present and VERIFIED or OBSOLETE. */
export const isAllVerified = (
  content: string,
  expectedCount?: number,
): boolean => {
  const rows = parseProgressRows(content);
  const doneStatuses: Set<string> = new Set([Status.VERIFIED, Status.OBSOLETE]);
  const allDone = rows.length > 0 &&
    rows.every((r) => doneStatuses.has(r.status));
  if (!allDone) return false;
  if (expectedCount !== undefined) {
    const presentIds = new Set(rows.map((r) => r.scenario));
    for (let i = 1; i <= expectedCount; i++) {
      if (!presentIds.has(i)) return false;
    }
  }
  return true;
};

/** Read persisted escalation state, defaulting to `{}` if missing. */
export const readEscalationState = async (
  log: Logger,
  io: ModelIODeps = defaultModelIO,
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

/** Persist escalation state to `.ralph/escalation.json`. */
export const writeEscalationState = async (
  state: EscalationState,
  log: Logger,
  io: ModelIODeps = defaultModelIO,
): Promise<void> => {
  try {
    await io.mkdir(".ralph", { recursive: true });
    await io.writeTextFile(ESCALATION_FILE, JSON.stringify(state));
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
  return parseProgressRows(content)
    .filter((r) => r.status !== "" && !validSet.has(r.status))
    .map((r) => ({ scenario: r.scenario, status: r.status }));
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
  { content, log, minLevel, defaults, io }: {
    content: string;
    log: Logger;
    minLevel?: EscalationLevel;
    defaults: ModelSelection;
    io: ModelIODeps;
  },
): Promise<ModelSelection> => {
  const currentState = await readEscalationState(log, io);
  const reworkScenarios = findReworkScenarios(content);
  const newState = updateEscalationState({
    current: currentState,
    reworkScenarios,
  });
  await writeEscalationState(newState, log, io);

  const scenarioResult = detectScenarioFromProgress(content);
  if (!scenarioResult.ok) {
    log({ tags: ["error", "model"], message: scenarioResult.error });
    return defaults;
  }

  const target = scenarioResult.value;
  const rawStateLevel = target !== undefined
    ? newState[String(target)]
    : undefined;
  const stateLevel: EscalationLevel = rawStateLevel ?? 0;

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

  const reworkCount =
    parseProgressRows(content).filter((r) => r.status === Status.NEEDS_REWORK)
      .length;
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
  { agent, log, minLevel, progressFile = "./progress.md", io = defaultModelIO }:
    {
      agent: Agent;
      log: Logger;
      minLevel?: EscalationLevel;
      progressFile?: string;
      io?: ModelIODeps;
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

  const rawContent = await io.readTextFile(progressFile).catch(() => "");
  const content = rawContent.split("END_DEMO")[1];

  if (!content) {
    log({
      tags: ["error", "model"],
      message: "progress.md missing or lacks END_DEMO sigil",
    });
    return defaults;
  }

  return agent === "claude"
    ? await resolveClaudeSelection({ content, log, minLevel, defaults, io })
    : resolveCodexSelection({ content, agent, log, defaults });
};
