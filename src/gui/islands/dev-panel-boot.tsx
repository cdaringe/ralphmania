/**
 * Dev panel boot entry point. Mounts the simulation control panel
 * into its own root element, separate from the main app.
 * @module
 */
import { h, render } from "preact";
import DevPanel from "./dev-panel.tsx";

// Create a dedicated mount point so the dev panel doesn't interfere
// with the main app's render tree.
// deno-lint-ignore no-undef
const mount = document.createElement("div");
mount.id = "dev-panel-root";
// deno-lint-ignore no-undef
document.body.appendChild(mount);

render(h(DevPanel, null), mount);
