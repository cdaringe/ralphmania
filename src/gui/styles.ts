// coverage:ignore — static CSS content
/** Shared CSS variables and base styles for the GUI. */
export const BASE_CSS = `
:root{--bg:#f4f4f5;--surface:#fff;--border:#e4e4e7;--text:#18181b;--muted:#71717a;
  --accent:#22c55e;--abg:#f0fdf4;--error:#ef4444;--warn:#f59e0b;
  --mono:'Cascadia Code','SF Mono','Fira Code',monospace;
  --purple:#a78bfa;--cyan:#22d3ee}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--mono);background:var(--bg);color:var(--text);
  height:100dvh;display:flex;flex-direction:column;font-size:13px}
header{background:var(--surface);border-bottom:1px solid var(--border);
  padding:10px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0}
header h1{font-size:15px;color:var(--accent);letter-spacing:-0.02em}
.badge{font-size:11px;padding:1px 7px;border-radius:99px;
  border:1px solid var(--accent);color:var(--accent);background:var(--abg)}
.badge.off{border-color:var(--error);color:var(--error);background:#fef2f2}
.badge.done{border-color:var(--muted);color:var(--muted);background:var(--bg)}
`;

export const SIDEBAR_CSS = `
main{flex:1;display:grid;grid-template-columns:220px 1fr;overflow:hidden}
aside{background:var(--surface);border-right:1px solid var(--border);
  overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:14px}
.pt{font-size:10px;text-transform:uppercase;letter-spacing:.1em;
  color:var(--muted);margin-bottom:4px}
#state-val{padding:5px 8px;border-radius:4px;background:var(--abg);
  color:var(--accent);border-left:3px solid var(--accent);font-size:12px}
.wcard{padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:11px;
  line-height:1.5;display:block;text-decoration:none;color:inherit;cursor:pointer}
.wcard:hover{background:var(--abg);border-color:var(--accent)}
.wid{color:var(--accent);font-weight:700}
.wscen{color:var(--muted)}
.s-verified{color:#1a7a1a}.s-needs-rework{color:#c0392b}.s-wip{color:#e67e22}
.s-work-complete{color:#2980b9}.s-obsolete{color:#888}.s-not-started{color:#999}
.s-orphaned{color:#c0392b}
#status-list{margin-top:6px;display:flex;flex-direction:column;gap:1px;max-height:40vh;overflow-y:auto}
.srow{display:flex;justify-content:space-between;font-size:10px;padding:1px 0}
.srow span:first-child{color:var(--muted)}
`;

export const LOG_CSS = `
#log-bar{background:var(--surface);border-bottom:1px solid var(--border);
  padding:6px 12px;display:flex;gap:10px;align-items:center;flex-shrink:0}
#log-bar label{display:flex;align-items:center;gap:4px;color:var(--muted);cursor:pointer}
#log-bar button{margin-left:auto;font-size:11px;padding:2px 8px;cursor:pointer;
  border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--muted)}
#log{flex:1;overflow-y:auto;padding:8px 12px;background:#18181b;color:#d4d4d8;line-height:1.6}
.le{display:flex;gap:8px}
.le-ts{color:#3f3f46;flex-shrink:0}
.le-tags{flex-shrink:0}
.le-msg{flex:1;word-break:break-word}
.t-info{color:#22d3ee}.t-error{color:#f87171;font-weight:700}
.t-debug{color:#52525b}.t-orch{color:#4ade80}
.t-validate{color:#fbbf24}.t-trans{color:#a78bfa}
`;

export const TAB_CSS = `
#tab-bar{background:var(--surface);border-bottom:1px solid var(--border);
  padding:0 12px;display:flex;gap:0;flex-shrink:0}
.tab{padding:8px 16px;font-size:12px;font-family:var(--mono);cursor:pointer;
  border:none;background:none;color:var(--muted);border-bottom:2px solid transparent;
  transition:color .15s,border-color .15s}
.tab:hover{color:var(--text)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:700}
.panel{display:none;flex:1;overflow:hidden;flex-direction:column}
.panel.active{display:flex}
`;

export const MODAL_CSS = `
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100;
  display:flex;align-items:center;justify-content:center}
.modal-content{background:var(--bg);border:1px solid var(--border);border-radius:8px;
  width:min(800px,90vw);height:min(600px,80vh);display:flex;flex-direction:column;overflow:hidden}
.modal-header{background:var(--surface);border-bottom:1px solid var(--border);
  padding:10px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0}
.modal-header h2{font-size:14px;color:var(--accent);flex:1}
.modal-header a{font-size:11px;color:var(--muted);text-decoration:none;
  border:1px solid var(--border);border-radius:4px;padding:2px 8px}
.modal-header a:hover{color:var(--accent);border-color:var(--accent)}
.modal-close{font-size:16px;cursor:pointer;background:none;border:none;color:var(--muted);
  padding:2px 6px;border-radius:4px}
.modal-close:hover{color:var(--error);background:#fef2f2}
.modal-log{flex:1;overflow-y:auto;padding:8px 12px;background:#18181b;color:#d4d4d8;
  line-height:1.6;font-size:12px}
.modal-input{background:var(--surface);border-top:1px solid var(--border);
  padding:6px 12px;display:flex;gap:6px;align-items:center;flex-shrink:0}
.modal-input textarea{flex:1;font-family:var(--mono);font-size:12px;resize:none;
  padding:4px 8px;border:1px solid var(--border);border-radius:4px;
  background:#18181b;color:#d4d4d8;height:40px}
.modal-input textarea:focus{outline:none;border-color:var(--accent)}
.modal-input button{font-size:12px;padding:4px 12px;cursor:pointer;white-space:nowrap;
  border:1px solid var(--accent);border-radius:4px;
  background:var(--abg);color:var(--accent);font-family:var(--mono)}
.modal-input .send-status{font-size:11px;color:var(--muted);white-space:nowrap}
`;
