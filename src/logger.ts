import type { Logger } from "./types.ts";

export const createLogger = (): Logger => {
  const encoder = new TextEncoder();
  return ({ tags, message }) => {
    const encoded = encoder.encode(`[${tags.join(":")}] ${message}\n`);
    tags[0] === "error"
      ? Deno.stderr.writeSync(encoded)
      : Deno.stdout.writeSync(encoded);
  };
};
