// coverage:ignore — client-side browser script
/**
 * Client-side JavaScript for the main GUI page.
 * The graph panel uses React Flow loaded from esm.sh.
 * Non-graph UI (tabs, sidebar, log, modal) is vanilla JS.
 * @module
 */

/**
 * Inline importmap for the client-side module graph.
 * esm.sh serves ESM builds of React + React Flow.
 */
export const IMPORT_MAP = `{
  "imports": {
    "react": "https://esm.sh/react@19",
    "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime",
    "react-dom": "https://esm.sh/react-dom@19",
    "react-dom/client": "https://esm.sh/react-dom@19/client",
    "@xyflow/react": "https://esm.sh/@xyflow/react@12?external=react,react-dom"
  }
}`;

/** React Flow CSS import URL. */
export const XYFLOW_CSS_URL = "https://esm.sh/@xyflow/react@12/dist/style.css";

/**
 * Vanilla JS for non-graph features: sidebar, tabs, log panel, status
 * polling, worker modal, SSE connection. Sets window._graphUpdate for
 * the React module to subscribe to.
 */
export const MAIN_PAGE_VANILLA_SCRIPT = `
(function(){
  var logEl=document.getElementById('log'),badge=document.getElementById('badge'),
    stateEl=document.getElementById('state-val'),workersEl=document.getElementById('workers'),
    iterEl=document.getElementById('iter'),
    autoscroll=document.getElementById('autoscroll'),
    showdebug=document.getElementById('showdebug'),
    workers=new Map(),
    currentState='init';

  document.getElementById('clrbtn').onclick=function(){logEl.innerHTML='';};

  // --- Tab switching ---
  var tabs=document.querySelectorAll('.tab');
  var panels={graph:document.getElementById('graph-panel'),log:document.getElementById('log-panel')};
  tabs.forEach(function(tab){
    tab.onclick=function(){
      tabs.forEach(function(t){t.classList.remove('active');});
      tab.classList.add('active');
      Object.values(panels).forEach(function(p){p.classList.remove('active');});
      panels[tab.getAttribute('data-tab')].classList.add('active');
    };
  });

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
      return '<a class="wcard" onclick="window._openWorkerModal('+e[0]+',\\''+esc(e[1].scenario)+'\\')"><span class="wid">W'+e[0]+'</span> <span class="wscen">\\u2192 '+esc(e[1].scenario)+'</span></a>';
    }).join('');
  }

  var launchRe=/launching \\d+ worker\\(s\\) for scenarios \\[([^\\]]+)\\]/;
  var workerEndRe=/(?:resolved|still actionable) (?:by|after) worker (\\d+)/;

  function handleLog(ev){
    appendLog(ev);
    if(modalState.open && modalState.workerIndex !== null){
      var wPre=new RegExp('^\\\\[W'+modalState.workerIndex+'\\\\]\\\\s*');
      if(wPre.test(ev.message)){
        appendModalLog(ev.ts,ev.level,ev.message.replace(wPre,''));
      }
    }
    var m=ev.message.match(/Round (\\d+):/);
    if(m)iterEl.textContent='iteration '+m[1];
    var wm=ev.message.match(launchRe);
    if(wm){
      workers.clear();
      var scens=wm[1].split(', ');
      for(var i=0;i<scens.length;i++)workers.set(i,{scenario:scens[i],status:'running'});
      renderWorkers();
    }
    var rm=ev.message.match(workerEndRe);
    if(rm){workers.delete(parseInt(rm[1],10));renderWorkers();}
  }

  // --- Status diff ---
  var statusSummary=document.getElementById('status-summary'),
    statusList=document.getElementById('status-list');
  function fetchStatus(){
    fetch('/api/status').then(function(r){return r.json();}).then(function(d){
      if(d.error)return;
      var total=d.specOnly.length+d.shared.length;
      var verified=d.shared.filter(function(s){return s.status==='VERIFIED';}).length;
      var rework=d.shared.filter(function(s){return s.status==='NEEDS_REWORK';}).length;
      var wip=d.shared.filter(function(s){return s.status==='WIP'||s.status==='WORK_COMPLETE';}).length;
      var ns=d.specOnly.length;
      var parts=[verified+'/'+total+' verified'];
      if(rework>0)parts.push(rework+' rework');
      if(wip>0)parts.push(wip+' wip');
      if(ns>0)parts.push(ns+' not started');
      if(d.progressOnly.length>0)parts.push(d.progressOnly.length+' orphaned');
      statusSummary.textContent=parts.join(' \\u00b7 ');
      var html='';
      d.shared.forEach(function(s){
        var cls='s-'+s.status.toLowerCase().replace(/_/g,'-');
        html+='<div class="srow"><span>'+esc(s.id)+'</span><span class="'+cls+'">'+esc(s.status)+'</span></div>';
      });
      d.specOnly.forEach(function(id){
        html+='<div class="srow"><span>'+esc(id)+'</span><span class="s-not-started">NOT_STARTED</span></div>';
      });
      d.progressOnly.forEach(function(id){
        html+='<div class="srow"><span>'+esc(id)+'</span><span class="s-orphaned">ORPHANED</span></div>';
      });
      statusList.innerHTML=html;
    }).catch(function(){});
  }
  fetchStatus();

  // --- Worker modal ---
  var modalEl=document.getElementById('worker-modal');
  var modalState={open:false,workerIndex:null,scenario:null};

  function openWorkerModal(workerIndex,scenario){
    modalState={open:true,workerIndex:workerIndex,scenario:scenario};
    modalEl.style.display='';
    modalEl.className='modal-overlay';
    modalEl.innerHTML=
      '<div class="modal-content">'+
        '<div class="modal-header">'+
          '<h2>W'+workerIndex+' \\u2192 '+esc(scenario)+'</h2>'+
          '<a href="/worker/'+workerIndex+'?scenario='+encodeURIComponent(scenario)+'" target="_blank">pop out</a>'+
          '<button class="modal-close" id="modal-close-btn">\\u2715</button>'+
        '</div>'+
        '<div class="modal-log" id="modal-log"></div>'+
        '<div class="modal-input">'+
          '<textarea id="modal-input-text" placeholder="Send input to agent (Enter to send)"></textarea>'+
          '<button id="modal-send-btn">Send</button>'+
          '<span class="send-status" id="modal-send-status"></span>'+
        '</div>'+
      '</div>';
    document.getElementById('modal-close-btn').onclick=closeWorkerModal;
    modalEl.onclick=function(e){if(e.target===modalEl)closeWorkerModal();};
    var sendBtn=document.getElementById('modal-send-btn');
    var inputText=document.getElementById('modal-input-text');
    var sendStatus=document.getElementById('modal-send-status');
    function sendInput(){
      var text=inputText.value.trim();
      if(!text)return;
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
  }
  window._openWorkerModal=openWorkerModal;

  function closeWorkerModal(){
    modalState={open:false,workerIndex:null,scenario:null};
    modalEl.style.display='none';
    modalEl.innerHTML='';
  }

  function appendModalLog(ts,level,msg){
    var el=document.getElementById('modal-log');
    if(!el)return;
    var d=document.createElement('div');d.className='le';
    var cls=level==='error'?'t-error':level==='debug'?'t-debug':'t-info';
    d.innerHTML='<span class="le-ts">'+fmt(ts)+'</span><span class="le-msg '+cls+'">'+esc(msg)+'</span>';
    el.appendChild(d);
    el.scrollTop=el.scrollHeight;
  }

  // --- SSE + event dispatch ---
  // Expose a callback for the React graph module to subscribe to state updates.
  var graphListeners=[];
  window._onGraphEvent=function(fn){graphListeners.push(fn);};

  function notifyGraph(ev){
    for(var i=0;i<graphListeners.length;i++){
      try{graphListeners[i](ev);}catch(e){}
    }
  }

  function handle(ev){
    if(ev.type==='log'){
      handleLog(ev);
    }else if(ev.type==='state'){
      stateEl.textContent=ev.to;
      currentState=ev.to;
      if(ev.to==='done'||ev.to==='aborted'){workers.clear();renderWorkers();}
      fetchStatus();
      notifyGraph(ev);
    }else if(ev.type==='worker_active'){
      workers.set(ev.workerIndex,{scenario:ev.scenario,status:'running'});
      renderWorkers();
      notifyGraph(ev);
    }else if(ev.type==='worker_done'){
      workers.delete(ev.workerIndex);
      renderWorkers();
      fetchStatus();
      notifyGraph(ev);
    }else if(ev.type==='merge_start'||ev.type==='merge_done'){
      notifyGraph(ev);
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
`;

/**
 * React Flow graph module. Loaded as `<script type="module">`.
 * Uses esm.sh imports for React and @xyflow/react.
 */
export const GRAPH_MODULE_SCRIPT = `
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactFlow,
  Background,
  Controls,
  Position,
  MarkerType,
} from '@xyflow/react';

// --- Node/edge definitions for the orchestrator state machine ---
var ACCENT='#22c55e', DONE_GREEN='#16a34a', INACTIVE='#d1d5db', MUTED='#9ca3af',
    ERROR='#ef4444', PURPLE='#a78bfa', BG='#f4f4f5', SURFACE='#fff';

var STATE_ORDER=['init','reading_progress','finding_actionable','running_workers','validating','checking_doneness'];

function stateNodeStyle(state, activeState) {
  var activeIdx=STATE_ORDER.indexOf(activeState);
  var thisIdx=STATE_ORDER.indexOf(state);
  if(state===activeState) return {
    background: '#f0fdf4', border: '2px solid '+ACCENT, color: ACCENT,
    fontWeight: 700, boxShadow: '0 0 12px rgba(34,197,94,.4)',
    animation: 'pulse 1.5s ease-in-out infinite',
  };
  if(activeIdx>=0 && thisIdx>=0 && thisIdx<activeIdx) return {
    background: '#dcfce7', border: '1.5px solid '+DONE_GREEN, color: '#15803d',
  };
  return {
    background: '#f9fafb', border: '1px solid '+INACTIVE, color: MUTED, opacity: 0.7,
  };
}

function terminalNodeStyle(state, activeState) {
  if(state==='done' && activeState==='done') return {
    background: '#f0fdf4', border: '2px solid '+ACCENT, color: ACCENT,
    fontWeight: 700, boxShadow: '0 0 12px rgba(34,197,94,.4)',
  };
  if(state==='aborted' && activeState==='aborted') return {
    background: '#fef2f2', border: '2px solid '+ERROR, color: ERROR, fontWeight: 700,
  };
  return { background: '#f9fafb', border: '1px solid '+INACTIVE, color: MUTED, opacity: 0.5 };
}

var baseNodeStyle = {
  padding: '8px 18px', borderRadius: 8, fontSize: 12,
  fontFamily: "'Cascadia Code','SF Mono','Fira Code',monospace",
  textAlign: 'center', minWidth: 160,
};

function makeStaticNodes(activeState) {
  return [
    { id: 'init', position: { x: 250, y: 0 }, data: { label: 'init' },
      style: { ...baseNodeStyle, ...stateNodeStyle('init', activeState) },
      sourcePosition: Position.Bottom, targetPosition: Position.Top },
    { id: 'reading_progress', position: { x: 250, y: 90 }, data: { label: 'reading_progress' },
      style: { ...baseNodeStyle, ...stateNodeStyle('reading_progress', activeState) },
      sourcePosition: Position.Bottom, targetPosition: Position.Top },
    { id: 'finding_actionable', position: { x: 250, y: 180 }, data: { label: 'finding_actionable' },
      style: { ...baseNodeStyle, ...stateNodeStyle('finding_actionable', activeState) },
      sourcePosition: Position.Bottom, targetPosition: Position.Top },
    { id: 'running_workers', position: { x: 250, y: 270 }, data: { label: 'running_workers' },
      style: { ...baseNodeStyle, ...stateNodeStyle('running_workers', activeState) },
      sourcePosition: Position.Bottom, targetPosition: Position.Top },
    { id: 'validating', position: { x: 250, y: 540 }, data: { label: 'validating' },
      style: { ...baseNodeStyle, ...stateNodeStyle('validating', activeState) },
      sourcePosition: Position.Bottom, targetPosition: Position.Top },
    { id: 'checking_doneness', position: { x: 250, y: 630 }, data: { label: 'checking_doneness' },
      style: { ...baseNodeStyle, ...stateNodeStyle('checking_doneness', activeState) },
      sourcePosition: Position.Bottom, targetPosition: Position.Top },
    { id: 'done', position: { x: 250, y: 720 }, data: { label: 'done' },
      style: { ...baseNodeStyle, borderRadius: 20, ...terminalNodeStyle('done', activeState) },
      targetPosition: Position.Top },
    { id: 'aborted', position: { x: 500, y: 90 }, data: { label: 'aborted' },
      style: { ...baseNodeStyle, borderRadius: 20, minWidth: 100, ...terminalNodeStyle('aborted', activeState) },
      targetPosition: Position.Left },
  ];
}

function edgeStyle(from, to, activeState) {
  var activeIdx=STATE_ORDER.indexOf(activeState);
  var toIdx=STATE_ORDER.indexOf(to);
  if(to===activeState) return { stroke: ACCENT, strokeWidth: 2 };
  if(activeIdx>=0 && toIdx>=0 && toIdx<activeIdx) return { stroke: DONE_GREEN, strokeWidth: 1.5 };
  return { stroke: INACTIVE, strokeWidth: 1, opacity: 0.5 };
}

function makeStaticEdges(activeState) {
  return [
    { id: 'e-init-rp', source: 'init', target: 'reading_progress',
      style: edgeStyle('init','reading_progress',activeState),
      markerEnd: { type: MarkerType.ArrowClosed } },
    { id: 'e-rp-fa', source: 'reading_progress', target: 'finding_actionable',
      style: edgeStyle('reading_progress','finding_actionable',activeState),
      markerEnd: { type: MarkerType.ArrowClosed } },
    { id: 'e-fa-rw', source: 'finding_actionable', target: 'running_workers',
      style: edgeStyle('finding_actionable','running_workers',activeState),
      markerEnd: { type: MarkerType.ArrowClosed } },
    { id: 'e-rw-val', source: 'running_workers', target: 'validating',
      style: edgeStyle('running_workers','validating',activeState),
      markerEnd: { type: MarkerType.ArrowClosed } },
    { id: 'e-val-cd', source: 'validating', target: 'checking_doneness',
      style: edgeStyle('validating','checking_doneness',activeState),
      markerEnd: { type: MarkerType.ArrowClosed } },
    { id: 'e-cd-done', source: 'checking_doneness', target: 'done',
      style: edgeStyle('checking_doneness','done',activeState),
      markerEnd: { type: MarkerType.ArrowClosed } },
    { id: 'e-loop', source: 'checking_doneness', target: 'reading_progress',
      type: 'smoothstep',
      style: { stroke: PURPLE, strokeWidth: 1.5, strokeDasharray: '6,3' },
      markerEnd: { type: MarkerType.ArrowClosed, color: PURPLE },
      sourcePosition: Position.Right, targetPosition: Position.Right },
    { id: 'e-rp-abort', source: 'reading_progress', target: 'aborted',
      style: { stroke: INACTIVE, strokeWidth: 1, opacity: 0.4 },
      markerEnd: { type: MarkerType.ArrowClosed },
      sourcePosition: Position.Right },
  ];
}

// --- Worker nodes (dynamic) ---
function makeWorkerNodes(workersMap, activeState) {
  var workerNodes = [];
  var workerEdges = [];
  var count = workersMap.size;
  if (count === 0) return { nodes: [], edges: [] };

  var startX = 50;
  var spacing = Math.min(200, 600 / count);
  var workerY = 370;
  var mergeY = 460;
  var entries = [...workersMap.entries()];

  entries.forEach(function(e, idx) {
    var wi = e[0], info = e[1];
    var cx = startX + spacing * idx;
    var isDone = info.status === 'done';
    var isMerging = info.status === 'merging';
    var nodeStyle = isDone
      ? { ...baseNodeStyle, background: '#dcfce7', border: '1.5px solid '+DONE_GREEN, color: '#15803d', cursor: 'pointer', minWidth: 80 }
      : isMerging
        ? { ...baseNodeStyle, background: '#fefce8', border: '2px solid #f59e0b', color: '#92400e', cursor: 'pointer', minWidth: 80,
            animation: 'pulse 1.5s ease-in-out infinite' }
        : { ...baseNodeStyle, background: '#f0fdf4', border: '2px solid '+ACCENT, color: ACCENT,
            fontWeight: 700, cursor: 'pointer', minWidth: 80,
            boxShadow: '0 0 12px rgba(34,197,94,.4)',
            animation: 'pulse 1.5s ease-in-out infinite' };

    workerNodes.push({
      id: 'worker-'+wi,
      position: { x: cx, y: workerY },
      data: { label: 'W'+wi+' '+info.scenario, workerIndex: wi, scenario: info.scenario },
      style: nodeStyle,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    });

    workerEdges.push({
      id: 'e-rw-w'+wi, source: 'running_workers', target: 'worker-'+wi,
      style: { stroke: isDone ? DONE_GREEN : ACCENT, strokeWidth: isDone ? 1.5 : 2 },
      markerEnd: { type: MarkerType.ArrowClosed },
    });
    workerEdges.push({
      id: 'e-w'+wi+'-merge', source: 'worker-'+wi, target: 'merge',
      style: { stroke: isDone ? DONE_GREEN : ACCENT, strokeWidth: isDone ? 1.5 : 2 },
      markerEnd: { type: MarkerType.ArrowClosed },
    });
  });

  // Merge pseudo-node
  var mergeActive = entries.some(function(e){ return e[1].status === 'merging'; });
  var allDone = entries.every(function(e){ return e[1].status === 'done' || e[1].status === 'merged'; });
  workerNodes.push({
    id: 'merge',
    position: { x: 250, y: mergeY },
    data: { label: 'merge' },
    style: {
      ...baseNodeStyle, borderRadius: 20, minWidth: 80,
      ...(mergeActive
        ? { background: '#fefce8', border: '2px solid #f59e0b', color: '#92400e',
            animation: 'pulse 1.5s ease-in-out infinite' }
        : allDone
          ? { background: '#dcfce7', border: '1.5px solid '+DONE_GREEN, color: '#15803d' }
          : { background: '#f9fafb', border: '1px solid '+INACTIVE, color: MUTED, opacity: 0.7 }),
    },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  });

  // Replace the direct rw→val edge with merge→val
  workerEdges.push({
    id: 'e-merge-val', source: 'merge', target: 'validating',
    style: { stroke: allDone ? DONE_GREEN : INACTIVE, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed },
  });

  return { nodes: workerNodes, edges: workerEdges };
}

// --- React Flow App ---
function GraphApp() {
  var [activeState, setActiveState] = useState('init');
  var [workersMap, setWorkersMap] = useState(new Map());
  var workersRef = useRef(workersMap);

  // Keep ref in sync for event handlers
  useEffect(function() { workersRef.current = workersMap; }, [workersMap]);

  // Build nodes & edges
  var staticNodes = makeStaticNodes(activeState);
  var staticEdges = makeStaticEdges(activeState);
  var dynamic = makeWorkerNodes(workersMap, activeState);

  // When workers exist, hide the direct rw→val edge
  var filteredEdges = workersMap.size > 0
    ? staticEdges.filter(function(e) { return e.id !== 'e-rw-val'; })
    : staticEdges;

  var allNodes = staticNodes.concat(dynamic.nodes);
  var allEdges = filteredEdges.concat(dynamic.edges);

  var onNodeClick = useCallback(function(event, node) {
    if (node.data && node.data.workerIndex !== undefined && window._openWorkerModal) {
      window._openWorkerModal(node.data.workerIndex, node.data.scenario);
    }
  }, []);

  // Subscribe to SSE events via the vanilla JS bridge
  useEffect(function() {
    if (!window._onGraphEvent) return;
    window._onGraphEvent(function(ev) {
      if (ev.type === 'state') {
        setActiveState(ev.to);
        if (ev.to !== 'running_workers' && ev.to !== 'validating') {
          setWorkersMap(new Map());
        }
      } else if (ev.type === 'worker_active') {
        setWorkersMap(function(prev) {
          var next = new Map(prev);
          next.set(ev.workerIndex, { scenario: ev.scenario, status: 'running' });
          return next;
        });
      } else if (ev.type === 'worker_done') {
        setWorkersMap(function(prev) {
          var next = new Map(prev);
          var existing = next.get(ev.workerIndex);
          if (existing) next.set(ev.workerIndex, { ...existing, status: 'done' });
          return next;
        });
      } else if (ev.type === 'merge_start') {
        setWorkersMap(function(prev) {
          var next = new Map(prev);
          var existing = next.get(ev.workerIndex);
          if (existing) next.set(ev.workerIndex, { ...existing, status: 'merging' });
          return next;
        });
      } else if (ev.type === 'merge_done') {
        setWorkersMap(function(prev) {
          var next = new Map(prev);
          var existing = next.get(ev.workerIndex);
          if (existing) next.set(ev.workerIndex, { ...existing, status: 'merged' });
          return next;
        });
      }
    });
  }, []);

  return React.createElement(ReactFlow, {
    nodes: allNodes,
    edges: allEdges,
    onNodeClick: onNodeClick,
    fitView: true,
    fitViewOptions: { padding: 0.2 },
    nodesDraggable: false,
    nodesConnectable: false,
    elementsSelectable: false,
    panOnDrag: true,
    zoomOnScroll: true,
    minZoom: 0.5,
    maxZoom: 2,
    proOptions: { hideAttribution: true },
    style: { background: BG },
  },
    React.createElement(Background, { color: '#e4e4e7', gap: 20, size: 1 }),
    React.createElement(Controls, { showInteractive: false }),
  );
}

// --- Mount ---
var root = createRoot(document.getElementById('graph-root'));
root.render(React.createElement(GraphApp));
`;
