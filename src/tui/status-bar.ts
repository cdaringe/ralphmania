/**
 * TUI status bar: pure state management and rendering.
 *
 * All functions are side-effect free — they only produce new values from old
 * ones. This makes the module fully unit-testable without I/O.
 *
 * @module
 */

import { bold, cyan, dim, green, magenta } from "../colors.ts";
import type { GuiEvent } from "../gui/events.ts";

/** Info about a single active worker. */
export type TuiWorkerInfo = {
  readonly scenario: string;
};

/** Current TUI display state. */
export type TuiState = {
  readonly phase: string;
  readonly workers: ReadonlyMap<number, TuiWorkerInfo>;
  readonly verified: number;
  readonly total: number;
  /** Null means "show all"; a number means filter to that worker index. */
  readonly selectedWorker: number | null;
};

/** Number of lines the status bar occupies (separator + phase line + worker line). */
export const STATUS_BAR_LINES = 3;

/** Produce the initial blank TUI state. */
export const initialTuiState = (total: number): TuiState => ({
  phase: "init",
  workers: new Map(),
  verified: 0,
  total,
  selectedWorker: null,
});

/**
 * Apply a single GuiEvent to produce an updated TuiState.
 * Only state/worker events affect the TUI; all others pass through unchanged.
 */
export const applyGuiEvent = (
  state: TuiState,
  event: GuiEvent,
): TuiState => {
  switch (event.type) {
    case "state":
      return { ...state, phase: event.to };
    case "worker_active": {
      const newWorkers = new Map(state.workers);
      newWorkers.set(event.workerIndex, { scenario: event.scenario });
      return { ...state, workers: newWorkers };
    }
    case "worker_done": {
      const newWorkers = new Map(state.workers);
      newWorkers.delete(event.workerIndex);
      return { ...state, workers: newWorkers };
    }
    default:
      return state;
  }
};

/** Return a copy of state with an updated `verified` count. */
export const withVerifiedCount = (
  state: TuiState,
  verified: number,
): TuiState => ({ ...state, verified });

/** Return a copy of state with the worker filter selection updated. */
export const withSelectedWorker = (
  state: TuiState,
  selectedWorker: number | null,
): TuiState => ({ ...state, selectedWorker });

/**
 * Render the status bar as a string.
 *
 * Returns exactly {@link STATUS_BAR_LINES} lines joined by `\n`
 * (no trailing newline).
 */
export const renderStatusBar = (state: TuiState, cols: number): string => {
  const width = Math.max(cols, 1);
  const sep = dim("─".repeat(width));

  // Line 2 — phase | workers | progress
  const phaseLabel = `${dim("Phase:")} ${magenta(state.phase)}`;
  const workerLabel = `${dim("Workers:")} ${bold(String(state.workers.size))}`;
  const progressLabel = `${dim("Progress:")} ${green(String(state.verified))}${
    dim("/")
  }${bold(String(state.total))} ${dim("verified")}`;
  const statusLine = ` ${phaseLabel}  ${dim("│")}  ${workerLabel}  ${
    dim("│")
  }  ${progressLabel}`;

  // Line 3 — worker list + keyboard hint
  const workerParts: string[] = [];
  for (const [idx, { scenario }] of state.workers) {
    const isSelected = state.selectedWorker === idx;
    const label = `[w${idx}/s${scenario}]`;
    workerParts.push(isSelected ? green(bold(label)) : cyan(label));
  }
  const workerList = workerParts.length > 0
    ? workerParts.join("  ")
    : dim("no active workers");
  const hint = state.selectedWorker !== null
    ? dim(`filter:w${state.selectedWorker} (0=all)`)
    : dim("0-9=filter worker");
  const workersLine = ` ${workerList}  ${dim("│")}  ${hint}`;

  return `${sep}\n${statusLine}\n${workersLine}`;
};

/**
 * Determine whether a line of stdout content should be shown given the
 * current worker filter.
 *
 * Rules:
 * - If `selectedWorker` is null, all lines pass (no filter active).
 * - Ralph logger lines (containing `[ralph:`) always pass regardless of filter.
 * - Lines matching the worker prefix pattern `[wN/s` pass only if N equals
 *   `selectedWorker`.
 * - Lines matching a *different* worker prefix are suppressed.
 * - All other lines (e.g. raw subprocess output without a prefix) pass.
 */
export const shouldShowLine = (
  line: string,
  selectedWorker: number | null,
): boolean => {
  if (selectedWorker === null) return true;

  // Strip ANSI escape codes for prefix matching.
  // deno-lint-ignore no-control-regex
  const plain = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

  // Ralph structured log lines always pass.
  if (plain.includes("[ralph:")) return true;

  // Worker-prefixed line: pass only if it belongs to the selected worker.
  const anyWorkerRe = /\[w(\d+)\/s/;
  const match = anyWorkerRe.exec(plain);
  if (match !== null) {
    return parseInt(match[1], 10) === selectedWorker;
  }

  // Non-prefixed content: pass through.
  return true;
};
