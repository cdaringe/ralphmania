/**
 * ARCH.1 — Hexagonal architecture structural validation.
 *
 * Verifies that pure domain modules do NOT make raw Deno API calls outside of
 * explicitly marked infrastructure-wiring blocks (`c8 ignore start/stop`).
 * Any Deno.* call found in non-wiring code means a domain module has leaked
 * across the port/adapter boundary.
 *
 * @module
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert@^1.0.11";
import { runParallelLoop } from "../src/orchestrator/mod.ts";
import { defaultProgressFileDeps } from "../src/ports/impl.ts";
import { ensureProgressFile } from "../src/progress.ts";
import { createProgressStore, integrationDeps, noopLog } from "./fixtures.ts";

// ---------------------------------------------------------------------------
// Helper: strip c8-ignored wiring blocks then scan for Deno.* usage
// ---------------------------------------------------------------------------

/**
 * Remove all `/* c8 ignore start ... * / ... /* c8 ignore stop * /` regions
 * so only the domain (non-wiring) code remains.
 */
const stripWiringBlocks = (src: string): string =>
  src.replace(
    /\/\* c8 ignore start[\s\S]*?\*\/([\s\S]*?)\/\* c8 ignore stop \*\//g,
    "",
  );

const hasRawDenoCalls = (src: string): boolean => /\bDeno\./.test(src);

const checkModule = async (relPath: string): Promise<void> => {
  const url = new URL(relPath, import.meta.url);
  const src = await Deno.readTextFile(url.pathname);
  const domain = stripWiringBlocks(src);
  assert(
    !hasRawDenoCalls(domain),
    `${relPath} contains raw Deno.* call(s) outside c8-ignored wiring block — violates hexagonal boundary`,
  );
};

// ---------------------------------------------------------------------------
// Pure domain modules — must have zero Deno.* calls anywhere
// ---------------------------------------------------------------------------

Deno.test("ARCH.1: src/machines/state-machine.ts has no raw Deno calls", () =>
  checkModule("../src/machines/state-machine.ts"));

Deno.test("ARCH.1: src/machines/worker-machine.ts has no raw Deno calls", () =>
  checkModule("../src/machines/worker-machine.ts"));

Deno.test("ARCH.1: src/machines/scenario-machine.ts has no raw Deno calls", () =>
  checkModule("../src/machines/scenario-machine.ts"));

Deno.test("ARCH.1: src/command.ts has no raw Deno calls", () =>
  checkModule("../src/command.ts"));

Deno.test("ARCH.1: src/exit.ts has no raw Deno calls", () =>
  checkModule("../src/exit.ts"));

Deno.test("ARCH.1: src/parsers/progress-rows.ts has no raw Deno calls", () =>
  checkModule("../src/parsers/progress-rows.ts"));

Deno.test("ARCH.1: src/set-fns.ts has no raw Deno calls", () =>
  checkModule("../src/set-fns.ts"));

// ---------------------------------------------------------------------------
// Adapter modules — Deno.* calls MUST be confined to c8-ignored wiring blocks
// ---------------------------------------------------------------------------

Deno.test("ARCH.1: src/model.ts Deno calls confined to c8-ignored wiring", () =>
  checkModule("../src/model.ts"));

Deno.test("ARCH.1: src/progress.ts Deno calls confined to c8-ignored wiring", () =>
  checkModule("../src/progress.ts"));

Deno.test("ARCH.1: src/orchestrator/mod.ts Deno calls confined to c8-ignored wiring", () =>
  checkModule("../src/orchestrator/mod.ts"));

// ---------------------------------------------------------------------------
// Port shape — verify MachineDeps has all required dep keys at runtime
// ---------------------------------------------------------------------------

Deno.test("ARCH.1: stubDeps satisfies MachineDeps port shape", async () => {
  const { stubDeps } = await import("./fixtures.ts");
  const deps = stubDeps();
  const required = [
    "readProgress",
    "createWorktree",
    "runIteration",
    "runValidation",
    "hasNewCommits",
    "mergeWorktree",
    "cleanupWorktree",
    "resetWorkingTree",
    "reconcileMerge",
    "readCheckpoint",
    "writeCheckpoint",
    "clearCheckpoint",
    "readEscalationState",
    "writeEscalationState",
    "selectScenarioBatch",
  ] as const;
  for (const key of required) {
    assert(
      typeof deps[key] === "function",
      `MachineDeps.${key} missing — port is incomplete`,
    );
  }
});

Deno.test("ARCH.1: ProgressFileDeps in-memory adapter runs ensureProgressFile without Deno", async () => {
  const { ensureProgressFile } = await import("../src/progress.ts");
  const files: Record<string, string> = {
    "spec.md": "| ARCH.1 | Architecture | hex arch |",
  };
  const io = {
    readTextFile: (p: string) =>
      p in files
        ? Promise.resolve(files[p])
        : Promise.reject(new Error(`not found: ${p}`)),
    writeTextFile: (p: string, c: string) => {
      files[p] = c;
      return Promise.resolve();
    },
    stat: (p: string) =>
      p in files
        ? Promise.resolve(undefined)
        : Promise.reject(new Error(`not found: ${p}`)),
  };
  const log = () => {};
  await ensureProgressFile(
    log,
    { specFile: "spec.md", progressFile: "out.md" },
    io,
  );
  assert("out.md" in files, "progress file written via in-memory adapter");
});

Deno.test("ARCH.1: contracts are centralized in src/ports/types.ts", async () => {
  const src = await Deno.readTextFile(
    new URL("../src/ports/types.ts", import.meta.url),
  );
  const expected = [
    "export type ProgressFileDeps",
    "export type ValidationHookDeps",
    "export type LoggerOutput",
    "export type ModelIODeps",
    "export type AgentRunDeps",
    "export type MachineDeps",
  ] as const;
  for (const token of expected) {
    assertStringIncludes(src, token);
  }
});

Deno.test("ARCH.1: ports/types is pure contracts; ports/impl contains Deno adapters", async () => {
  const typesSrc = await Deno.readTextFile(
    new URL("../src/ports/types.ts", import.meta.url),
  );
  const implSrc = await Deno.readTextFile(
    new URL("../src/ports/impl.ts", import.meta.url),
  );

  assertEquals(/\bDeno\./.test(typesSrc), false);
  assert(/\bDeno\./.test(implSrc), "Expected Deno adapters in ports/impl.ts");
  for (
    const name of [
      "defaultLoggerOutput",
      "defaultModelIODeps",
      "defaultProgressFileDeps",
      "defaultValidationHookDeps",
    ] as const
  ) {
    assertStringIncludes(implSrc, `export const ${name}`);
  }
});

Deno.test("ARCH.1: port type declarations are not duplicated in domain modules", async () => {
  const files = [
    "../src/logger.ts",
    "../src/model.ts",
    "../src/progress.ts",
    "../src/validation.ts",
    "../src/machines/state-machine.ts",
    "../src/machines/worker-machine.ts",
  ] as const;
  const pattern =
    /export type (ProgressFileDeps|ValidationHookDeps|LoggerOutput|ModelIODeps|AgentRunDeps|MachineDeps)\s*=/;
  for (const relPath of files) {
    const src = await Deno.readTextFile(new URL(relPath, import.meta.url));
    assert(
      !pattern.test(src),
      `${relPath} still declares a port contract inline`,
    );
  }
});

Deno.test("ARCH.1 [integration]: orchestrator runs against injected MachineDeps end-to-end", async () => {
  const progress = createProgressStore("| ARCH.1 |          |      |");
  let iterations = 0;

  const iterationsUsed = await runParallelLoop({
    agent: "claude",
    iterations: 3,
    parallelism: 1,
    expectedScenarioIds: ["ARCH.1"],
    signal: AbortSignal.timeout(10_000),
    log: noopLog,
    plugin: {},
    level: undefined,
    deps: integrationDeps({
      progress,
      onIteration: ({ progress }) => {
        iterations++;
        progress.set("| ARCH.1 | VERIFIED | done |");
      },
    }),
  });

  assertEquals(iterationsUsed, 1);
  assertEquals(iterations, 1);
  assertEquals(progress.get().includes("VERIFIED"), true);
});

Deno.test("ARCH.1 [e2e]: default Deno port adapter round-trips real filesystem I/O", async () => {
  const dir = await Deno.makeTempDir({ prefix: "arch1-ports-" });
  try {
    const specFile = `${dir}/spec.md`;
    const progressFile = `${dir}/progress.md`;
    await defaultProgressFileDeps.writeTextFile(
      specFile,
      "| ARCH.1 | Architecture | hexagonal architecture |\n",
    );

    await ensureProgressFile(noopLog, { specFile, progressFile });
    const content = await defaultProgressFileDeps.readTextFile(progressFile);

    assertStringIncludes(content, "| ARCH.1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
