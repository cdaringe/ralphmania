import type {
  EscalationLevel,
  Logger,
  ModelLadder,
  ModelSelection,
  Result,
  ToolMode,
} from "./types.ts";
import type { ModelIODeps } from "./ports/types.ts";
import { defaultModelIODeps } from "./ports/impl.ts";
import { err, ok } from "./types.ts";
import { DEFAULT_MODEL_LADDER, formatModelSpec, Status } from "./constants.ts";
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

/** Build a ModelSelection from a ladder role. */
export const selectFromLadder = (
  { ladder, mode }: { ladder: ModelLadder; mode: ToolMode },
): ModelSelection => {
  const config = ladder[mode];
  return {
    provider: config.provider,
    model: config.model,
    mode,
    targetScenario: undefined,
    thinkingLevel: config.thinkingLevel,
    actionableScenarios: [],
  };
};

export const computeModelSelection = (
  { content, ladder, escalationLevel, isVerifierMode }: {
    content: string;
    ladder: ModelLadder;
    escalationLevel?: EscalationLevel;
    isVerifierMode?: boolean;
  },
): Result<ModelSelection, string> => {
  const scenarioResult = detectScenarioFromProgress(content);
  const actionableResult = findActionableScenarios(content);

  if (scenarioResult.isErr()) return err(scenarioResult.error);
  if (actionableResult.isErr()) return err(actionableResult.error);

  const mode: ToolMode = escalationLevel !== undefined
    ? (escalationLevel >= 1
      ? "escalated"
      : isVerifierMode
      ? "verifier"
      : "coder")
    : (() => {
      const parsed = parseProgressRows(content);
      if (parsed.isErr()) return "coder" as const;
      const reworkCount =
        parsed.value.filter((r) => r.status === Status.NEEDS_REWORK).length;
      return reworkCount > 0 ? "escalated" as const : "coder" as const;
    })();

  const config = ladder[mode];
  return ok({
    provider: config.provider,
    model: config.model,
    mode,
    thinkingLevel: config.thinkingLevel,
    targetScenario: scenarioResult.value,
    actionableScenarios: actionableResult.value,
  });
};

const formatStatusMessage = (
  { reworkCount, model, implementedCount, totalCount, thinkingLevel, level }: {
    reworkCount: number;
    model: string;
    implementedCount: number;
    totalCount: number;
    thinkingLevel?: string;
    level?: EscalationLevel;
  },
): string =>
  reworkCount > 0
    ? `${reworkCount} NEEDS_REWORK entries → ${
      thinkingLevel !== undefined
        ? `${model} (thinking: ${thinkingLevel}, level: ${level})`
        : `using ${model}`
    }`
    : `Status: ${implementedCount} of ${totalCount} implemented, finding next task...`;

const logStrongScope = (
  log: Logger,
  selection: ModelSelection,
): void => {
  selection.mode === "escalated" && selection.targetScenario !== undefined &&
    log({
      tags: ["info", "scenario"],
      message:
        `escalated-model pass scoped to scenario ${selection.targetScenario}`,
    });
};

const clampLevel = (n: number): EscalationLevel => n >= 1 ? 1 : 0;

const resolveSelection = async (
  { content, log, minLevel, defaults, io, ladder }: {
    content: string;
    log: Logger;
    minLevel?: EscalationLevel;
    defaults: ModelSelection;
    io: ModelIODeps;
    ladder: ModelLadder;
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
    ladder,
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
      model: formatModelSpec(ladder[selection.mode]),
      implementedCount: implementedResult.value,
      totalCount: totalResult.value,
      thinkingLevel: selection.thinkingLevel,
      level: effectiveLevel,
    }),
  });
  logStrongScope(log, selection);

  return selection;
};

export const resolveModelSelection = async (
  {
    ladder = DEFAULT_MODEL_LADDER,
    log,
    minLevel,
    progressFile = "./progress.md",
    io = defaultModelIODeps,
  }: {
    ladder?: ModelLadder;
    log: Logger;
    minLevel?: EscalationLevel;
    progressFile?: string;
    io?: ModelIODeps;
  },
): Promise<ModelSelection> => {
  const defaults = selectFromLadder({ ladder, mode: "coder" });

  const rawContent = await io.readTextFile(progressFile).catch(() => "");
  const content = rawContent.split("END_DEMO")[1];

  if (!content) {
    log({
      tags: ["error", "model"],
      message: "progress.md missing or lacks END_DEMO sigil",
    });
    return defaults;
  }

  return resolveSelection({ content, log, minLevel, defaults, io, ladder });
};
