// coverage:ignore — JSX UI component; tested via e2e
/**
 * Main GUI page component with tabbed Graph/Log view.
 * The graph panel uses React Flow (loaded from esm.sh at runtime).
 * @module
 */
import {
  BASE_CSS,
  LOG_CSS,
  MODAL_CSS,
  SIDEBAR_CSS,
  TAB_CSS,
} from "../styles.ts";
import {
  GRAPH_MODULE_SCRIPT,
  IMPORT_MAP,
  MAIN_PAGE_VANILLA_SCRIPT,
  XYFLOW_CSS_URL,
} from "../client/main-script.ts";

/** Extra CSS for the graph panel (host container for React Flow). */
const GRAPH_PANEL_CSS = `
#graph-panel{background:var(--bg);flex:1;overflow:hidden;position:relative}
#graph-root{position:absolute;inset:0}
@keyframes pulse{
  0%,100%{box-shadow:0 0 3px rgba(34,197,94,.2)}
  50%{box-shadow:0 0 12px rgba(34,197,94,.5)}
}
`;

/** Renders the full main GUI page HTML. */
// deno-lint-ignore no-explicit-any
export const MainPage = (): any => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>ralphmania · live</title>
      <link rel="stylesheet" href={XYFLOW_CSS_URL} />
      <style
        dangerouslySetInnerHTML={{
          __html: BASE_CSS + SIDEBAR_CSS + TAB_CSS + LOG_CSS + GRAPH_PANEL_CSS +
            MODAL_CSS,
        }}
      />
      <script
        type="importmap"
        dangerouslySetInnerHTML={{ __html: IMPORT_MAP }}
      />
    </head>
    <body>
      <header>
        <h1>ralphmania</h1>
        <span class="badge off" id="badge">connecting</span>
        <span id="iter"></span>
      </header>
      <main>
        <aside>
          <div>
            <div class="pt">Orchestrator</div>
            <div id="state-val">{"\u2014" as string}</div>
          </div>
          <div>
            <div class="pt">
              Progress{" "}
              <a
                href="/status"
                target="_blank"
                style="font-size:9px;color:var(--muted);text-decoration:none;float:right"
              >
                {`[full \u2192]`}
              </a>
            </div>
            <div id="status-summary" style="font-size:11px;color:var(--muted)">
              {"\u2014" as string}
            </div>
            <div id="status-list"></div>
          </div>
          <div>
            <div class="pt">Workers</div>
            <div id="workers">
              <span style="color:var(--muted);font-size:11px">none</span>
            </div>
          </div>
        </aside>
        <section
          id="content-area"
          style="display:flex;flex-direction:column;overflow:hidden"
        >
          <div id="tab-bar">
            <button type="button" class="tab active" data-tab="graph">
              Graph
            </button>
            <button type="button" class="tab" data-tab="log">Log</button>
          </div>
          <div id="graph-panel" class="panel active">
            <div id="graph-root"></div>
          </div>
          <div id="log-panel" class="panel">
            <div id="log-bar">
              <label>
                <input type="checkbox" id="autoscroll" checked /> auto-scroll
              </label>
              <label>
                <input type="checkbox" id="showdebug" /> debug
              </label>
              <button type="button" id="clrbtn">clear</button>
            </div>
            <div id="log"></div>
          </div>
        </section>
      </main>
      <div id="worker-modal" style="display:none"></div>
      {/* Vanilla JS: sidebar, tabs, log, SSE, modal */}
      <script dangerouslySetInnerHTML={{ __html: MAIN_PAGE_VANILLA_SCRIPT }} />
      {/* React Flow graph module (loaded after vanilla JS sets up the bridge) */}
      <script
        type="module"
        dangerouslySetInnerHTML={{ __html: GRAPH_MODULE_SCRIPT }}
      />
    </body>
  </html>
);
