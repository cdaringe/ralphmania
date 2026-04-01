import type {
  LoggerOutput,
  ModelIODeps,
  ProgressFileDeps,
  ValidationHookDeps,
} from "./types.ts";

/* c8 ignore start — thin Deno I/O wiring */
export const defaultLoggerOutput: LoggerOutput = {
  writeSync: (d) => Deno.stdout.writeSync(d),
  writeErrSync: (d) => Deno.stderr.writeSync(d),
};

export const defaultModelIODeps: ModelIODeps = {
  readTextFile: (p) => Deno.readTextFile(p),
  writeTextFile: (p, c) => Deno.writeTextFile(p, c),
  mkdir: (p, o) => Deno.mkdir(p, o),
};

export const defaultProgressFileDeps: ProgressFileDeps = {
  readTextFile: (path) => Deno.readTextFile(path),
  writeTextFile: (path, content) => Deno.writeTextFile(path, content),
  stat: (path) => Deno.stat(path),
};

export const defaultValidationHookDeps: ValidationHookDeps = {
  exists: (p) => Deno.stat(p).then(() => true, () => false),
  writeTextFile: (p, c) => Deno.writeTextFile(p, c),
  chmod: (p, m) => Deno.chmod(p, m),
};
/* c8 ignore stop */
