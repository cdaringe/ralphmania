import type { Agent, CommandSpec, ToolMode } from "./types.ts";
import { BASE_PROMPT } from "./constants.ts";

export const buildPrompt = (
  { targetScenario, mode, validationFailurePath }: {
    targetScenario: number | undefined;
    mode: ToolMode;
    validationFailurePath: string | undefined;
  },
): string => {
  const base = mode === "general" || targetScenario === undefined
    ? BASE_PROMPT
    : `${BASE_PROMPT}

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
        "--model",
        model,
        //  "-p",
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
