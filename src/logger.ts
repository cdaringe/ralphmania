import type { Logger } from "./types.ts";
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

/** Injectable output deps for the logger. */
export type LoggerOutput = {
  writeSync: (data: Uint8Array) => number;
  writeErrSync: (data: Uint8Array) => number;
};

/* c8 ignore start — thin Deno I/O wiring */
const defaultOutput: LoggerOutput = {
  writeSync: (d) => Deno.stdout.writeSync(d),
  writeErrSync: (d) => Deno.stderr.writeSync(d),
};
/* c8 ignore stop */

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
  output: LoggerOutput = defaultOutput,
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
