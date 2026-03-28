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
  Status,
  VALID_STATUSES,
} from "./constants.ts";
export { parseProgressRows } from "./parsers/progress-rows.ts";
export type { ProgressRow } from "./parsers/progress-rows.ts";
import type { ProgressRow } from "./parsers/progress-rows.ts";
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
): Result<string | undefined, string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  const rework = parsed.value.find((r) => r.status === Status.NEEDS_REWORK);
  return ok(rework?.scenario);
};

/** Find ALL scenario IDs with NEEDS_REWORK status. */
export const findReworkScenarios = (
  content: string,
): Result<string[], string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  return ok(
    parsed.value
      .filter((r) => r.status === Status.NEEDS_REWORK)
      .map((r) => r.scenario),
  );
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
 * Derive the ordered actionable scenario list from parsed progress rows.
 * NEEDS_REWORK scenarios sort first so rework work is prioritised.
 * Pure derivation — no I/O.
 */
export const orderActionableScenarios = (
  rows: ProgressRow[],
  specIds: readonly string[],
): string[] => {
  const doneSet = new Set(
    rows
      .filter((r) =>
        r.status === Status.VERIFIED || r.status === Status.OBSOLETE
      )
      .map((r) => r.scenario),
  );
  const reworkIds = new Set(
    rows.filter((r) => r.status === Status.NEEDS_REWORK).map((r) => r.scenario),
  );
  const actionable = specIds.filter((id) => !doneSet.has(id));
  return [
    ...actionable.filter((s) => reworkIds.has(s)),
    ...actionable.filter((s) => !reworkIds.has(s)),
  ];
};

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

export const computeModelSelection = (
  { content, agent, escalationLevel, isVerifierMode }: {
    content: string;
    agent: Agent;
    escalationLevel?: EscalationLevel;
    isVerifierMode?: boolean;
  },
): Result<ModelSelection, string> => {
  const scenarioResult = detectScenarioFromProgress(content);
  const actionableResult = findActionableScenarios(content);

  if (scenarioResult.isErr()) return err(scenarioResult.error);
  if (actionableResult.isErr()) return err(actionableResult.error);

  if (agent === "claude" && escalationLevel !== undefined) {
    const config = escalationLevel >= 1
      ? CLAUDE_ESCALATED
      : isVerifierMode
      ? CLAUDE_VERIFIER
      : CLAUDE_CODER;
    return ok({
      ...config,
      targetScenario: scenarioResult.value,
      actionableScenarios: actionableResult.value,
    });
  }

  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  const reworkCount =
    parsed.value.filter((r) => r.status === Status.NEEDS_REWORK).length;
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
    actionableScenarios: actionableResult.value,
  });
};

/** Count rows with WORK_COMPLETE or VERIFIED status in progress.md content. */
export const parseImplementedCount = (
  content: string,
): Result<number, string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  return ok(
    parsed.value.filter((r) =>
      r.status === Status.WORK_COMPLETE || r.status === Status.VERIFIED
    ).length,
  );
};

/** Count total non-OBSOLETE scenario rows in progress.md content. */
export const parseTotalCount = (content: string): Result<number, string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  return ok(parsed.value.filter((r) => r.status !== Status.OBSOLETE).length);
};

/** Find scenario IDs that are not VERIFIED or OBSOLETE (i.e. actionable).
 * WORK_COMPLETE is actionable — it means "ready for verification", not "done". */
export const findActionableScenarios = (
  content: string,
): Result<string[], string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  const done: Set<string> = new Set([Status.VERIFIED, Status.OBSOLETE]);
  return ok(
    parsed.value
      .filter((r) => !done.has(r.status))
      .map((r) => r.scenario),
  );
};

/** Check whether every expected scenario is present and VERIFIED or OBSOLETE. */
export const isAllVerified = (
  content: string,
  expectedScenarioIds?: readonly string[],
): Result<boolean, string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  const rows = parsed.value;
  const doneStatuses: Set<string> = new Set([Status.VERIFIED, Status.OBSOLETE]);
  const allDone = rows.length > 0 &&
    rows.every((r) => doneStatuses.has(r.status));
  if (!allDone) return ok(false);
  if (expectedScenarioIds !== undefined) {
    const presentIds = new Set(rows.map((r) => r.scenario));
    for (const id of expectedScenarioIds) {
      if (!presentIds.has(id)) return ok(false);
    }
  }
  return ok(true);
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
): Result<{ scenario: string; status: string }[], string> => {
  const parsed = parseProgressRows(content);
  if (parsed.isErr()) return err(parsed.error);
  const validSet = new Set<string>(VALID_STATUSES);
  return ok(
    parsed.value
      .filter((r) => r.status !== "" && !validSet.has(r.status))
      .map((r) => ({ scenario: r.scenario, status: r.status })),
  );
};

const formatStatusMessage = (
  { reworkCount, model, implementedCount, totalCount, effort, level }: {
    reworkCount: number;
    model: string;
    implementedCount: number;
    totalCount: number;
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
    : `Status: ${implementedCount} of ${totalCount} implemented, finding next task...`;

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
  const reworkResult = findReworkScenarios(content);
  if (reworkResult.isErr()) {
    log({ tags: ["error", "model"], message: reworkResult.error });
    return defaults;
  }
  const reworkScenarios = reworkResult.value;
  const newState = updateEscalationState({
    current: currentState,
    reworkScenarios,
  });
  await writeEscalationState(newState, log, io);

  const scenarioResult = detectScenarioFromProgress(content);
  if (scenarioResult.isErr()) {
    log({ tags: ["error", "model"], message: scenarioResult.error });
    return defaults;
  }

  const target = scenarioResult.value;
  const rawStateLevel = target !== undefined ? newState[target] : undefined;
  const stateLevel: EscalationLevel = rawStateLevel ?? 0;

  const implementedResult = parseImplementedCount(content);
  const totalResult = parseTotalCount(content);
  if (implementedResult.isErr() || totalResult.isErr()) {
    log({
      tags: ["error", "model"],
      message: implementedResult.isErr()
        ? implementedResult.error
        : (totalResult as { error: string }).error,
    });
    return defaults;
  }

  const isVerifierMode = reworkScenarios.length === 0 &&
    implementedResult.value === totalResult.value;
  const effectiveLevel: EscalationLevel = reworkScenarios.length > 0
    ? clampLevel(Math.max(1, stateLevel, minLevel ?? 0))
    : clampLevel(Math.max(stateLevel, minLevel ?? 0));

  const result = computeModelSelection({
    content,
    agent: "claude",
    escalationLevel: effectiveLevel,
    isVerifierMode,
  });

  if (result.isErr()) {
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
      implementedCount: implementedResult.value,
      totalCount: totalResult.value,
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
  if (result.isErr()) {
    log({ tags: ["error", "model"], message: result.error });
    return defaults;
  }

  const parsed = parseProgressRows(content);
  const reworkCount = parsed.isOk()
    ? parsed.value.filter((r) => r.status === Status.NEEDS_REWORK).length
    : 0;
  const implementedResult = parseImplementedCount(content);
  const totalResult = parseTotalCount(content);
  log({
    tags: ["info", "model"],
    message: formatStatusMessage({
      reworkCount,
      model: result.value.model,
      implementedCount: implementedResult.isOk() ? implementedResult.value : 0,
      totalCount: totalResult.isOk() ? totalResult.value : 0,
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
