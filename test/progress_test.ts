import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.11";
import {
  DEFAULT_FILE_PATHS,
  ensureProgressFile,
  parseScenarioCount,
  parseScenarioIds,
} from "../src/progress.ts";
import type { ProgressFileDeps } from "../src/ports/types.ts";
import type { Logger } from "../src/types.ts";

const noop: Logger = () => {};

// ---------------------------------------------------------------------------
// [ARCH.1] In-memory ProgressFileDeps factory — no real filesystem
// ---------------------------------------------------------------------------

const makeMemFS = (
  initial: Record<string, string> = {},
): { files: Record<string, string>; io: ProgressFileDeps } => {
  const files: Record<string, string> = { ...initial };
  const io: ProgressFileDeps = {
    readTextFile: (p) =>
      p in files
        ? Promise.resolve(files[p])
        : Promise.reject(new Error(`no such file: ${p}`)),
    writeTextFile: (p, c) => {
      files[p] = c;
      return Promise.resolve();
    },
    stat: (p) =>
      p in files
        ? Promise.resolve(undefined)
        : Promise.reject(new Error(`no such file: ${p}`)),
  };
  return { files, io };
};

// [ARCH.1] Domain logic works with injected in-memory I/O (no Deno calls)

Deno.test("[ARCH.1] ensureProgressFile creates template via in-memory fs", async () => {
  const { files, io } = makeMemFS({
    "spec.md": "| 1 | CLI | foo |\n| 2 | UX | bar |",
  });
  await ensureProgressFile(noop, {
    specFile: "spec.md",
    progressFile: "progress.md",
  }, io);
  assertStringIncludes(files["progress.md"], "| 1 ");
  assertStringIncludes(files["progress.md"], "| 2 ");
});

Deno.test("[ARCH.1] ensureProgressFile syncs new rows via in-memory fs", async () => {
  const { files, io } = makeMemFS({
    "spec.md": "| 1 | CLI | foo |\n| 2 | UX | bar |",
    "progress.md": "<!-- END_DEMO -->\n# Progress\n| 1 | VERIFIED | done | |\n",
  });
  await ensureProgressFile(noop, {
    specFile: "spec.md",
    progressFile: "progress.md",
  }, io);
  assertStringIncludes(files["progress.md"], "| 2 ");
});

Deno.test("[ARCH.1] ensureProgressFile no-ops when spec has equal rows via in-memory fs", async () => {
  const { files, io } = makeMemFS({
    "spec.md": "| 1 | CLI | foo |",
    "progress.md": "<!-- END_DEMO -->\n| 1 | VERIFIED | done | |\n",
  });
  const before = files["progress.md"];
  await ensureProgressFile(noop, {
    specFile: "spec.md",
    progressFile: "progress.md",
  }, io);
  assertEquals(files["progress.md"], before);
});

Deno.test("[ARCH.1] ensureProgressFile defaults to 10 rows with missing spec via in-memory fs", async () => {
  const { files, io } = makeMemFS({});
  await ensureProgressFile(noop, {
    specFile: "missing.md",
    progressFile: "progress.md",
  }, io);
  assertStringIncludes(files["progress.md"], "| 10");
});

Deno.test("parseScenarioCount counts data rows in scenario table", () => {
  const content = [
    "| # | Category | Description |",
    "| - | -------- | ----------- |",
    "| 1 | CLI | some desc |",
    "| 2 | Loop | another desc |",
    "| 3 | UX | third desc |",
  ].join("\n");
  assertEquals(parseScenarioCount(content), 3);
});

Deno.test("parseScenarioCount returns 0 for empty content", () => {
  assertEquals(parseScenarioCount(""), 0);
});

Deno.test("parseScenarioCount returns 0 when parseProgressRows errors", () => {
  // A row with only one cell (no trailing pipe) triggers a parse error
  assertEquals(parseScenarioCount("| malformed-single-cell"), 0);
});

Deno.test("parseScenarioCount ignores header rows", () => {
  const content = [
    "| # | Category |",
    "| - | -------- |",
  ].join("\n");
  assertEquals(parseScenarioCount(content), 0);
});

Deno.test("parseScenarioCount handles multi-digit scenario numbers", () => {
  const content = [
    "| 1  | CLI | desc |",
    "| 10 | UX  | desc |",
    "| 20 | UX  | desc |",
  ].join("\n");
  assertEquals(parseScenarioCount(content), 3);
});

Deno.test("parseScenarioIds extracts scenario ids from table", () => {
  const content = [
    "| 1  | CLI | some desc |",
    "| 2  | UX  | another   |",
    "| 3a | UX  | lettered  |",
  ].join("\n");
  assertEquals(parseScenarioIds(content), ["1", "2", "3a"]);
});

Deno.test("parseScenarioIds returns empty array when parseProgressRows errors", () => {
  // A row with only one cell (no trailing pipe) triggers a parse error
  assertEquals(parseScenarioIds("| malformed-single-cell"), []);
});

Deno.test("DEFAULT_FILE_PATHS has expected defaults", () => {
  assertEquals(DEFAULT_FILE_PATHS.specFile, "specification.md");
  assertEquals(DEFAULT_FILE_PATHS.progressFile, "progress.md");
});

Deno.test("ensureProgressFile creates 10 rows when spec file missing", async () => {
  const dir = await Deno.makeTempDir();
  const specFile = `${dir}/nonexistent-spec.md`;
  const progressFile = `${dir}/progress.md`;
  await ensureProgressFile(noop, { specFile, progressFile });
  const content = await Deno.readTextFile(progressFile);
  assertStringIncludes(content, "| 10");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("ensureProgressFile sync no-ops when spec missing and progress exists", async () => {
  const dir = await Deno.makeTempDir();
  const specFile = `${dir}/nonexistent.md`;
  const progressFile = `${dir}/progress.md`;
  await Deno.writeTextFile(progressFile, "<!-- END_DEMO -->\n| 1 | WIP | |\n");
  const before = await Deno.readTextFile(progressFile);
  await ensureProgressFile(noop, { specFile, progressFile });
  const after = await Deno.readTextFile(progressFile);
  assertEquals(before, after);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("ensureProgressFile sync no-ops when spec has equal rows", async () => {
  const dir = await Deno.makeTempDir();
  const specFile = `${dir}/spec.md`;
  const progressFile = `${dir}/progress.md`;
  await Deno.writeTextFile(specFile, "| 1 | CLI | foo |\n");
  await Deno.writeTextFile(
    progressFile,
    "<!-- END_DEMO -->\n| 1 | VERIFIED | done | |\n",
  );
  const before = await Deno.readTextFile(progressFile);
  await ensureProgressFile(noop, { specFile, progressFile });
  const after = await Deno.readTextFile(progressFile);
  assertEquals(before, after);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("ensureProgressFile creates progress at custom path from custom specFile", async () => {
  const dir = await Deno.makeTempDir();
  const specFile = `${dir}/my-spec.md`;
  const progressFile = `${dir}/my-progress.md`;

  // Write a minimal spec with 2 scenarios
  await Deno.writeTextFile(
    specFile,
    "| 1 | CLI | foo |\n| 2 | UX | bar |\n",
  );

  await ensureProgressFile(noop, { specFile, progressFile });

  const content = await Deno.readTextFile(progressFile);
  assertStringIncludes(content, "| 1 ");
  assertStringIncludes(content, "| 2 ");

  await Deno.remove(dir, { recursive: true });
});

Deno.test("ensureProgressFile defaults to 10 rows when spec is empty", async () => {
  const dir = await Deno.makeTempDir();
  const specFile = `${dir}/spec.md`;
  const progressFile = `${dir}/progress.md`;
  await Deno.writeTextFile(specFile, "no scenario table here");
  await ensureProgressFile(noop, { specFile, progressFile });
  const content = await Deno.readTextFile(progressFile);
  assertStringIncludes(content, "| 10");
  await Deno.remove(dir, { recursive: true });
});

Deno.test("ensureProgressFile does not append when spec has fewer rows than progress", async () => {
  const dir = await Deno.makeTempDir();
  const specFile = `${dir}/spec.md`;
  const progressFile = `${dir}/progress.md`;
  await Deno.writeTextFile(specFile, "| 1 | CLI | foo |\n");
  await Deno.writeTextFile(
    progressFile,
    "<!-- END_DEMO -->\n# Progress\n| 1 | VERIFIED | done | |\n| 2 | WIP | wip | |\n",
  );
  await ensureProgressFile(noop, { specFile, progressFile });
  const content = await Deno.readTextFile(progressFile);
  // Should not have added row 3
  assertEquals(content.includes("| 3 "), false);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("ensureProgressFile sync skips when spec has no scenarios", async () => {
  const dir = await Deno.makeTempDir();
  const specFile = `${dir}/spec.md`;
  const progressFile = `${dir}/progress.md`;
  await Deno.writeTextFile(specFile, "no table");
  await Deno.writeTextFile(progressFile, "<!-- END_DEMO -->\n| 1 | WIP | |\n");
  const before = await Deno.readTextFile(progressFile);
  await ensureProgressFile(noop, { specFile, progressFile });
  const after = await Deno.readTextFile(progressFile);
  assertEquals(before, after);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("[ARCH.1] ensureProgressFile syncs non-integer spec IDs via in-memory fs", async () => {
  const { files, io } = makeMemFS({
    "spec.md":
      "| ARCH.1 | Architecture | hex |\n| GUI.a | GUI | web |\n| 1 | CLI | foo |",
    "progress.md":
      "<!-- END_DEMO -->\n# Progress\n| # | Status | Summary | Rework Notes |\n| - | ------ | ------- | ------------ |\n| ARCH.1 | VERIFIED | done | |\n",
  });
  await ensureProgressFile(noop, {
    specFile: "spec.md",
    progressFile: "progress.md",
  }, io);
  assertStringIncludes(files["progress.md"], "| GUI.a");
  assertStringIncludes(files["progress.md"], "| 1 ");
  // Must NOT contain fabricated sequential IDs
  assertEquals(files["progress.md"].includes("| 2 "), false);
  assertEquals(files["progress.md"].includes("| 3 "), false);
});

Deno.test("[ARCH.1] generateProgressTemplate uses real spec IDs via in-memory fs", async () => {
  const { files, io } = makeMemFS({
    "spec.md": "| GUI.a | GUI | web |\n| CLI.1 | CLI | flag |",
  });
  await ensureProgressFile(noop, {
    specFile: "spec.md",
    progressFile: "progress.md",
  }, io);
  assertStringIncludes(files["progress.md"], "| GUI.a");
  assertStringIncludes(files["progress.md"], "| CLI.1");
  assertEquals(files["progress.md"].includes("| 1 "), false);
  assertEquals(files["progress.md"].includes("| 2 "), false);
});

Deno.test("ensureProgressFile appends new rows to custom progress path", async () => {
  const dir = await Deno.makeTempDir();
  const specFile = `${dir}/spec.md`;
  const progressFile = `${dir}/progress.md`;

  await Deno.writeTextFile(
    specFile,
    "| 1 | CLI | foo |\n| 2 | UX | bar |\n",
  );
  // Existing progress with only 1 row
  await Deno.writeTextFile(
    progressFile,
    "<!-- END_DEMO -->\n# Progress\n| 1 | VERIFIED | done | |\n",
  );

  await ensureProgressFile(noop, { specFile, progressFile });

  const content = await Deno.readTextFile(progressFile);
  assertStringIncludes(content, "| 2 ");

  await Deno.remove(dir, { recursive: true });
});
