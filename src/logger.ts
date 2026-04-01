import type { Logger } from "./types.ts";
import type { LoggerOutput } from "./ports/types.ts";
import { defaultLoggerOutput } from "./ports/impl.ts";
import {
  blue,
  bold,
  cyan,
  dim,
  green,
  magenta,
  red,
  yellow,
} from "./colors.ts";

const tagColor: Record<string, (s: string) => string> = {
  error: red,
  info: cyan,
  debug: dim,
  phase: magenta,
  model: yellow,
  iteration: green,
  validate: yellow,
  scenario: yellow,
  plugin: blue,
  hook: dim,
};

const colorizeTag = (tag: string): string => (tagColor[tag] ?? dim)(tag);

export const createLogger = (
  output: LoggerOutput = defaultLoggerOutput,
): Logger => {
  const encoder = new TextEncoder();
  return ({ tags, message }) => {
    const level = tags[0];
    const coloredTags = tags.map(colorizeTag).join(dim(":"));
    const coloredMessage = level === "error" ? bold(red(message)) : message;
    const encoded = encoder.encode(
      `${dim("[")}${magenta("ralph")}${dim(":")}${coloredTags}${
        dim("]")
      } ${coloredMessage}\n`,
    );
    level === "error"
      ? output.writeErrSync(encoded)
      : output.writeSync(encoded);
  };
};
