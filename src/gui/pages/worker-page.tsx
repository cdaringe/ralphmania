// coverage:ignore — JSX UI component; tested via e2e
/**
 * Per-worker detail page. HTML shell + mount point. The worker-boot
 * island loads the full worker page app.
 * @module
 */
import { BASE_CSS, LOG_CSS, SIDEBAR_CSS } from "../styles.ts";

const WORKER_EXTRA_CSS = `
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
.t-user{color:#f472b6}.t-input{color:#f472b6}
.le:has(.t-user),.le-user{border-left:3px solid #f472b6;padding-left:5px}
.le:has(.t-user) .le-msg,.le-user .le-msg{color:#f9a8d4}
`;

// deno-lint-ignore no-explicit-any
export const WorkerPage = (): any => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>ralphmania · worker</title>
      <script
        type="importmap"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            imports: {
              "preact": "https://esm.sh/preact@10",
              "preact/": "https://esm.sh/preact@10/",
              "preact/hooks": "https://esm.sh/preact@10/hooks",
              "preact/jsx-runtime": "https://esm.sh/preact@10/jsx-runtime",
            },
          }),
        }}
      />
      <style
        dangerouslySetInnerHTML={{
          __html: BASE_CSS + SIDEBAR_CSS + LOG_CSS + WORKER_EXTRA_CSS,
        }}
      />
    </head>
    <body>
      <div id="app-root" />
      <script type="module" src="/islands/worker-boot.js" />
    </body>
  </html>
);
