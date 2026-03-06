import type { Logger } from "./types.ts";

const PROGRESS_FILE = "progress.md";
const SPEC_FILE = "specification.md";

/** Parse scenario count from specification.md by counting data rows in the table. */
const parseScenarioCount = (specContent: string): number =>
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

/**
 * Ensure `progress.md` exists. On first boot (file absent), generate it from
 * the scenario count in `specification.md` and log a notice.
 */
export const ensureProgressFile = (log: Logger): Promise<void> =>
  Deno.stat(PROGRESS_FILE)
    .then(() => undefined, () => writeProgressTemplate(log));
