/**
 * Worker page boot entry point. Mounts the worker page app into #app-root.
 * @module
 */
import { h, render } from "preact";
import WorkerPageApp from "./worker-page-app.tsx";

// deno-lint-ignore no-undef
const root = document.getElementById("app-root");
if (root) {
  render(h(WorkerPageApp, null), root);
}
