/**
 * Walks src/gui/{islands,client} and writes a manifest of relative paths
 * so that dev.ts can mirror remote files without a hardcoded list.
 *
 * Usage: deno run --allow-read --allow-write scripts/gen-gui-manifest.ts
 *
 * @module
 */
import * as path from "jsr:@std/path@^1";

const ROOT = path.dirname(path.dirname(path.fromFileUrl(import.meta.url)));
const GUI_DIR = path.join(ROOT, "src", "gui");
const MANIFEST_PATH = path.join(GUI_DIR, "manifest.json");
const SCAN_DIRS = ["islands", "client"];

const collectFiles = async (dir: string): Promise<string[]> => {
  const files: string[] = [];
  for await (const entry of Deno.readDir(path.join(GUI_DIR, dir))) {
    if (entry.isFile) files.push(`${dir}/${entry.name}`);
  }
  return files.sort();
};

const files = (await Promise.all(SCAN_DIRS.map(collectFiles))).flat();
await Deno.writeTextFile(MANIFEST_PATH, JSON.stringify(files, null, 2) + "\n");
