// coverage:ignore — JSX UI component; tested via e2e
/**
 * Shared HTML shell for all GUI pages. Each page provides its title
 * suffix, CSS files, import map entries, and boot script.
 * @module
 */
import { PREACT_IMPORTS } from "./import-map.ts";

type PageShellProps = {
  /** Title suffix after "ralphmania · " */
  readonly title: string;
  /** CSS file names to load (e.g. ["base.css", "sidebar.css"]) */
  readonly css: readonly string[];
  /** Extra stylesheet URLs loaded before local CSS (e.g. xyflow CDN). */
  readonly externalCss?: readonly string[];
  /** Additional import map entries merged with Preact base. */
  readonly extraImports?: Record<string, string>;
  /** Boot island filename (e.g. "boot.js"). */
  readonly boot: string;
  /** Build hash for cache-busting query string. */
  readonly v?: string;
  /** Optional loading text shown before island hydration. */
  readonly placeholder?: string;
  /** When true, also loads the dev-panel island for sim controls. */
  readonly simMode?: boolean;
};

export const PageShell = ({
  title,
  css,
  externalCss,
  extraImports,
  boot,
  v,
  placeholder,
  simMode,
}: PageShellProps): preact.VNode => {
  const q = v ? `?v=${v}` : "";
  const imports = extraImports
    ? { ...PREACT_IMPORTS, ...extraImports }
    : { ...PREACT_IMPORTS };
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{`ralphmania \u00b7 ${title}`}</title>
        {externalCss?.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        {css.map((name) => (
          <link key={name} rel="stylesheet" href={`/css/${name}${q}`} />
        ))}
        <script
          type="importmap"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({ imports }),
          }}
        />
      </head>
      <body>
        <div id="app-root">{placeholder}</div>
        <script type="module" src={`/islands/${boot}${q}`} />
        {simMode && (
          <script type="module" src={`/islands/dev-panel-boot.js${q}`} />
        )}
      </body>
    </html>
  );
};
