// coverage:ignore — Defensive .catch branches for file I/O unreachable in test environment
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

const generateProgressTemplate = (scenarioCount: number): string => {
  const rows = Array.from(
    { length: scenarioCount },
    (_, i) =>
      `| ${
        String(i + 1).padEnd(2)
      } |          |                                                                                                        |              |`,
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

const writeProgressTemplate = async (
  log: Logger,
  paths: FilePaths,
): Promise<void> => {
  const specContent = await Deno.readTextFile(paths.specFile).catch(() => "");
  const count = parseScenarioCount(specContent) || 10;
  await Deno.writeTextFile(paths.progressFile, generateProgressTemplate(count));
  log({
    tags: ["info", "progress"],
    message:
      `Created ${paths.progressFile} with ${count} scenario rows — fill it in as you implement scenarios.`,
  });
};

const syncProgressWithSpec = async (
  log: Logger,
  paths: FilePaths,
): Promise<void> => {
  const specContent = await Deno.readTextFile(paths.specFile).catch(() => "");
  const specCount = parseScenarioCount(specContent);
  if (specCount === 0) return;

  const progressContent = await Deno.readTextFile(paths.progressFile).catch(
    () => "",
  );
  const progressCount = parseScenarioCount(progressContent);

  if (specCount <= progressCount) return;

  const newRows = Array.from(
    { length: specCount - progressCount },
    (_, i) => {
      const num = progressCount + i + 1;
      return `| ${
        String(num).padEnd(2)
      } |          |                                                                                                        |              |`;
    },
  ).join("\n");
  await Deno.writeTextFile(
    paths.progressFile,
    progressContent.trimEnd() + "\n" + newRows + "\n",
  );
  log({
    tags: ["info", "progress"],
    message: `Appended ${
      specCount - progressCount
    } new scenario(s) to ${paths.progressFile}`,
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
): Promise<void> => {
  try {
    await Deno.stat(paths.progressFile);
    await syncProgressWithSpec(log, paths);
  } catch {
    await writeProgressTemplate(log, paths);
  }
};
