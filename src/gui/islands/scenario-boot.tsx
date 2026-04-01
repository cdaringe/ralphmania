/**
 * Scenario page boot entry point. Mounts the scenario page app into #app-root.
 * @module
 */
import { h, render } from "preact";
import ScenarioPageApp from "./scenario-page-app.tsx";

// deno-lint-ignore no-undef
const root = document.getElementById("app-root");
if (root) {
  render(h(ScenarioPageApp, null), root);
}
