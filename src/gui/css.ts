/**
 * Load CSS files from the `css/` directory for serving via HTTP.
 * @module
 */
import * as path from "jsr:@std/path@^1";

const GUI_DIR = path.dirname(path.fromFileUrl(import.meta.url));
const CSS_DIR = path.join(GUI_DIR, "css");

/** Load all `.css` files from the css directory, keyed by filename. */
export const loadCssFiles = async (): Promise<Map<string, string>> => {
  const files = new Map<string, string>();
  for await (const entry of Deno.readDir(CSS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".css")) {
      const content = await Deno.readTextFile(path.join(CSS_DIR, entry.name));
      files.set(entry.name, content);
    }
  }
  return files;
};
