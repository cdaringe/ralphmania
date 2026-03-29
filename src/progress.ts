import type { Logger } from "./types.ts";
import { parseProgressRows } from "./parsers/progress-rows.ts";

const PROGRESS_FILE = "progress.md";
export const SPEC_FILE = "specification.md";

/** Parse scenario count by counting data rows in the scenario table. */
export const parseScenarioCount = (specContent: string): number => {
  const parsed = parseProgressRows(specContent);
  return parsed.isOk() ? parsed.value.length : 0;
};

/** Parse scenario IDs from the scenario table. */
export const parseScenarioIds = (specContent: string): string[] => {
  const parsed = parseProgressRows(specContent);
  return parsed.isOk() ? parsed.value.map((r) => r.scenario) : [];
};

const generateProgressTemplate = (scenarioIds: string[]): string => {
  const rows = scenarioIds.map((id) =>
    `| ${
      id.padEnd(2)
    } |          |                                                                                                        |              |`
  ).join("\n");
  return `<!-- END_DEMO -->

# Progress

| #  | Status   | Summary                                                                                                | Rework Notes |
| -- | -------- | ------------------------------------------------------------------------------------------------------ | ------------ |
${rows}
`;
};

export type FilePaths = {
  specFile: string;
  progressFile: string;
};

export const DEFAULT_FILE_PATHS: FilePaths = {
  specFile: SPEC_FILE,
  progressFile: PROGRESS_FILE,
};

/**
 * File I/O port for progress file operations.
 * Inject a custom implementation in tests to avoid real filesystem access
 * and keep domain logic portable (hexagonal architecture).
 */
export type ProgressFileDeps = {
  readonly readTextFile: (path: string) => Promise<string>;
  readonly writeTextFile: (path: string, content: string) => Promise<void>;
  /** Resolves if file exists, rejects if not. Return value is unused. */
  readonly stat: (path: string) => Promise<unknown>;
};

/* c8 ignore start — thin Deno I/O wiring */
const defaultProgressFileDeps: ProgressFileDeps = {
  readTextFile: (path) => Deno.readTextFile(path),
  writeTextFile: (path, content) => Deno.writeTextFile(path, content),
  stat: (path) => Deno.stat(path),
};
/* c8 ignore stop */

const writeProgressTemplate = async (
  log: Logger,
  paths: FilePaths,
  io: ProgressFileDeps,
): Promise<void> => {
  const specContent = await io.readTextFile(paths.specFile).catch(() => "");
  const ids = parseScenarioIds(specContent);
  const fallbackIds = ids.length > 0
    ? ids
    : Array.from({ length: 10 }, (_, i) => String(i + 1));
  await io.writeTextFile(
    paths.progressFile,
    generateProgressTemplate(fallbackIds),
  );
  log({
    tags: ["info", "progress"],
    message:
      `Created ${paths.progressFile} with ${fallbackIds.length} scenario rows — fill it in as you implement scenarios.`,
  });
};

const syncProgressWithSpec = async (
  log: Logger,
  paths: FilePaths,
  io: ProgressFileDeps,
): Promise<void> => {
  const specContent = await io.readTextFile(paths.specFile).catch(() => "");
  const specIds = parseScenarioIds(specContent);
  if (specIds.length === 0) return;

  const progressContent = await io.readTextFile(paths.progressFile).catch(
    () => "",
  );
  const progressIds = new Set(parseScenarioIds(progressContent));
  const missingIds = specIds.filter((id) => !progressIds.has(id));

  if (missingIds.length === 0) return;

  const newRows = missingIds.map((id) =>
    `| ${
      id.padEnd(2)
    } |          |                                                                                                        |              |`
  ).join("\n");
  await io.writeTextFile(
    paths.progressFile,
    progressContent.trimEnd() + "\n" + newRows + "\n",
  );
  log({
    tags: ["info", "progress"],
    message:
      `Appended ${missingIds.length} new scenario(s) to ${paths.progressFile}`,
  });
};

/**
 * Ensure `progress.md` (or a custom path) exists and covers all specification
 * scenarios. On first boot (file absent), generate from `specification.md`.
 * When the spec adds new scenarios, append empty rows.
 */
export const ensureProgressFile = async (
  log: Logger,
  paths: FilePaths = DEFAULT_FILE_PATHS,
  io: ProgressFileDeps = defaultProgressFileDeps,
): Promise<void> => {
  try {
    await io.stat(paths.progressFile);
    await syncProgressWithSpec(log, paths, io);
  } catch {
    await writeProgressTemplate(log, paths, io);
  }
};
