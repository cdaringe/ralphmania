/**
 * Workflow graph island — React Flow visualization of the orchestrator
 * state machine with dynamic worker nodes.
 *
 * Fresh islands use preact, but React Flow requires real React. This island
 * bridges the two: preact handles lifecycle/state, while React + React Flow
 * are loaded from esm.sh and render into a dedicated React root.
 *
 * @module
 */
import { useEffect, useRef } from "preact/hooks";
import {
  getActiveWorkers,
  getHydrated,
  getOrchestratorState,
  setSelectedWorker,
  subscribe,
  type WorkerInfo,
} from "./event-store.ts";

const ACCENT = "#22c55e";
const DONE_GREEN = "#16a34a";
const INACTIVE = "#d1d5db";
const MUTED = "#9ca3af";
const ERROR = "#ef4444";
const PURPLE = "#a78bfa";
const BG = "#f4f4f5";

const STATE_ORDER = [
  "init",
  "reading_progress",
  "finding_actionable",
  "running_workers",
  "validating",
  "checking_doneness",
  "rectifying",
];

const baseNodeStyle = {
  padding: "8px 18px",
  borderRadius: 8,
  fontSize: 12,
  fontFamily: "'Cascadia Code','SF Mono','Fira Code',monospace",
  textAlign: "center" as const,
  minWidth: 160,
};

const stateNodeStyle = (
  state: string,
  activeState: string,
): Record<string, unknown> => {
  const activeIdx = STATE_ORDER.indexOf(activeState);
  const thisIdx = STATE_ORDER.indexOf(state);
  const isActive = state === activeState;
  return isActive
    ? {
      background: "#f0fdf4",
      border: `2px solid ${ACCENT}`,
      color: ACCENT,
      fontWeight: 700,
      boxShadow: "0 0 12px rgba(34,197,94,.4)",
      animation: "pulse 2.5s ease-in-out infinite",
    }
    : activeIdx >= 0 && thisIdx >= 0 && thisIdx < activeIdx
    ? {
      background: "#dcfce7",
      border: `1.5px solid ${DONE_GREEN}`,
      color: "#15803d",
    }
    : {
      background: "#f9fafb",
      border: `1px solid ${INACTIVE}`,
      color: MUTED,
      opacity: 0.7,
    };
};

const terminalNodeStyle = (
  state: string,
  activeState: string,
): Record<string, unknown> =>
  state === "done" && activeState === "done"
    ? {
      background: "#f0fdf4",
      border: `2px solid ${ACCENT}`,
      color: ACCENT,
      fontWeight: 700,
      boxShadow: "0 0 12px rgba(34,197,94,.4)",
    }
    : state === "aborted" && activeState === "aborted"
    ? {
      background: "#fef2f2",
      border: `2px solid ${ERROR}`,
      color: ERROR,
      fontWeight: 700,
    }
    : {
      background: "#f9fafb",
      border: `1px solid ${INACTIVE}`,
      color: MUTED,
      opacity: 0.5,
    };

const edgeStyle = (
  _from: string,
  to: string,
  activeState: string,
): Record<string, unknown> => {
  const activeIdx = STATE_ORDER.indexOf(activeState);
  const toIdx = STATE_ORDER.indexOf(to);
  return to === activeState
    ? { stroke: ACCENT, strokeWidth: 2 }
    : activeIdx >= 0 && toIdx >= 0 && toIdx < activeIdx
    ? { stroke: DONE_GREEN, strokeWidth: 1.5 }
    : { stroke: INACTIVE, strokeWidth: 1, opacity: 0.5 };
};

// deno-lint-ignore no-explicit-any
type RF = Record<string, any>;

/**
 * Grid-based layout encoding.
 *
 * The graph flows in an L-shape:
 *   - Horizontal pipeline (row 0): init → read → find → dispatch
 *   - Workers fan out vertically in WORKER_COL, stacked by row
 *   - Merge + validate + done drop down in DISPATCH_COL, below the workers
 *
 * COL/ROW indices map to pixel positions via CELL dimensions.
 */
const COL = {
  INIT: 0,
  READ_PROGRESS: 1,
  FIND_ACTIONABLE: 2,
  DISPATCH: 3, // running_workers, merge, validating, checking_doneness, done
  RECTIFY: 2, // rectifying (left of validating, same column as find_actionable)
  WORKERS: 4, // worker nodes (stacked vertically)
  ABORT: 1, // aborted sits above reading_progress
} as const;

const ROW = {
  PIPELINE: 0, // horizontal pipeline
  ABORT: -1, // aborted above pipeline
  WORKERS_START: 1, // first worker row
  // merge, validate, checking_doneness, done are computed dynamically
  // as WORKERS_START + workerCount + offset
} as const;

const CELL = { w: 200, h: 100 };

const gridPos = (col: number, row: number) => ({
  x: col * CELL.w,
  y: row * CELL.h,
});

const buildGraph = (
  as: string,
  workersMap: ReadonlyMap<number, WorkerInfo>,
  rf: RF,
): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } => {
  const { MarkerType: MT, Position: P } = rf;

  // How many worker rows do we need? At least 1 for the merge row offset.
  const workerCount = Math.max(workersMap.size, 1);

  // Vertical section starts after all worker rows
  const mergeRow = ROW.WORKERS_START + workerCount;
  const validateRow = mergeRow + 1;
  const donenessRow = validateRow + 1;
  const rectifyRow = validateRow; // same row as validating, in RECTIFY col
  const doneRow = donenessRow + 1;

  const nodes: Record<string, unknown>[] = [
    // ── Horizontal pipeline (row 0) ──
    {
      id: "init",
      position: gridPos(COL.INIT, ROW.PIPELINE),
      data: { label: "init" },
      style: { ...baseNodeStyle, ...stateNodeStyle("init", as) },
      sourcePosition: P.Right,
      targetPosition: P.Left,
    },
    {
      id: "reading_progress",
      position: gridPos(COL.READ_PROGRESS, ROW.PIPELINE),
      data: { label: "reading_progress" },
      style: { ...baseNodeStyle, ...stateNodeStyle("reading_progress", as) },
      sourcePosition: P.Right,
      targetPosition: P.Left,
    },
    {
      id: "finding_actionable",
      position: gridPos(COL.FIND_ACTIONABLE, ROW.PIPELINE),
      data: { label: "finding_actionable" },
      style: { ...baseNodeStyle, ...stateNodeStyle("finding_actionable", as) },
      sourcePosition: P.Right,
      targetPosition: P.Left,
    },
    {
      id: "running_workers",
      position: gridPos(COL.DISPATCH, ROW.PIPELINE),
      data: { label: "running_workers" },
      style: { ...baseNodeStyle, ...stateNodeStyle("running_workers", as) },
      sourcePosition: P.Bottom,
      targetPosition: P.Left,
    },

    // ── Vertical tail (dispatch column, below workers) ──
    {
      id: "validating",
      position: gridPos(COL.DISPATCH, validateRow),
      data: { label: "validating", phase: "validate" },
      style: {
        ...baseNodeStyle,
        cursor: "pointer",
        ...stateNodeStyle("validating", as),
      },
      sourcePosition: P.Bottom,
      targetPosition: P.Top,
    },
    {
      id: "checking_doneness",
      position: gridPos(COL.DISPATCH, donenessRow),
      data: { label: "checking_doneness" },
      style: { ...baseNodeStyle, ...stateNodeStyle("checking_doneness", as) },
      sourcePosition: P.Bottom,
      targetPosition: P.Top,
    },
    {
      id: "rectifying",
      position: gridPos(COL.RECTIFY, rectifyRow),
      data: { label: "rectifying", phase: "rectify" },
      style: {
        ...baseNodeStyle,
        cursor: "pointer",
        ...stateNodeStyle("rectifying", as),
      },
      sourcePosition: P.Right,
      targetPosition: P.Top,
    },
    {
      id: "done",
      position: gridPos(COL.DISPATCH, doneRow),
      data: { label: "done" },
      style: {
        ...baseNodeStyle,
        borderRadius: 20,
        ...terminalNodeStyle("done", as),
      },
      targetPosition: P.Top,
    },
    {
      id: "aborted",
      position: gridPos(COL.ABORT, ROW.ABORT),
      data: { label: "aborted" },
      style: {
        ...baseNodeStyle,
        borderRadius: 20,
        minWidth: 100,
        ...terminalNodeStyle("aborted", as),
      },
      targetPosition: P.Bottom,
    },
  ];

  const edges: Record<string, unknown>[] = [
    // ── Horizontal pipeline edges ──
    {
      id: "e-init-rp",
      source: "init",
      target: "reading_progress",
      style: edgeStyle("init", "reading_progress", as),
      markerEnd: { type: MT.ArrowClosed },
    },
    {
      id: "e-rp-fa",
      source: "reading_progress",
      target: "finding_actionable",
      style: edgeStyle("reading_progress", "finding_actionable", as),
      markerEnd: { type: MT.ArrowClosed },
    },
    {
      id: "e-fa-rw",
      source: "finding_actionable",
      target: "running_workers",
      style: edgeStyle("finding_actionable", "running_workers", as),
      markerEnd: { type: MT.ArrowClosed },
    },

    // ── Default: running_workers → validating (removed when workers exist) ──
    {
      id: "e-rw-val",
      source: "running_workers",
      target: "validating",
      style: edgeStyle("running_workers", "validating", as),
      markerEnd: { type: MT.ArrowClosed },
    },

    // ── Vertical tail edges ──
    {
      id: "e-val-cd",
      source: "validating",
      target: "checking_doneness",
      style: edgeStyle("validating", "checking_doneness", as),
      markerEnd: { type: MT.ArrowClosed },
    },
    {
      id: "e-cd-done",
      source: "checking_doneness",
      target: "done",
      style: edgeStyle("checking_doneness", "done", as),
      markerEnd: { type: MT.ArrowClosed },
    },

    // ── Rectification loop: validating → rectifying → validating ──
    {
      id: "e-val-rect",
      source: "validating",
      target: "rectifying",
      type: "smoothstep",
      style: edgeStyle("validating", "rectifying", as),
      markerEnd: { type: MT.ArrowClosed },
      sourcePosition: P.Left,
      targetPosition: P.Top,
    },
    {
      id: "e-rect-val",
      source: "rectifying",
      target: "validating",
      type: "smoothstep",
      style: { stroke: PURPLE, strokeWidth: 1.5, strokeDasharray: "6,3" },
      markerEnd: { type: MT.ArrowClosed, color: PURPLE },
      sourcePosition: P.Right,
      targetPosition: P.Left,
    },

    // ── Loop: checking_doneness → reading_progress ──
    {
      id: "e-loop",
      source: "checking_doneness",
      target: "reading_progress",
      type: "smoothstep",
      style: { stroke: PURPLE, strokeWidth: 1.5, strokeDasharray: "6,3" },
      markerEnd: { type: MT.ArrowClosed, color: PURPLE },
      sourcePosition: P.Left,
      targetPosition: P.Bottom,
    },

    // ── Abort edge ──
    {
      id: "e-rp-abort",
      source: "reading_progress",
      target: "aborted",
      style: { stroke: INACTIVE, strokeWidth: 1, opacity: 0.4 },
      markerEnd: { type: MT.ArrowClosed },
      sourcePosition: P.Top,
    },
  ];

  // ── Dynamic worker nodes (stacked vertically in WORKER_COL) ──
  if (workersMap.size > 0) {
    const entries = [...workersMap.entries()];

    entries.forEach(([wi, info], idx) => {
      const isDone = info.status === "done" || info.status === "merged";
      const isMerging = info.status === "merging";
      const nodeStyle = isDone
        ? {
          ...baseNodeStyle,
          background: "#dcfce7",
          border: `1.5px solid ${DONE_GREEN}`,
          color: "#15803d",
          cursor: "pointer",
          minWidth: 80,
        }
        : isMerging
        ? {
          ...baseNodeStyle,
          background: "#fefce8",
          border: "2px solid #f59e0b",
          color: "#92400e",
          cursor: "pointer",
          minWidth: 80,
          animation: "pulse 2.5s ease-in-out infinite",
        }
        : {
          ...baseNodeStyle,
          background: "#f0fdf4",
          border: `2px solid ${ACCENT}`,
          color: ACCENT,
          fontWeight: 700,
          cursor: "pointer",
          minWidth: 80,
          boxShadow: "0 0 12px rgba(34,197,94,.4)",
          animation: "pulse 2.5s ease-in-out infinite",
        };

      nodes.push({
        id: `worker-${wi}`,
        position: gridPos(COL.WORKERS, ROW.WORKERS_START + idx),
        data: {
          label: `W${wi} ${info.scenario}`,
          workerIndex: wi,
          scenario: info.scenario,
        },
        style: nodeStyle,
        sourcePosition: P.Left,
        targetPosition: P.Left,
      });
      edges.push(
        {
          id: `e-rw-w${wi}`,
          source: "running_workers",
          target: `worker-${wi}`,
          style: {
            stroke: isDone ? DONE_GREEN : ACCENT,
            strokeWidth: isDone ? 1.5 : 2,
          },
          markerEnd: { type: MT.ArrowClosed },
          sourcePosition: P.Right,
        },
        {
          id: `e-w${wi}-merge`,
          source: `worker-${wi}`,
          target: "merge",
          style: {
            stroke: isDone ? DONE_GREEN : ACCENT,
            strokeWidth: isDone ? 1.5 : 2,
          },
          markerEnd: { type: MT.ArrowClosed },
          targetPosition: P.Right,
        },
      );
    });

    // ── Merge node: dispatch column, below all workers ──
    const mergeActive = entries.some(([, i]) => i.status === "merging");
    const allDone = entries.every(([, i]) =>
      i.status === "done" || i.status === "merged"
    );
    nodes.push({
      id: "merge",
      position: gridPos(COL.DISPATCH, mergeRow),
      data: { label: "merge", phase: "merge" },
      style: {
        ...baseNodeStyle,
        borderRadius: 20,
        minWidth: 80,
        cursor: "pointer",
        ...(mergeActive
          ? {
            background: "#fefce8",
            border: "2px solid #f59e0b",
            color: "#92400e",
            animation: "pulse 2.5s ease-in-out infinite",
          }
          : allDone
          ? {
            background: "#dcfce7",
            border: `1.5px solid ${DONE_GREEN}`,
            color: "#15803d",
          }
          : {
            background: "#f9fafb",
            border: `1px solid ${INACTIVE}`,
            color: MUTED,
            opacity: 0.7,
          }),
      },
      sourcePosition: P.Bottom,
      targetPosition: P.Top,
    });
    edges.push({
      id: "e-merge-val",
      source: "merge",
      target: "validating",
      style: { stroke: allDone ? DONE_GREEN : INACTIVE, strokeWidth: 1.5 },
      markerEnd: { type: MT.ArrowClosed },
    });

    // Remove direct rw→val edge when workers exist
    const rwValIdx = edges.findIndex((e) => e.id === "e-rw-val");
    if (rwValIdx >= 0) edges.splice(rwValIdx, 1);
  }

  return { nodes, edges };
};

export default function WorkflowGraph(): preact.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let frameId: number | null = null;
    // deno-lint-ignore no-explicit-any
    let reactRoot: any;
    let unsubscribe: (() => void) | undefined;

    (async (): Promise<void> => {
      // Load real React + React Flow from esm.sh.
      const [React, ReactDOMClient, rfMod] = await Promise.all([
        import(/* @vite-ignore */ "https://esm.sh/react@19"),
        import(/* @vite-ignore */ "https://esm.sh/react-dom@19/client"),
        import(
          /* @vite-ignore */ "https://esm.sh/@xyflow/react@12?external=react,react-dom"
        ),
      ]);
      if (disposed) return;

      const rf: RF = rfMod;
      // deno-lint-ignore no-non-null-assertion
      reactRoot = ReactDOMClient.createRoot(containerRef.current!);

      // Re-fit viewport whenever the node count changes (e.g. workers appear).
      // Must be a child of <ReactFlow> so useReactFlow() has context.
      // deno-lint-ignore no-explicit-any
      const FitViewOnChange = (props: any): null => {
        const { fitView } = rf.useReactFlow();
        React.useEffect(() => {
          const id = setTimeout(() => fitView({ padding: 0.2 }), 50);
          return () => clearTimeout(id);
        }, [props.nodeCount, fitView]);
        return null;
      };

      const render = (): void => {
        if (!getHydrated()) {
          reactRoot.render(
            React.createElement(
              "div",
              {
                style: {
                  display: "grid",
                  placeItems: "center",
                  height: "100%",
                  color: MUTED,
                  fontFamily: "'Cascadia Code','SF Mono','Fira Code',monospace",
                  fontSize: 13,
                },
              },
              "Loading workflow...",
            ),
          );
          return;
        }
        const as = getOrchestratorState();
        const workers = getActiveWorkers();
        const { nodes, edges } = buildGraph(as, workers, rf);

        // deno-lint-ignore no-explicit-any
        const onNodeClick = (_event: any, node: any): void => {
          if (node.data?.workerIndex !== undefined) {
            setSelectedWorker({
              workerIndex: node.data.workerIndex,
              scenario: node.data.scenario,
            });
          } else if (node.data?.phase === "merge") {
            setSelectedWorker({
              workerIndex: -1,
              scenario: "__merge__",
              phase: "merge",
            });
          } else if (node.data?.phase === "validate") {
            setSelectedWorker({
              workerIndex: -2,
              scenario: "__validate__",
              phase: "validate",
            });
          } else if (node.data?.phase === "rectify") {
            setSelectedWorker({
              workerIndex: -3,
              scenario: "__rectify__",
              phase: "rectify",
            });
          }
        };

        reactRoot.render(
          React.createElement(
            rf.ReactFlow,
            {
              nodes,
              edges,
              onNodeClick,
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
            React.createElement(FitViewOnChange, {
              nodeCount: nodes.length,
            }),
            React.createElement(rf.Background, {
              color: "#e4e4e7",
              gap: 20,
              size: 1,
            }),
            React.createElement(rf.Controls, { showInteractive: false }),
          ),
        );
      };

      const queueRender = (): void => {
        if (frameId !== null) return;
        frameId = globalThis.requestAnimationFrame(() => {
          frameId = null;
          if (!disposed) render();
        });
      };

      render();
      unsubscribe = subscribe(queueRender, ["graph", "hydration"]);
    })();

    return (): void => {
      disposed = true;
      unsubscribe?.();
      if (frameId !== null) globalThis.cancelAnimationFrame(frameId);
      reactRoot?.unmount();
    };
  }, []);

  return (
    <div
      id="graph-root"
      ref={containerRef}
      style={{ position: "absolute", inset: 0, background: BG }}
    />
  );
}
