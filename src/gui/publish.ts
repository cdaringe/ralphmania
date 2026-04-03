/**
 * Build a publish-ready GUI bundle: precompiled islands + self-contained HTML.
 *
 * Artifacts are written into `.ralph/receipts/gui/` so publish output includes
 * a portable GUI snapshot that does not depend on runtime island compilation or
 * a running server. Preact is bundled inline — no CDN or importmap needed.
 */
import * as esbuild from "npm:esbuild@~0.25.5";
import type { OnResolveResult, Plugin, PluginBuild } from "npm:esbuild@~0.25.5";
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
    title: "ralphmania \u00b7 live",
    entry: "boot.tsx",
    loading: "Loading GUI...",
  },
  {
    output: "worker.html",
    title: "ralphmania \u00b7 worker",
    entry: "worker-boot.tsx",
    loading: "Loading worker...",
  },
  {
    output: "scenario.html",
    title: "ralphmania \u00b7 scenario",
    entry: "scenario-boot.tsx",
    loading: "Loading scenario...",
  },
] as const;

type PageBundle = {
  readonly output: string;
  readonly html: string;
};

/**
 * Resolve bare "preact" and JSR-rewritten "npm:preact@^10" specifiers to
 * their actual file paths in the Deno npm cache so esbuild bundles them
 * inline rather than externalizing to a CDN importmap.
 */
const denoNpmBundlePlugin: Plugin = {
  name: "deno-npm-bundle",
  setup(build: PluginBuild): void {
    build.onResolve(
      { filter: /^(?:npm:)?preact/ },
      (args): OnResolveResult | undefined => {
        try {
          const resolved = import.meta.resolve(args.path);
          if (resolved.startsWith("file:")) {
            return { path: new URL(resolved).pathname };
          }
        } catch { /* unresolvable — fall through to default */ }
        return undefined;
      },
    );
  },
};

/**
 * Compile all page entry points to browser ESM in a single esbuild pass.
 * Returns a map of `basename.js → content`.
 */
const compileEntries = async (
  entries: readonly string[],
): Promise<Result<ReadonlyMap<string, string>, string>> => {
  const entryPoints = entries.map((e) => path.join(ISLANDS_DIR, e));
  try {
    const result = await esbuild.build({
      entryPoints,
      bundle: true,
      splitting: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
      outdir: "out",
      write: false,
      minify: true,
      plugins: [denoNpmBundlePlugin],
      // Preact is bundled inline — no CDN or importmap needed at runtime.
      define: { "process.env.NODE_ENV": '"production"' },
      jsx: "automatic",
      jsxImportSource: "preact",
    });
    const compiled = new Map<string, string>();
    for (const file of result.outputFiles) {
      compiled.set(path.basename(file.path), file.text);
    }
    return ok(compiled);
  } catch (error) {
    return err(`esbuild compilation failed: ${String(error)}`);
  } finally {
    await esbuild.stop();
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

  const entries = PAGE_CONFIG.map((p) => p.entry);
  const compiledResult = await compileEntries(entries);
  if (compiledResult.isErr()) return err(compiledResult.error);
  const compiled = compiledResult.value;

  try {
    const bundles: PageBundle[] = [];
    for (const page of PAGE_CONFIG) {
      const jsName = page.entry.replace(/\.tsx$/, ".js");
      const js = compiled.get(jsName) ?? "";
      bundles.push({
        output: page.output,
        html: renderContainedHtml({
          title: page.title,
          loading: page.loading,
          css,
          js,
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
    return err(`Failed to publish GUI bundle: ${String(error)}`);
  }
};
