import type {
  Agent,
  EffortLevel,
  EscalationLevel,
  Logger,
  ModelSelection,
  Result,
} from "./types.ts";
import type { ModelIODeps } from "./ports/types.ts";
import { defaultModelIODeps } from "./ports/impl.ts";
import { err, ok } from "./types.ts";
import {
  CLAUDE_CODER,
  CLAUDE_ESCALATED,
  CLAUDE_VERIFIER,
  REWORK_THRESHOLD,
  Status,
} from "./constants.ts";
import {
  readEscalationState,
  updateEscalationState,
  writeEscalationState,
} from "./orchestrator/escalation.ts";
import {
  detectScenarioFromProgress,
  findActionableScenarios,
  findReworkScenarios,
  parseImplementedCount,
  parseProgressRows,
  parseTotalCount,
} from "./orchestrator/progress-queries.ts";

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

const clampLevel = (n: number): EscalationLevel => n >= 1 ? 1 : 0;

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
  {
    agent,
    log,
    minLevel,
    progressFile = "./progress.md",
    io = defaultModelIODeps,
  }: {
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
