/**
 * Main page boot entry point. Imports all islands and mounts the
 * application into #app-root. Compiled to browser JS by esbuild.
 * @module
 */
import { h, render } from "preact";
import SseProvider from "./sse-provider.tsx";
import ConnectionStatus from "./connection-status.tsx";
import Sidebar from "./sidebar.tsx";
import TabSwitcher from "./tab-switcher.tsx";
import WorkflowGraph from "./workflow-graph.tsx";
import LogPanel from "./log-panel.tsx";
import WorkerModal from "./worker-modal.tsx";

// deno-lint-ignore no-undef
const root = document.getElementById("app-root");
if (root) {
  render(
    h(
      SseProvider,
      null,
      h("header", null, h("h1", null, "ralphmania"), h(ConnectionStatus, null)),
      h(
        "main",
        null,
        h(Sidebar, null),
        h(
          "section",
          {
            id: "content-area",
            style: "display:flex;flex-direction:column;overflow:hidden",
          },
          h(TabSwitcher, {
            graphPanel: h(WorkflowGraph, null),
            logPanel: h(LogPanel, null),
          }),
        ),
      ),
      h(WorkerModal, null),
    ),
    root,
  );
}
