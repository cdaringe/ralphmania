/**
 * Load CSS files from the `css/` directory for serving via HTTP.
 * When running from a remote URL (e.g. JSR), fetches files listed
 * in the manifest instead of reading from disk.
 * @module
 */
import * as path from "jsr:@std/path@^1";
import manifest from "./manifest.json" with { type: "json" };

const IS_REMOTE = !import.meta.url.startsWith("file:");
const GUI_DIR = IS_REMOTE
  ? new URL(".", import.meta.url).href
  : path.dirname(path.fromFileUrl(import.meta.url));

/** Load all `.css` files from the css directory, keyed by filename. */
export const loadCssFiles = async (): Promise<Map<string, string>> => {
  const files = new Map<string, string>();
  if (IS_REMOTE) {
    const cssEntries = (manifest as string[]).filter((f) =>
      f.startsWith("css/") && f.endsWith(".css")
    );
    await Promise.all(cssEntries.map(async (rel) => {
      const url = new URL(rel, GUI_DIR);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
      files.set(path.basename(rel), await resp.text());
    }));
  } else {
    const cssDir = path.join(GUI_DIR, "css");
    for await (const entry of Deno.readDir(cssDir)) {
      if (entry.isFile && entry.name.endsWith(".css")) {
        const content = await Deno.readTextFile(path.join(cssDir, entry.name));
        files.set(entry.name, content);
      }
    }
  }
  return files;
};
