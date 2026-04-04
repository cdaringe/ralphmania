/**
 * Static site builder for the ralphmania docs site.
 * Renders Preact components to HTML files and copies the CSS.
 *
 * Exports `buildSite` for use in tests.
 * When run as main, builds into `site/dist/`.
 *
 * @module
 */
import { renderToString } from "preact-render-to-string";
import * as path from "jsr:@std/path@^1";
import type * as preact from "preact";
import { ArchitecturePage } from "./src/pages/architecture.tsx";
import { IndexPage } from "./src/pages/index.tsx";
import { QuickstartPage } from "./src/pages/quickstart.tsx";
import { ReferencePage } from "./src/pages/reference.tsx";

export type BuildOpts = {
  readonly outDir: string;
  readonly srcDir: string;
};

type PageEntry = {
  readonly filename: string;
  readonly vnode: preact.VNode;
};

/** Render a VNode to a full HTML document string. */
const renderPage = (vnode: preact.VNode): string =>
  `<!DOCTYPE html>\n${renderToString(vnode)}`;

/** Build the docs site into `outDir`, reading assets from `srcDir`. */
export async function buildSite(opts: BuildOpts): Promise<void> {
  const { outDir, srcDir } = opts;

  await Deno.mkdir(outDir, { recursive: true });

  const pages: readonly PageEntry[] = [
    { filename: "index.html", vnode: IndexPage() },
    { filename: "quickstart.html", vnode: QuickstartPage() },
    { filename: "reference.html", vnode: ReferencePage() },
    { filename: "architecture.html", vnode: ArchitecturePage() },
  ];

  await Promise.all(
    pages.map(async (entry: PageEntry): Promise<void> => {
      const html = renderPage(entry.vnode);
      await Deno.writeTextFile(path.join(outDir, entry.filename), html);
    }),
  );

  const cssSource = path.join(srcDir, "styles.css");
  const cssDest = path.join(outDir, "styles.css");
  await Deno.copyFile(cssSource, cssDest);

  const assetsSource = path.join(srcDir, "assets");
  const assetsDest = path.join(outDir, "assets");
  try {
    await Deno.mkdir(assetsDest, { recursive: true });
    for await (const entry of Deno.readDir(assetsSource)) {
      if (entry.isFile) {
        await Deno.copyFile(
          path.join(assetsSource, entry.name),
          path.join(assetsDest, entry.name),
        );
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

if (import.meta.main) {
  const siteDir = path.dirname(path.fromFileUrl(import.meta.url));
  await buildSite({
    outDir: path.join(siteDir, "dist"),
    srcDir: path.join(siteDir, "src"),
  });
  console.log("Site built → site/dist/");
}
