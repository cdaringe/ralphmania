import type { Plugin } from "./src/plugin.ts";
import type {
  KnownProvider,
  ModelSelection,
  RectifyAction,
} from "./src/types.ts";

/** Agent model specs — adjust per-role as needed. */
const agents = {
  coder: "openai/gpt-5.4",
  escalated: "openai/gpt-5.4",
  /** Cheap model for the verification / work-discriminator pass. */
  discriminator: "openai/gpt-5.4-nano",
  /** Post-merge-failure rectification agent. */
  rectifier: "openai/gpt-5.4-mini",
} as const;

const parseSpec = (spec: string) => {
  const idx = spec.indexOf("/");
  return {
    provider: spec.slice(0, idx) as KnownProvider,
    model: spec.slice(idx + 1),
  };
};

let rectifying = false;

export const plugin: Plugin = {
  onConfigResolved(): {
    coder: string;
    escalated: string;
    verifier: string;
  } {
    return {
      coder: agents.coder,
      escalated: agents.escalated,
      verifier: agents.discriminator,
    };
  },

  onRectify(): RectifyAction {
    rectifying = true;
    return { action: "agent" };
  },

  onModelSelected({ selection }): ModelSelection {
    if (rectifying && selection.mode === "escalated") {
      const { provider, model } = parseSpec(agents.rectifier);
      return { ...selection, provider, model };
    }
    return selection;
  },

  onIterationEnd(): void {
    rectifying = false;
  },

  onPromptBuilt({ prompt }): string {
    return `${prompt}\n\nArchitecture is defined at @ARCHITECTURE.md.`;
  },
};
