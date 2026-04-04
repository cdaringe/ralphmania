import type { AgentSessionConfig, ModelSelection } from "./types.ts";
import { AUTONOMOUS_PROMPT, buildTargetedPrompt } from "./constants.ts";

export const buildPrompt = (
  {
    targetScenario,
    validationFailurePath,
    actionableScenarios,
    specFile,
    progressFile,
  }: {
    targetScenario: string | undefined;
    validationFailurePath: string | undefined;
    actionableScenarios: readonly string[];
    specFile?: string;
    progressFile?: string;
  },
): string => {
  const raw = targetScenario === undefined
    ? AUTONOMOUS_PROMPT
    : buildTargetedPrompt(targetScenario);
  const prompt = raw
    .replaceAll("{SPEC_FILE}", specFile ?? "specification.md")
    .replaceAll("{PROGRESS_FILE}", progressFile ?? "progress.md");

  const actionableInfo = targetScenario === undefined &&
      actionableScenarios.length > 0
    ? `\n\nActionable scenarios (not yet VERIFIED or OBSOLETE): ${
      actionableScenarios.join(", ")
    }`
    : "";

  const base = `${prompt}${actionableInfo}`;

  return validationFailurePath === undefined ? base : `${base}

VALIDATION FAILED on previous iteration. Review the failure output at: ${validationFailurePath}
Fix the issues identified in the validation output before proceeding with other work.`;
};

/** Build a pi-mono session config from a model selection and working directory. */
export const buildSessionConfig = (
  { selection, workingDir }: {
    selection: ModelSelection;
    workingDir: string;
  },
): AgentSessionConfig => ({
  provider: selection.provider,
  model: selection.model,
  workingDir,
  thinkingLevel: selection.thinkingLevel,
});
