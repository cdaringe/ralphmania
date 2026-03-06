import type { Agent, Logger, ModelSelection, Result } from "./types.ts";
import { err, ok } from "./types.ts";
import { REWORK_THRESHOLD } from "./constants.ts";

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

export const computeModelSelection = (
  content: string,
  agent: Agent,
): Result<ModelSelection, string> => {
  const reworkCount = (content.match(/NEEDS_REWORK/g) ?? []).length;
  const scenarioResult = detectScenarioFromProgress(content);

  if (!scenarioResult.ok) return scenarioResult;

  const mode = reworkCount > REWORK_THRESHOLD
    ? "strong" as const
    : reworkCount > 0
    ? "general" as const
    : "fast" as const;
  const model = getModel({ agent, mode });

  return ok({
    model,
    mode,
    targetScenario: scenarioResult.value,
  });
};

export const resolveModelSelection = async (
  agent: Agent,
  log: Logger,
): Promise<ModelSelection> => {
  const defaultMode = "fast" as const;
  const defaults: ModelSelection = {
    model: getModel({ agent, mode: defaultMode }),
    mode: defaultMode,
    targetScenario: undefined,
  };

  const rawContent = await Deno.readTextFile("./progress.md").catch(() => "");
  const content = rawContent.split("END_DEMO")[1];
  const result = content
    ? computeModelSelection(content, agent)
    : err("progress.md missing or lacks END_DEMO sigil");

  if (!result.ok) {
    log({ tags: ["error", "model"], message: result.error });
    return defaults;
  }

  const { model, mode, targetScenario } = result.value;
  const reworkCount = (content?.match(/NEEDS_REWORK/g) ?? []).length;
  log({
    tags: ["info", "model"],
    message: `${reworkCount} NEEDS_REWORK entries → using ${model}`,
  });

  if (mode === "strong" && targetScenario !== undefined) {
    log({
      tags: ["info", "scenario"],
      message: `strong-model pass scoped to scenario ${targetScenario}`,
    });
  }

  return result.value;
};
