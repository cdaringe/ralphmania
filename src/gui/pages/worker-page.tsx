// coverage:ignore — JSX UI component; tested via e2e
/**
 * Per-worker detail page. HTML shell + mount point. The worker-boot
 * island loads the full worker page app.
 * @module
 */
import { PageShell } from "./page-shell.tsx";

export const WorkerPage = ({ v }: { v?: string }): preact.VNode => (
  <PageShell
    title="worker"
    css={["base.css", "sidebar.css", "log.css", "worker.css"]}
    boot="worker-boot.js"
    v={v}
  />
);
