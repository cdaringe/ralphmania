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
const POLL_INTERVAL_MS = 200;

/** Well-known log IDs for merge and validation phase streams. */
export const MERGE_LOG_ID = "__merge__";
export const VALIDATE_LOG_ID = "__validate__";

/** Path to a worker's log file. */
const workerLogPath = (workerId: string): string =>
  `${LOG_DIR}/worker-${workerId}.log`;

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
  await Deno.mkdir(LOG_DIR, { recursive: true });
  await Deno.writeTextFile(path, line, { append: true });
};

/**
 * Serialized write queue for the orchestrator log. Events are appended
 * in order — each write waits for the previous to flush before starting.
 * This prevents concurrent `writeTextFile` calls from interleaving and
 * corrupting NDJSON lines.
 */
let orchestratorWriteChain: Promise<void> = Promise.resolve();

/** Write an orchestrator event to the orchestrator log file (serialized). */
export const writeOrchestratorEvent = (event: GuiEvent): Promise<void> => {
  orchestratorWriteChain = orchestratorWriteChain.then(() =>
    appendLine(ORCHESTRATOR_LOG, event)
  );
  return orchestratorWriteChain;
};

/**
 * Per-worker serialized write queues. Like the orchestrator write chain,
 * this ensures concurrent stdout/stderr pipeStream calls don't interleave
 * partial JSON lines into the same log file.
 */
const workerWriteChains = new Map<string | number, Promise<void>>();

/** Write a worker output line to its log file, keyed by scenario ID (serialized). */
export const writeWorkerLine = (
  workerId: string | number,
  event: GuiEvent,
): Promise<void> => {
  const prev = workerWriteChains.get(workerId) ?? Promise.resolve();
  const next = prev.then(() =>
    appendLine(`${LOG_DIR}/worker-${workerId}.log`, event)
  );
  workerWriteChains.set(workerId, next);
  return next;
};

/** Truncate a worker log file (called when a new round starts). */
export const resetWorkerLog = async (
  workerId: string | number,
): Promise<void> => {
  // Drain any pending writes before truncating.
  await (workerWriteChains.get(workerId) ?? Promise.resolve());
  workerWriteChains.delete(workerId);
  const path = `${LOG_DIR}/worker-${workerId}.log`;
  const f = await Deno.open(path, {
    create: true,
    truncate: true,
    write: true,
  });
  f.close();
};

const listLogFiles = async (): Promise<string[]> => {
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(LOG_DIR)) {
      if (entry.isFile && entry.name.endsWith(".log")) {
        files.push(`${LOG_DIR}/${entry.name}`);
      }
    }
  } catch {
    // Directory doesn't exist yet
  }
  return files.sort((a, b) => {
    if (a.endsWith("/orchestrator.log")) return -1;
    if (b.endsWith("/orchestrator.log")) return 1;
    return a.localeCompare(b);
  });
};

/**
 * Tail a single log file. Watches LOG_DIR for FS events but only reads the
 * specified file path. Initial-sync contract matches {@link tailLogDir}.
 *
 * @internal Shared implementation used by {@link tailOrchestratorLog} and
 * {@link tailWorkerLog}.
 */
const tailSingleFile = async (
  filePath: string,
  onEvent: (event: GuiEvent) => void,
  signal: AbortSignal,
  onSnapshotComplete?: () => void,
): Promise<void> => {
  // Honour a signal that was already aborted before the function was called.
  if (signal.aborted) return;

  let pos = 0;

  const readNewLines = async (): Promise<void> => {
    try {
      const content = await Deno.readTextFile(filePath);
      // Detect file truncation (e.g. resetWorkerLog between iterations).
      if (content.length < pos) pos = 0;
      if (content.length <= pos) return;
      const newContent = content.slice(pos);
      pos = content.length;
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

  // Start watcher before initial replay so no writes fall in the gap.
  let watcher: Deno.FsWatcher | undefined;
  try {
    await Deno.mkdir(LOG_DIR, { recursive: true });
    if (signal.aborted) return;
    watcher = Deno.watchFs(LOG_DIR);
    // Close watcher if the signal fires after it was created.
    if (signal.aborted) {
      watcher.close();
      return;
    }
    signal.addEventListener("abort", () => watcher?.close(), { once: true });
  } catch {
    watcher = undefined;
  }

  if (signal.aborted) return;

  // Polling safety net: catches any events the watcher may miss.
  const pollId = setInterval(() => {
    if (signal.aborted) return;
    readNewLines().catch(() => {});
  }, POLL_INTERVAL_MS);
  signal.addEventListener("abort", () => clearInterval(pollId), { once: true });

  // Initial replay.
  await readNewLines();
  onSnapshotComplete?.();

  if (signal.aborted) {
    clearInterval(pollId);
    return;
  }

  if (!watcher) {
    await new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    clearInterval(pollId);
    return;
  }

  // Resolve the canonical absolute path so we can compare against FS events.
  const canonical = filePath.startsWith("/")
    ? filePath
    : `${Deno.cwd()}/${filePath}`;

  try {
    for await (const fsEv of watcher) {
      if (signal.aborted) break;
      if (fsEv.paths.some((p) => p === canonical || p.endsWith(filePath))) {
        await readNewLines();
      }
    }
  } catch {
    // Watcher closed or directory gone
  } finally {
    clearInterval(pollId);
  }
};

/**
 * Tail only the orchestrator log (`.ralph/worker-logs/orchestrator.log`).
 *
 * The `/events` SSE endpoint uses this so that the default stream contains
 * only orchestrator-level events — worker logs are never sent until a client
 * explicitly subscribes via `/events/worker/:id`.
 */
export const tailOrchestratorLog = (
  onEvent: (event: GuiEvent) => void,
  signal: AbortSignal,
  onSnapshotComplete?: () => void,
): Promise<void> =>
  tailSingleFile(ORCHESTRATOR_LOG, onEvent, signal, onSnapshotComplete);

/**
 * Tail a single worker's log file on demand.
 *
 * Called only when a client opens a worker viewer (modal or dedicated page).
 * The connection is closed by aborting `signal` when the viewer closes,
 * preventing unnecessary I/O for idle worker logs.
 */
export const tailWorkerLog = (
  workerId: string,
  onEvent: (event: GuiEvent) => void,
  signal: AbortSignal,
  onSnapshotComplete?: () => void,
): Promise<void> =>
  tailSingleFile(workerLogPath(workerId), onEvent, signal, onSnapshotComplete);

/**
 * Tail all log files in the log directory, calling `onEvent` for each
 * NDJSON line. Watches for new files appearing and starts tailing those
 * too.
 *
 * Initial-sync contract:
 * 1. start `watchFs` first, so no writes can land in a replay/watch gap
 * 2. replay all existing log content in deterministic order
 * 3. call `onSnapshotComplete` once initial replay is fully drained
 * 4. continue streaming live updates from the watcher
 * @deprecated Use {@link tailOrchestratorLog} for the main SSE stream and
 * {@link tailWorkerLog} for per-worker streams (see GUI.g).
 */
export const tailLogDir = async (
  onEvent: (event: GuiEvent) => void,
  signal: AbortSignal,
  onSnapshotComplete?: () => void,
): Promise<void> => {
  // Track file read positions
  const positions = new Map<string, number>();

  const canonicalPath = (path: string): string =>
    path.startsWith("/") ? path : `${Deno.cwd()}/${path}`;

  const readAllLogs = async (): Promise<void> => {
    for (const path of await listLogFiles()) {
      await readNewLines(path);
    }
  };

  const readNewLines = async (path: string): Promise<void> => {
    const canonical = canonicalPath(path);
    try {
      const content = await Deno.readTextFile(path);
      let pos = positions.get(canonical) ?? 0;
      // Detect file truncation (e.g. resetWorkerLog between iterations).
      if (content.length < pos) pos = 0;
      if (content.length <= pos) return;
      const newContent = content.slice(pos);
      positions.set(canonical, content.length);
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

  // Start the watcher before replaying files so the client cannot miss
  // writes that happen during the initial sync window.
  let watcher: Deno.FsWatcher | undefined;
  try {
    await Deno.mkdir(LOG_DIR, { recursive: true });
    watcher = Deno.watchFs(LOG_DIR);
    signal.addEventListener("abort", () => watcher?.close(), { once: true });
  } catch {
    watcher = undefined;
  }

  // Polling safety net: even if the watcher drops an event, periodic
  // reads will eventually stream new lines to the client.
  const pollId = setInterval(() => {
    if (signal.aborted) return;
    readAllLogs().catch(() => {});
  }, POLL_INTERVAL_MS);
  signal.addEventListener("abort", () => clearInterval(pollId), { once: true });

  // Replay the authoritative current history first. `orchestrator.log`
  // is ordered ahead of worker logs so the client sees the latest global
  // orchestrator state before worker-local history.
  for (const path of await listLogFiles()) {
    await readNewLines(path);
  }
  // Signal that initial replay is complete; after this point the client
  // can safely render the hydrated GUI state.
  onSnapshotComplete?.();

  if (!watcher) {
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    clearInterval(pollId);
    return;
  }

  try {
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
  } finally {
    clearInterval(pollId);
  }
};
