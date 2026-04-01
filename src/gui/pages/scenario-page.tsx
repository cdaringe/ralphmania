// coverage:ignore — JSX UI component; tested via e2e
/**
 * Per-scenario detail page. HTML shell + mount point. The scenario-boot
 * island loads the full scenario page app.
 * @module
 */
import { PageShell } from "./page-shell.tsx";

export const ScenarioPage = ({ v }: { v?: string }): preact.VNode => (
  <PageShell
    title="scenario"
    css={["base.css", "sidebar.css", "scenario.css"]}
    boot="scenario-boot.js"
    v={v}
  />
);
