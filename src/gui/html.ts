// coverage:ignore — static HTML/JS UI content; no executable logic to test

/** Embedded HTML source for the ralphmania live GUI page. */
export const GUI_HTML: string = `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ralphmania · live</title>
  <style>
    :root{--bg:#f4f4f5;--surface:#fff;--border:#e4e4e7;--text:#18181b;--muted:#71717a;
      --accent:#22c55e;--abg:#f0fdf4;--error:#ef4444;--mono:'Cascadia Code','SF Mono','Fira Code',monospace}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:var(--mono);background:var(--bg);color:var(--text);
      height:100dvh;display:flex;flex-direction:column;font-size:13px}
    header{background:var(--surface);border-bottom:1px solid var(--border);
      padding:10px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0}
    header h1{font-size:15px;color:var(--accent);letter-spacing:-0.02em}
    .badge{font-size:11px;padding:1px 7px;border-radius:99px;
      border:1px solid var(--accent);color:var(--accent);background:var(--abg)}
    .badge.off{border-color:var(--error);color:var(--error);background:#fef2f2}
    #iter{font-size:12px;color:var(--muted);margin-left:auto}
    main{flex:1;display:grid;grid-template-columns:220px 1fr;overflow:hidden}
    aside{background:var(--surface);border-right:1px solid var(--border);
      overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:14px}
    .pt{font-size:10px;text-transform:uppercase;letter-spacing:.1em;
      color:var(--muted);margin-bottom:4px}
    #state-val{padding:5px 8px;border-radius:4px;background:var(--abg);
      color:var(--accent);border-left:3px solid var(--accent);font-size:12px}
    .wcard{padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:11px;
      line-height:1.5;display:block;text-decoration:none;color:inherit}
    .wcard:hover{background:var(--abg);border-color:var(--accent);cursor:pointer}
    .wid{color:var(--accent);font-weight:700}
    .wscen{color:var(--muted)}
    #log-wrap{display:flex;flex-direction:column;overflow:hidden}
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
  </style>
</head>
<body>
<header>
  <h1>ralphmania</h1>
  <span class="badge off" id="badge">connecting</span>
  <span id="iter"></span>
</header>
<main>
  <aside>
    <div><div class="pt">Orchestrator</div><div id="state-val">—</div></div>
    <div>
      <div class="pt">Workers</div>
      <div id="workers"><span style="color:var(--muted);font-size:11px">none</span></div>
    </div>
  </aside>
  <section id="log-wrap">
    <div id="log-bar">
      <label><input type="checkbox" id="autoscroll" checked> auto-scroll</label>
      <label><input type="checkbox" id="showdebug"> debug</label>
      <button id="clrbtn">clear</button>
    </div>
    <div id="log"></div>
  </section>
</main>
<script>
(function(){
  var logEl=document.getElementById('log'),badge=document.getElementById('badge'),
    stateEl=document.getElementById('state-val'),workersEl=document.getElementById('workers'),
    iterEl=document.getElementById('iter'),
    autoscroll=document.getElementById('autoscroll'),
    showdebug=document.getElementById('showdebug'),
    workers=new Map();
  document.getElementById('clrbtn').onclick=function(){logEl.innerHTML='';};
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function fmt(ts){return new Date(ts).toTimeString().slice(0,8);}
  var tcls={info:'t-info',error:'t-error',debug:'t-debug',orchestrator:'t-orch',validate:'t-validate',transition:'t-trans'};
  function appendLog(ev){
    if(!showdebug.checked&&ev.level==='debug')return;
    var el=document.createElement('div');el.className='le';
    var tags=ev.tags.map(function(t){return '<span class="'+(tcls[t]||'')+'">'+esc(t)+'</span>';}).join('<span style="color:#3f3f46">:</span>');
    el.innerHTML='<span class="le-ts">'+fmt(ev.ts)+'</span><span class="le-tags">['+tags+']</span><span class="le-msg">'+esc(ev.message)+'</span>';
    logEl.appendChild(el);
    if(autoscroll.checked)logEl.scrollTop=logEl.scrollHeight;
  }
  function renderWorkers(){
    if(!workers.size){workersEl.innerHTML='<span style="color:var(--muted);font-size:11px">none</span>';return;}
    workersEl.innerHTML=[...workers.entries()].map(function(e){
      var href='/worker/'+e[0]+'?scenario='+encodeURIComponent(e[1].scenario);
      return '<a class="wcard" href="'+href+'"><span class="wid">W'+e[0]+'</span> <span class="wscen">\u2192 '+esc(e[1].scenario)+'</span></a>';
    }).join('');
  }
  // Parse worker launches: "Round N: launching N worker(s) for scenarios [s1, s2]"
  var launchRe=/launching \\d+ worker\\(s\\) for scenarios \\[([^\\]]+)\\]/;
  // Parse worker resolution: "Scenario X: resolved by worker N" / "still actionable after worker N"
  var workerEndRe=/(?:resolved|still actionable) (?:by|after) worker (\\d+)/;
  function handleLog(ev){
    appendLog(ev);
    var m=ev.message.match(/Round (\\d+):/);
    if(m)iterEl.textContent='iteration '+m[1];
    // Parse worker launches (clear old workers, add new)
    var wm=ev.message.match(launchRe);
    if(wm){
      workers.clear();
      var scens=wm[1].split(', ');
      for(var i=0;i<scens.length;i++)workers.set(i,{scenario:scens[i]});
      renderWorkers();
    }
    // Parse worker completions
    var rm=ev.message.match(workerEndRe);
    if(rm){workers.delete(parseInt(rm[1],10));renderWorkers();}
  }
  function handle(ev){
    if(ev.type==='log'){
      handleLog(ev);
    }else if(ev.type==='state'){
      stateEl.textContent=ev.to;
      if(ev.to==='done'||ev.to==='aborted'){workers.clear();renderWorkers();}
    }else if(ev.type==='worker_active'){
      workers.set(ev.workerIndex,{scenario:ev.scenario});renderWorkers();
    }else if(ev.type==='worker_done'){
      workers.delete(ev.workerIndex);renderWorkers();
    }
  }
  function connect(){
    var es=new EventSource('/events');
    es.onopen=function(){badge.textContent='live';badge.className='badge';};
    es.onmessage=function(e){try{handle(JSON.parse(e.data));}catch(err){}};
    es.onerror=function(){badge.textContent='disconnected';badge.className='badge off';es.close();setTimeout(connect,3000);};
  }
  connect();
})();
</script>
</body></html>`;

/** Embedded HTML source for the per-worker detail page at /worker/:id. */
export const WORKER_PAGE_HTML: string = `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ralphmania · worker</title>
  <style>
    :root{--bg:#f4f4f5;--surface:#fff;--border:#e4e4e7;--text:#18181b;--muted:#71717a;
      --accent:#22c55e;--abg:#f0fdf4;--error:#ef4444;--warn:#f59e0b;
      --mono:'Cascadia Code','SF Mono','Fira Code',monospace}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:var(--mono);background:var(--bg);color:var(--text);
      height:100dvh;display:flex;flex-direction:column;font-size:13px}
    header{background:var(--surface);border-bottom:1px solid var(--border);
      padding:10px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0}
    header h1{font-size:15px;color:var(--accent);letter-spacing:-0.02em}
    .back{font-size:12px;color:var(--muted);text-decoration:none;padding:2px 8px;
      border:1px solid var(--border);border-radius:4px}
    .back:hover{color:var(--accent);border-color:var(--accent)}
    .badge{font-size:11px;padding:1px 7px;border-radius:99px;
      border:1px solid var(--accent);color:var(--accent);background:var(--abg)}
    .badge.off{border-color:var(--error);color:var(--error);background:#fef2f2}
    .badge.done{border-color:var(--muted);color:var(--muted);background:var(--bg)}
    main{flex:1;display:grid;grid-template-columns:220px 1fr;overflow:hidden}
    aside{background:var(--surface);border-right:1px solid var(--border);
      overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:14px}
    .pt{font-size:10px;text-transform:uppercase;letter-spacing:.1em;
      color:var(--muted);margin-bottom:4px}
    .info-val{padding:5px 8px;border-radius:4px;background:var(--abg);
      color:var(--accent);border-left:3px solid var(--accent);font-size:12px;word-break:break-all}
    .info-val.neutral{background:var(--bg);color:var(--text);border-color:var(--border)}
    .state-running{color:var(--accent)}
    .state-done{color:var(--muted)}
    .state-failed{color:var(--error)}
    #log-wrap{display:flex;flex-direction:column;overflow:hidden}
    #log-bar{background:var(--surface);border-bottom:1px solid var(--border);
      padding:6px 12px;display:flex;gap:10px;align-items:center;flex-shrink:0}
    #log-bar label{display:flex;align-items:center;gap:4px;color:var(--muted);cursor:pointer}
    #log-bar button{margin-left:auto;font-size:11px;padding:2px 8px;cursor:pointer;
      border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--muted)}
    #log{flex:1;overflow-y:auto;padding:8px 12px;background:#18181b;color:#d4d4d8;line-height:1.6}
    .le{display:flex;gap:8px}
    .le-ts{color:#3f3f46;flex-shrink:0}
    .le-msg{flex:1;word-break:break-word}
    .t-info{color:#22d3ee}.t-error{color:#f87171;font-weight:700}
    .t-debug{color:#52525b}.t-orch{color:#4ade80}
    .t-validate{color:#fbbf24}
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
  </style>
</head>
<body>
<header>
  <h1>ralphmania</h1>
  <a class="back" href="/">&#8592; overview</a>
  <span id="worker-title" style="font-size:13px;color:var(--muted)">worker —</span>
  <span class="badge off" id="badge">connecting</span>
</header>
<main>
  <aside>
    <div>
      <div class="pt">Worker</div>
      <div class="info-val neutral" id="worker-id">—</div>
    </div>
    <div>
      <div class="pt">Scenario</div>
      <div class="info-val" id="scenario-val">—</div>
    </div>
    <div>
      <div class="pt">State</div>
      <div class="info-val neutral" id="state-val">waiting</div>
    </div>
  </aside>
  <section id="log-wrap">
    <div id="log-bar">
      <label><input type="checkbox" id="autoscroll" checked> auto-scroll</label>
      <label><input type="checkbox" id="showdebug"> debug</label>
      <button id="clrbtn">clear</button>
    </div>
    <div id="log"></div>
    <div id="input-bar">
      <textarea id="input-text" placeholder="Send input to agent (Enter to send, Shift+Enter for newline)" disabled></textarea>
      <button id="send-btn" disabled>Send</button>
      <span id="send-status"></span>
    </div>
  </section>
</main>
<script>
(function(){
  // Derive workerIndex from URL path: /worker/0
  var parts=location.pathname.split('/');
  var workerIndex=parseInt(parts[parts.length-1],10);
  var params=new URLSearchParams(location.search);
  var initScenario=params.get('scenario')||'—';

  document.getElementById('worker-title').textContent='worker '+workerIndex;
  document.getElementById('worker-id').textContent='W'+workerIndex;
  document.getElementById('scenario-val').textContent=initScenario;
  document.title='ralphmania \u00b7 worker '+workerIndex;

  var logEl=document.getElementById('log'),
    badge=document.getElementById('badge'),
    stateEl=document.getElementById('state-val'),
    scenEl=document.getElementById('scenario-val'),
    autoscroll=document.getElementById('autoscroll'),
    showdebug=document.getElementById('showdebug'),
    inputText=document.getElementById('input-text'),
    sendBtn=document.getElementById('send-btn'),
    sendStatus=document.getElementById('send-status');

  document.getElementById('clrbtn').onclick=function(){logEl.innerHTML='';};

  var isRunning=false;
  function setInputEnabled(enabled){
    isRunning=enabled;
    inputText.disabled=!enabled;
    sendBtn.disabled=!enabled;
  }

  function sendInput(){
    var text=inputText.value.trim();
    if(!text||!isRunning)return;
    inputText.value='';
    sendStatus.textContent='sending…';
    fetch('/input/'+workerIndex,{method:'POST',body:text,headers:{'Content-Type':'text/plain'}})
      .then(function(r){
        sendStatus.textContent=r.ok?'sent':'no active worker';
        setTimeout(function(){sendStatus.textContent='';},2000);
      })
      .catch(function(){
        sendStatus.textContent='error';
        setTimeout(function(){sendStatus.textContent='';},2000);
      });
  }

  sendBtn.onclick=sendInput;
  inputText.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendInput();}
  });

  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function fmt(ts){return new Date(ts).toTimeString().slice(0,8);}

  // Worker prefix pattern: [W0] or [W12] at start of message
  var wPrefixRe=new RegExp('^\\\\[W'+workerIndex+'\\\\]\\\\s*');

  function appendLine(ts,level,msg){
    if(!showdebug.checked&&level==='debug')return;
    var el=document.createElement('div');el.className='le';
    var cls=level==='error'?'t-error':level==='debug'?'t-debug':'t-info';
    el.innerHTML='<span class="le-ts">'+fmt(ts)+'</span>'
      +'<span class="le-msg '+cls+'">'+esc(msg)+'</span>';
    logEl.appendChild(el);
    if(autoscroll.checked)logEl.scrollTop=logEl.scrollHeight;
  }

  function setState(s){
    stateEl.textContent=s;
    stateEl.className='info-val neutral';
    if(s==='running'){stateEl.className='info-val state-running';setInputEnabled(true);}
    else if(s==='done'){stateEl.className='info-val state-done';setInputEnabled(false);}
    else if(s==='failed'){stateEl.className='info-val state-failed';setInputEnabled(false);}
  }

  function handle(ev){
    if(ev.type==='log'){
      // Show lines prefixed with this worker's tag
      if(wPrefixRe.test(ev.message)){
        var stripped=ev.message.replace(wPrefixRe,'');
        appendLine(ev.ts,ev.level,stripped);
      }
    }else if(ev.type==='worker_active'&&ev.workerIndex===workerIndex){
      scenEl.textContent=ev.scenario;
      setState('running');
    }else if(ev.type==='worker_done'&&ev.workerIndex===workerIndex){
      setState('done');
      badge.textContent='done';badge.className='badge done';
    }
  }

  function connect(){
    var es=new EventSource('/events');
    es.onopen=function(){badge.textContent='live';badge.className='badge';setState('running');};
    es.onmessage=function(e){try{handle(JSON.parse(e.data));}catch(err){}};
    es.onerror=function(){
      badge.textContent='disconnected';badge.className='badge off';
      es.close();setTimeout(connect,3000);
    };
  }
  connect();
})();
</script>
</body></html>`;
