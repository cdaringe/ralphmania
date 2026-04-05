/**
 * ARCH.2a — Domain-specific folder organization.
 *
 * Verifies that topic-specific source files are nested under domain-specific
 * subdirectories, reducing filesystem noise at the src/ root.
 *
 * @module
 */

import { assert } from "jsr:@std/assert@^1.0.11";

const srcDir = new URL("../src/", import.meta.url).pathname;

const filesIn = (dir: string): string[] =>
  [...Deno.readDirSync(dir)]
    .filter((e) => e.isFile)
    .map((e) => e.name)
    .sort();

const subdirsIn = (dir: string): string[] =>
  [...Deno.readDirSync(dir)]
    .filter((e) => e.isDirectory)
    .map((e) => e.name)
    .sort();

Deno.test("ARCH.2a: src/machines/ contains all state machine files", () => {
  const files = filesIn(`${srcDir}machines`);
  assert(files.includes("state-machine.ts"), "orchestrator state machine");
  assert(files.includes("worker-machine.ts"), "worker state machine");
  assert(files.includes("scenario-machine.ts"), "scenario lifecycle machine");
});

Deno.test("ARCH.2a: src/git/ contains all git operation files", () => {
  const files = filesIn(`${srcDir}git`);
  assert(files.includes("worktree.ts"), "worktree management");
  assert(files.includes("reconcile.ts"), "merge reconciliation");
});

Deno.test("ARCH.2a: src/parsers/ contains parser files", () => {
  const files = filesIn(`${srcDir}parsers`);
  assert(files.includes("progress-rows.ts"), "progress rows parser");
});

Deno.test("ARCH.2a: src/ has domain subdirectories reducing root noise", () => {
  const subdirs = subdirsIn(srcDir);
  assert(subdirs.includes("machines"), "machines/ domain folder exists");
  assert(subdirs.includes("git"), "git/ domain folder exists");
  assert(subdirs.includes("parsers"), "parsers/ domain folder exists");

  // Root file count should be well below the original 22 ungrouped files.
  // Five files were moved into subdirectories; root should now have ≤19.
  const rootFiles = filesIn(srcDir).filter((f) => f.endsWith(".ts"));
  assert(
    rootFiles.length <= 19,
    `src/ root should have ≤19 .ts files, has ${rootFiles.length}: ${
      rootFiles.join(", ")
    }`,
  );
});
