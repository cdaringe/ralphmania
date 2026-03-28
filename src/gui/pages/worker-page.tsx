// coverage:ignore — JSX UI component; tested via e2e
/**
 * Per-worker detail page component with streaming logs and agent input.
 * @module
 */
import { BASE_CSS, LOG_CSS, SIDEBAR_CSS } from "../styles.ts";
import { WORKER_PAGE_SCRIPT } from "../client/worker-script.ts";

const WORKER_EXTRA_CSS = `
#iter{font-size:12px;color:var(--muted);margin-left:auto}
.back{font-size:12px;color:var(--muted);text-decoration:none;padding:2px 8px;
  border:1px solid var(--border);border-radius:4px}
.back:hover{color:var(--accent);border-color:var(--accent)}
.info-val{padding:5px 8px;border-radius:4px;background:var(--abg);
  color:var(--accent);border-left:3px solid var(--accent);font-size:12px;word-break:break-all}
.info-val.neutral{background:var(--bg);color:var(--text);border-color:var(--border)}
.state-running{color:var(--accent)}
.state-done{color:var(--muted)}
.state-failed{color:var(--error)}
#input-bar{background:var(--surface);border-top:1px solid var(--border);
  padding:6px 12px;display:flex;gap:6px;align-items:center;flex-shrink:0}
#input-bar textarea{flex:1;font-family:var(--mono);font-size:12px;resize:none;
  padding:4px 8px;border:1px solid var(--border);border-radius:4px;
  background:#18181b;color:#d4d4d8;height:40px}
#input-bar textarea:focus{outline:none;border-color:var(--accent)}
#input-bar textarea:disabled{opacity:0.4;cursor:not-allowed}
#send-btn{font-size:12px;padding:4px 12px;cursor:pointer;white-space:nowrap;
  border:1px solid var(--accent);border-radius:4px;
  background:var(--abg);color:var(--accent);font-family:var(--mono)}
#send-btn:disabled{border-color:var(--border);color:var(--muted);
  background:var(--bg);cursor:not-allowed}
#send-status{font-size:11px;color:var(--muted);white-space:nowrap}
`;

/** Renders the per-worker detail page HTML. */
// deno-lint-ignore no-explicit-any
export const WorkerPage = (): any => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>ralphmania · worker</title>
      <style
        dangerouslySetInnerHTML={{
          __html: BASE_CSS + SIDEBAR_CSS + LOG_CSS + WORKER_EXTRA_CSS,
        }}
      />
    </head>
    <body>
      <header>
        <h1>ralphmania</h1>
        <a class="back" href="/">{"\u2190" as string} overview</a>
        <span id="worker-title" style="font-size:13px;color:var(--muted)">
          worker {"\u2014" as string}
        </span>
        <span class="badge off" id="badge">connecting</span>
      </header>
      <main>
        <aside>
          <div>
            <div class="pt">Worker</div>
            <div class="info-val neutral" id="worker-id">
              {"\u2014" as string}
            </div>
          </div>
          <div>
            <div class="pt">Scenario</div>
            <div class="info-val" id="scenario-val">{"\u2014" as string}</div>
          </div>
          <div>
            <div class="pt">State</div>
            <div class="info-val neutral" id="state-val">waiting</div>
          </div>
        </aside>
        <section
          id="log-wrap"
          style="display:flex;flex-direction:column;overflow:hidden"
        >
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
          <div id="input-bar">
            <textarea
              id="input-text"
              placeholder="Send input to agent (Enter to send, Shift+Enter for newline)"
              disabled
            >
            </textarea>
            <button type="button" id="send-btn" disabled>Send</button>
            <span id="send-status"></span>
          </div>
        </section>
      </main>
      <script dangerouslySetInnerHTML={{ __html: WORKER_PAGE_SCRIPT }} />
    </body>
  </html>
);
