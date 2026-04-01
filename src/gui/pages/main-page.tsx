// coverage:ignore — JSX UI component; tested via e2e
/**
 * Main GUI page. HTML shell with mount point. The boot island loads
 * all other islands as ES modules from `/islands/boot.js`.
 * @module
 */
import {
  BASE_CSS,
  LOG_CSS,
  MODAL_CSS,
  SIDEBAR_CSS,
  TAB_CSS,
} from "../styles.ts";

const XYFLOW_CSS_URL = "https://esm.sh/@xyflow/react@12/dist/style.css";

const GRAPH_PANEL_CSS = `
#graph-panel{background:var(--bg);flex:1;overflow:hidden;position:relative}
#graph-root{position:absolute;inset:0}
@keyframes pulse{
  0%,100%{opacity:1}
  50%{opacity:.82}
}
`;

// deno-lint-ignore no-explicit-any
export const MainPage = (): any => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>ralphmania · live</title>
      <link rel="stylesheet" href={XYFLOW_CSS_URL} />
      <script
        type="importmap"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            imports: {
              "preact": "https://esm.sh/preact@10",
              "preact/": "https://esm.sh/preact@10/",
              "preact/hooks": "https://esm.sh/preact@10/hooks",
              "preact/jsx-runtime": "https://esm.sh/preact@10/jsx-runtime",
              "react": "https://esm.sh/react@19",
              "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime",
              "react-dom": "https://esm.sh/react-dom@19",
              "react-dom/client": "https://esm.sh/react-dom@19/client",
            },
          }),
        }}
      />
      <style
        dangerouslySetInnerHTML={{
          __html: BASE_CSS + SIDEBAR_CSS + TAB_CSS + LOG_CSS +
            GRAPH_PANEL_CSS + MODAL_CSS,
        }}
      />
    </head>
    <body>
      <div id="app-root">Loading GUI...</div>
      <script type="module" src="/islands/boot.js" />
    </body>
  </html>
);
