// coverage:ignore — static HTML/JS UI content; no executable logic to test
/**
 * Pre-rendered HTML strings for the GUI pages.
 * These are generated from the JSX components in ./pages/ and exported
 * as strings for use in tests and backward compatibility.
 *
 * @module
 */
import { MainPage } from "./pages/main-page.tsx";
import { WorkerPage } from "./pages/worker-page.tsx";

/** Rendered HTML for the main GUI page. */
// deno-lint-ignore no-explicit-any
export const GUI_HTML: string = (MainPage() as any).toString();

/** Rendered HTML for the per-worker detail page. */
// deno-lint-ignore no-explicit-any
export const WORKER_PAGE_HTML: string = (WorkerPage() as any).toString();
