/**
 * TUI orchestrator — wires the event bus, terminal I/O, and keyboard input
 * into a live bottom-of-screen status bar with worker stream filtering.
 *
 * The TUI is active when stdout is a TTY and the web GUI is not enabled.
 * It subscribes to the existing {@link GuiEventBus} (the same bus used by the
 * web GUI) to track orchestrator phase and active workers in real time.
 *
 * Architecture:
 *  - Pure state + rendering lives in {@link ./status-bar.ts}.
 *  - This module owns the I/O: stdout wrapping, stdin keyboard reading, and
 *    periodic progress polling.
 *  - All I/O is injected via {@link TuiIO} so the module is testable.
 *
 * @module
 */

import { ansi } from "@cliffy/ansi";
import type { LoggerOutput } from "../ports/types.ts";
import type { GuiEventBus } from "../gui/events.ts";
import {
  applyGuiEvent,
  initialTuiState,
  renderStatusBar,
  shouldShowLine,
  STATUS_BAR_LINES,
  withSelectedWorker,
  withVerifiedCount,
} from "./status-bar.ts";
import type { TuiState } from "./status-bar.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Injectable I/O boundary
// ─────────────────────────────────────────────────────────────────────────────

/** Injectable I/O dependencies — enables unit testing without real terminals. */
export type TuiIO = {
  /** Write bytes synchronously to stdout. */
  readonly writeSync: (data: Uint8Array) => void;
  /** Return the current terminal column count, or a safe default (80). */
  readonly consoleColumns: () => number;
  /** Enable/disable terminal raw mode for stdin. May be a no-op in tests. */
  readonly setRaw: (raw: boolean) => void;
  /** Read bytes from stdin. Returns null on EOF. */
  readonly readStdin: (buf: Uint8Array) => Promise<number | null>;
};

/* c8 ignore start — thin wrappers around Deno APIs, no testable logic */
/** Default production I/O bound to real Deno APIs. */
export const defaultTuiIO = (): TuiIO => ({
  writeSync: (data) => {
    Deno.stdout.writeSync(data);
  },
  consoleColumns: () => {
    try {
      return Deno.consoleSize().columns;
    } catch {
      return 80;
    }
  },
  setRaw: (raw) => {
    try {
      Deno.stdin.setRaw(raw);
    } catch { /* not a TTY or permission denied */ }
  },
  readStdin: (buf) => Deno.stdin.read(buf),
});
/* c8 ignore stop */

// ─────────────────────────────────────────────────────────────────────────────
// TUI controller
// ─────────────────────────────────────────────────────────────────────────────

/** Public interface returned by {@link createTui}. */
export type TuiController = {
  /**
   * A `LoggerOutput` that wraps writes with status-bar management:
   * erasing the bar before content lands and redrawing it after.
   * Wire this as the output for {@link createLogger}.
   */
  readonly loggerOutput: LoggerOutput;
  /**
   * Start reading stdin key-presses for worker filter control.
   * - Press `1`–`9` to focus on worker 0–8 respectively.
   * - Press `0` to show all workers.
   * Resolves when `signal` fires.
   */
  readonly startKeyboardHandler: () => Promise<void>;
  /** Update the "verified" count shown in the progress section. */
  readonly setVerified: (n: number) => void;
  /**
   * Erase the status bar and restore terminal state (raw mode off).
   * Call this in a `finally` block around the agentic loop.
   */
  readonly cleanup: () => void;
};

/**
 * Create a TUI controller that subscribes to `bus` and renders a
 * {@link STATUS_BAR_LINES}-line status bar at the bottom of the terminal.
 */
export const createTui = (opts: {
  readonly bus: GuiEventBus;
  readonly total: number;
  readonly signal: AbortSignal;
  readonly io?: TuiIO;
}): TuiController => {
  const io = opts.io ?? defaultTuiIO();
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  let state: TuiState = initialTuiState(opts.total);
  let statusBarDrawn = false;
  let rawModeActive = false;

  // ── Event bus subscription ──────────────────────────────────────────────
  const unsub = opts.bus.subscribe((event) => {
    state = applyGuiEvent(state, event);
  });
  opts.signal.addEventListener("abort", () => unsub(), { once: true });

  // ── ANSI helpers ────────────────────────────────────────────────────────

  /** Build the byte sequence that erases the current status bar. */
  const buildClearSeq = (): Uint8Array => {
    let seq = "";
    for (let i = 0; i < STATUS_BAR_LINES; i++) {
      seq += ansi.cursorUp(1).eraseLine.cursorLeft.toString();
    }
    return enc.encode(seq);
  };

  /** Render and write the status bar, ending with a position that allows
   *  subsequent log lines to scroll naturally above it. */
  const drawStatusBar = (): void => {
    const cols = io.consoleColumns();
    const rendered = renderStatusBar(state, cols);
    // Emit a blank line so the status bar is visually separated from
    // the last content line, then the bar itself (no trailing newline).
    io.writeSync(enc.encode("\n" + rendered));
    statusBarDrawn = true;
  };

  // ── Wrapped LoggerOutput ─────────────────────────────────────────────────

  /**
   * Write `data` to stdout, clearing the status bar first (if drawn) and
   * redrawing it afterward. Lines suppressed by the worker filter are
   * dropped entirely.
   */
  const writeWithBar = (data: Uint8Array): number => {
    const text = dec.decode(data);
    if (!shouldShowLine(text, state.selectedWorker)) {
      return data.length; // silently drop filtered content
    }

    // Build one atomic write: [clear bar?] + content + blank-then-bar
    const parts: Uint8Array[] = [];
    if (statusBarDrawn) {
      parts.push(buildClearSeq());
    }
    parts.push(data);

    let totalLen = 0;
    for (const p of parts) totalLen += p.length;
    const combined = new Uint8Array(totalLen);
    let off = 0;
    for (const p of parts) {
      combined.set(p, off);
      off += p.length;
    }
    io.writeSync(combined);

    drawStatusBar();
    return data.length;
  };

  const loggerOutput: LoggerOutput = {
    writeSync: writeWithBar,
    writeErrSync: writeWithBar,
  };

  // ── Keyboard handler ─────────────────────────────────────────────────────

  const startKeyboardHandler = async (): Promise<void> => {
    // Enable raw mode so we can read individual key-presses.
    io.setRaw(true);
    rawModeActive = true;

    const buf = new Uint8Array(4);
    while (!opts.signal.aborted) {
      let n: number | null;
      try {
        n = await io.readStdin(buf);
      } catch {
        break;
      }
      if (n === null) break;

      const key = dec.decode(buf.subarray(0, n));
      if (key >= "1" && key <= "9") {
        const workerIdx = parseInt(key, 10) - 1;
        state = withSelectedWorker(state, workerIdx);
        if (statusBarDrawn) {
          io.writeSync(buildClearSeq());
        }
        drawStatusBar();
      } else if (key === "0") {
        state = withSelectedWorker(state, null);
        if (statusBarDrawn) {
          io.writeSync(buildClearSeq());
        }
        drawStatusBar();
      }
    }

    if (rawModeActive) {
      io.setRaw(false);
      rawModeActive = false;
    }
  };

  // ── setVerified ──────────────────────────────────────────────────────────

  const setVerified = (n: number): void => {
    state = withVerifiedCount(state, n);
  };

  // ── cleanup ──────────────────────────────────────────────────────────────

  const cleanup = (): void => {
    unsub();
    if (statusBarDrawn) {
      io.writeSync(buildClearSeq());
      statusBarDrawn = false;
    }
    if (rawModeActive) {
      io.setRaw(false);
      rawModeActive = false;
    }
  };

  return { loggerOutput, startKeyboardHandler, setVerified, cleanup };
};
