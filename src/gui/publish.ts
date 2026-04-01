/**
 * Build a publish-ready GUI bundle: precompiled islands + self-contained HTML.
 *
 * Artifacts are written into `.ralph/receipts/gui/` so publish output includes
 * a portable GUI snapshot that does not depend on runtime island compilation or
 * external CDN assets.
 */
import * as path from "jsr:@std/path@^1";
import type { Logger, Result } from "../types.ts";
import { createLogger } from "../logger.ts";
import { err, ok } from "../types.ts";
import { loadCssFiles } from "./css.ts";

const GUI_DIR = path.dirname(path.fromFileUrl(import.meta.url));
const ISLANDS_DIR = path.join(GUI_DIR, "islands");

const PAGE_CONFIG = [
  {
    output: "index.html",
    title: "ralphmania · live",
    entry: "boot.tsx",
    loading: "Loading GUI...",
  },
  {
    output: "worker.html",
    title: "ralphmania · worker",
    entry: "worker-boot.tsx",
    loading: "Loading worker...",
  },
  {
    output: "scenario.html",
    title: "ralphmania · scenario",
    entry: "scenario-boot.tsx",
    loading: "Loading scenario...",
  },
] as const;

type PageBundle = {
  readonly output: string;
  readonly html: string;
};

const compileJsEntry = async (
  entryFile: string,
): Promise<Result<string, string>> => {
  const entryPoint = path.join(ISLANDS_DIR, entryFile);
  const cmd = new Deno.Command("deno", {
    args: [
      "bundle",
      "--platform",
      "browser",
      "--format",
      "esm",
      "--minify",
      entryPoint,
    ],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  try {
    const { code, stdout, stderr } = await cmd.output();
    if (code !== 0) {
      return err(
        `Failed to compile ${entryFile}: ${
          new TextDecoder().decode(stderr).trim()
        }`,
      );
    }
    return ok(new TextDecoder().decode(stdout));
  } catch (error) {
    return err(`Failed to compile ${entryFile}: ${String(error)}`);
  }
};

const renderContainedHtml = (
  { title, loading, css, js }: {
    title: string;
    loading: string;
    css: string;
    js: string;
  },
): string =>
  `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="app-root">${loading}</div>
    <script type="module">${js}</script>
  </body>
</html>
`;

export const publishContainedGui = async (
  { outDir, log: inputLog }: { outDir: string; log?: Logger },
): Promise<Result<readonly string[], string>> => {
  const log = inputLog ?? createLogger();
  const localCss = await loadCssFiles();
  const css = Array.from(localCss.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, content]) => content)
    .join("\n\n");

  try {
    const bundles: PageBundle[] = [];

    for (const page of PAGE_CONFIG) {
      const jsResult = await compileJsEntry(page.entry);
      if (jsResult.isErr()) return err(jsResult.error);
      bundles.push({
        output: page.output,
        html: renderContainedHtml({
          title: page.title,
          loading: page.loading,
          css,
          js: jsResult.value,
        }),
      });
    }

    await Deno.mkdir(outDir, { recursive: true });
    const written: string[] = [];
    for (const { output, html } of bundles) {
      const target = path.join(outDir, output);
      await Deno.writeTextFile(target, html);
      written.push(target);
    }

    const manifestPath = path.join(outDir, "manifest.json");
    await Deno.writeTextFile(
      manifestPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          assets: bundles.map((b) => b.output),
          fullyContained: true,
        },
        null,
        2,
      ) + "\n",
    );
    written.push(manifestPath);

    log({
      tags: ["info", "gui", "publish"],
      message: `Published self-contained GUI bundle to ${outDir}`,
    });

    return ok(written);
  } catch (error) {
    return err(`Failed to publish GUI bundle: ${error}`);
  }
};
