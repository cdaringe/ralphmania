import { assertEquals } from "jsr:@std/assert@^1";
import * as path from "jsr:@std/path@^1";
import manifest from "../src/gui/manifest.json" with { type: "json" };

const GUI_DIR = path.join(
  path.dirname(path.fromFileUrl(import.meta.url)),
  "..",
  "src",
  "gui",
);

/** Collect all files in subdirectories of src/gui/, matching gen-gui-manifest.ts logic. */
const collectActualFiles = async (): Promise<string[]> => {
  const dirs: string[] = [];
  for await (const entry of Deno.readDir(GUI_DIR)) {
    if (entry.isDirectory) dirs.push(entry.name);
  }
  dirs.sort();

  const files: string[] = [];
  for (const dir of dirs) {
    for await (const entry of Deno.readDir(path.join(GUI_DIR, dir))) {
      if (entry.isFile) files.push(`${dir}/${entry.name}`);
    }
  }
  return files.sort();
};

Deno.test("manifest.json is up to date with gui subdirectories", async () => {
  const actual = await collectActualFiles();
  assertEquals(
    (manifest as string[]).toSorted(),
    actual,
    "manifest.json is stale — run `deno task gen-gui-manifest`",
  );
});
