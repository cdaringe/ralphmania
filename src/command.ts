import type { Agent, CommandSpec } from "./types.ts";
import { BASE_PROMPT } from "./constants.ts";

export const buildPrompt = (
  { targetScenario, validationFailurePath, actionableScenarios }: {
    targetScenario: number | undefined;
    validationFailurePath: string | undefined;
    actionableScenarios: readonly number[];
  },
): string => {
  const actionableInfo = actionableScenarios.length > 0
    ? `\n\nActionable scenarios (not yet COMPLETE or VERIFIED): ${
      actionableScenarios.join(", ")
    }`
    : "";

  const base = targetScenario === undefined
    ? `${BASE_PROMPT}${actionableInfo}`
    : `${BASE_PROMPT}${actionableInfo}

ACTUALLY:
- You must work ONLY on scenario ${targetScenario}.
- Do not work on any other scenario in this iteration.`;

  return validationFailurePath === undefined ? base : `${base}

VALIDATION FAILED on previous iteration. Review the failure output at: ${validationFailurePath}
Fix the issues identified in the validation output before proceeding with other work.`;
};

export const buildCommandSpec = ({ agent, model, prompt }: {
  agent: Agent;
  model: string;
  prompt: string;
}): CommandSpec =>
  agent === "claude"
    ? {
      command: "claude",
      args: [
        "--dangerously-skip-permissions",
        "--output-format=stream-json",
        "--verbose",
        "--model",
        model,
        prompt,
      ],
    }
    : {
      command: "codex",
      args: [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--model",
        model,
        prompt,
      ],
    };
