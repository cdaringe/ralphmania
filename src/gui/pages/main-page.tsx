// coverage:ignore — JSX UI component; tested via e2e
/**
 * Main GUI page. HTML shell with mount point. The boot island loads
 * all other islands as ES modules from `/islands/boot.js`.
 * @module
 */
import { REACT_IMPORTS } from "./import-map.ts";
import { PageShell } from "./page-shell.tsx";

const XYFLOW_CSS_URL = "https://esm.sh/@xyflow/react@12/dist/style.css";

export const MainPage = ({ v }: { v?: string }): preact.VNode => (
  <PageShell
    title="live"
    css={[
      "base.css",
      "sidebar.css",
      "tab.css",
      "log.css",
      "graph.css",
      "modal.css",
    ]}
    externalCss={[XYFLOW_CSS_URL]}
    extraImports={REACT_IMPORTS}
    boot="boot.js"
    v={v}
    placeholder="Loading GUI..."
  />
);
