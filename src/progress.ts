import type { Logger } from "./types.ts";

const PROGRESS_FILE = "progress.md";
const SPEC_FILE = "specification.md";

/** Parse scenario count by counting data rows in the scenario table. */
export const parseScenarioCount = (specContent: string): number =>
  specContent.split("\n").filter((line) => /^\|\s*\d+\s*\|/.test(line)).length;

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

const writeProgressTemplate = async (log: Logger): Promise<void> => {
  const specContent = await Deno.readTextFile(SPEC_FILE).catch(() => "");
  const count = parseScenarioCount(specContent) || 10;
  await Deno.writeTextFile(PROGRESS_FILE, generateProgressTemplate(count));
  log({
    tags: ["info", "progress"],
    message:
      `Created ${PROGRESS_FILE} with ${count} scenario rows — fill it in as you implement scenarios.`,
  });
};

const syncProgressWithSpec = async (log: Logger): Promise<void> => {
  const specContent = await Deno.readTextFile(SPEC_FILE).catch(() => "");
  const specCount = parseScenarioCount(specContent);
  if (specCount === 0) return;

  const progressContent = await Deno.readTextFile(PROGRESS_FILE).catch(
    () => "",
  );
  const progressCount = parseScenarioCount(progressContent);

  if (specCount > progressCount) {
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
      PROGRESS_FILE,
      progressContent.trimEnd() + "\n" + newRows + "\n",
    );
    log({
      tags: ["info", "progress"],
      message: `Appended ${
        specCount - progressCount
      } new scenario(s) to ${PROGRESS_FILE}`,
    });
  }
};

/**
 * Ensure `progress.md` exists and covers all specification scenarios.
 * On first boot (file absent), generate from specification.md.
 * When the spec adds new scenarios, append empty rows.
 */
export const ensureProgressFile = async (log: Logger): Promise<void> => {
  try {
    await Deno.stat(PROGRESS_FILE);
    await syncProgressWithSpec(log);
  } catch {
    await writeProgressTemplate(log);
  }
};
