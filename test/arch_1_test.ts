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

import { assert } from "jsr:@std/assert@^1.0.11";

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

Deno.test("ARCH.1: src/orchestrator.ts Deno calls confined to c8-ignored wiring", () =>
  checkModule("../src/orchestrator.ts"));

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
  await ensureProgressFile(log, { specFile: "spec.md", progressFile: "out.md" }, io);
  assert("out.md" in files, "progress file written via in-memory adapter");
});
