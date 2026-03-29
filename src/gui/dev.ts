/**
 * Client-side TypeScript compilation for GUI islands.
 *
 * Uses esbuild (already installed as a transitive dep of @fresh/core)
 * to bundle island .tsx files into browser-ready JS with proper browser
 * platform settings (no `node:process`, no Node.js builtins).
 *
 * @module
 */
import * as esbuild from "npm:esbuild@~0.25.5";
import * as path from "jsr:@std/path@^1";

const GUI_DIR = path.dirname(path.fromFileUrl(import.meta.url));
const ISLANDS_DIR = path.join(GUI_DIR, "islands");

/** Compiled island JS keyed by island name (e.g., "sse-provider"). */
export type CompiledIslands = ReadonlyMap<string, string>;

/** Compile all island entry points to browser JS. */
export const compileIslands = async (): Promise<CompiledIslands> => {
  const entryPoints: string[] = [];
  for await (const entry of Deno.readDir(ISLANDS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".tsx")) {
      entryPoints.push(path.join(ISLANDS_DIR, entry.name));
    }
  }

  const result = await esbuild.build({
    entryPoints,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outdir: "out",
    write: false,
    // Preact is externalized — loaded via import map in the HTML.
    external: ["preact", "preact/*"],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    jsx: "automatic",
    jsxImportSource: "preact",
  });

  const compiled = new Map<string, string>();
  for (const file of result.outputFiles) {
    const name = path.basename(file.path);
    compiled.set(name, file.text);
  }

  await esbuild.stop();
  return compiled;
};
