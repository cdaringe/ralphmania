/**
 * File-backed log directory for GUI streaming.
 *
 * All GUI events (orchestrator state, worker output) are written as
 * NDJSON lines to files in `.ralph/worker-logs/`. The SSE endpoint
 * tails these files to stream events to browser clients.
 *
 * @module
 */
import type { GuiEvent } from "./events.ts";

const LOG_DIR = ".ralph/worker-logs";
const ORCHESTRATOR_LOG = `${LOG_DIR}/orchestrator.log`;

/** Ensures the log directory exists and truncates all log files. */
export const initLogDir = async (): Promise<void> => {
  await Deno.mkdir(LOG_DIR, { recursive: true });
  // Truncate all existing log files on startup
  try {
    for await (const entry of Deno.readDir(LOG_DIR)) {
      if (entry.isFile && entry.name.endsWith(".log")) {
        const f = await Deno.open(`${LOG_DIR}/${entry.name}`, {
          create: true,
          truncate: true,
          write: true,
        });
        f.close();
      }
    }
  } catch {
    // Directory doesn't exist yet
  }
  // Ensure orchestrator log exists
  const f = await Deno.open(ORCHESTRATOR_LOG, {
    create: true,
    truncate: true,
    write: true,
  });
  f.close();
};

/** Append an NDJSON line to a log file. */
const appendLine = async (
  path: string,
  event: GuiEvent,
): Promise<void> => {
  const line = JSON.stringify(event) + "\n";
  await Deno.writeTextFile(path, line, { append: true });
};

/** Write an orchestrator event to the orchestrator log file. */
export const writeOrchestratorEvent = (event: GuiEvent): Promise<void> =>
  appendLine(ORCHESTRATOR_LOG, event);

/** Write a worker output line to its log file, keyed by scenario ID. */
export const writeWorkerLine = (
  workerId: string | number,
  event: GuiEvent,
): Promise<void> => appendLine(`${LOG_DIR}/worker-${workerId}.log`, event);

/** Truncate a worker log file (called when a new round starts). */
export const resetWorkerLog = async (
  workerId: string | number,
): Promise<void> => {
  const path = `${LOG_DIR}/worker-${workerId}.log`;
  const f = await Deno.open(path, {
    create: true,
    truncate: true,
    write: true,
  });
  f.close();
};

/**
 * Tail all log files in the log directory, calling `onEvent` for each
 * NDJSON line. Watches for new files appearing and starts tailing those
 * too. Returns a cleanup function.
 *
 * On start, reads all existing file contents (replay), then watches
 * for new data via `Deno.watchFs`.
 */
export const tailLogDir = async (
  onEvent: (event: GuiEvent) => void,
  signal: AbortSignal,
): Promise<void> => {
  // Track file read positions
  const positions = new Map<string, number>();

  const readNewLines = async (path: string): Promise<void> => {
    try {
      const content = await Deno.readTextFile(path);
      const pos = positions.get(path) ?? 0;
      if (content.length <= pos) return;
      const newContent = content.slice(pos);
      positions.set(path, content.length);
      for (const line of newContent.split("\n")) {
        if (line.length === 0) continue;
        try {
          onEvent(JSON.parse(line) as GuiEvent);
        } catch {
          // Malformed JSON line — skip
        }
      }
    } catch {
      // File doesn't exist yet or was deleted
    }
  };

  // Initial scan: read all existing files
  try {
    for await (const entry of Deno.readDir(LOG_DIR)) {
      if (entry.isFile && entry.name.endsWith(".log")) {
        await readNewLines(`${LOG_DIR}/${entry.name}`);
      }
    }
  } catch {
    // Directory doesn't exist yet
  }

  // Watch for file changes
  try {
    const watcher = Deno.watchFs(LOG_DIR);
    signal.addEventListener("abort", () => watcher.close(), { once: true });
    for await (const event of watcher) {
      if (signal.aborted) break;
      for (const path of event.paths) {
        if (path.endsWith(".log")) {
          await readNewLines(path);
        }
      }
    }
  } catch {
    // Watcher closed or directory gone
  }
};
