// coverage:ignore — client-side browser script
/**
 * Client-side JavaScript for the per-worker detail page.
 * Exported as a string constant to be embedded in a &lt;script&gt; tag.
 * @module
 */

export const WORKER_PAGE_SCRIPT = `
(function(){
  var parts=location.pathname.split('/');
  var workerIndex=parseInt(parts[parts.length-1],10);
  var params=new URLSearchParams(location.search);
  var initScenario=params.get('scenario')||'\\u2014';

  document.getElementById('worker-title').textContent='worker '+workerIndex;
  document.getElementById('worker-id').textContent='W'+workerIndex;
  document.getElementById('scenario-val').textContent=initScenario;
  document.title='ralphmania \\u00b7 worker '+workerIndex;

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
    sendStatus.textContent='sending\\u2026';
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
`;
