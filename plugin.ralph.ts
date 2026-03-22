import type { Plugin } from "./src/plugin.ts";

export const plugin: Plugin = {
  onPromptBuilt({ prompt }): string {
    return `${prompt}\n\nArchitecture is defined at @ARCHITECTURE.md.`;
  },
};
