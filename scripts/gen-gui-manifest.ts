/**
 * Walks all subdirectories of src/gui/ and writes a manifest of relative
 * paths so that dev.ts and css.ts can mirror remote files without a
 * hardcoded list.
 *
 * Usage: deno run --allow-read --allow-write scripts/gen-gui-manifest.ts
 *
 * @module
 */
import * as path from "jsr:@std/path@^1";

const ROOT = path.dirname(path.dirname(path.fromFileUrl(import.meta.url)));
const GUI_DIR = path.join(ROOT, "src", "gui");
const MANIFEST_PATH = path.join(GUI_DIR, "manifest.json");

/** Auto-discover all subdirectories under src/gui/. */
const discoverDirs = async (): Promise<string[]> => {
  const dirs: string[] = [];
  for await (const entry of Deno.readDir(GUI_DIR)) {
    if (entry.isDirectory) dirs.push(entry.name);
  }
  return dirs.sort();
};

const collectFiles = async (dir: string): Promise<string[]> => {
  const files: string[] = [];
  for await (const entry of Deno.readDir(path.join(GUI_DIR, dir))) {
    if (entry.isFile) files.push(`${dir}/${entry.name}`);
  }
  return files.sort();
};

const dirs = await discoverDirs();
const files = (await Promise.all(dirs.map(collectFiles))).flat();
await Deno.writeTextFile(MANIFEST_PATH, JSON.stringify(files, null, 2) + "\n");
