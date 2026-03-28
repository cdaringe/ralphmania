/**
 * Parses `deno coverage` output and fails if any project source file
 * has line coverage below 100%.
 *
 * Usage: deno coverage coverage/ 2>&1 | deno run scripts/check-coverage.ts
 *
 * Files may be excluded from the 100% requirement by adding a comment
 * `// coverage:ignore — <justification>` at the top of the file AND
 * listing them in EXCLUDED_FILES below with the same justification.
 */

const EXCLUDED_FILES: ReadonlyMap<string, string> = new Map([
  // CLI entry point — requires spawning the full process with real args
  [
    "src/cli.ts",
    "CLI entry point with process-level orchestration and interactive prompts",
  ],
  // Serve uses Deno.serve and opens browser — requires network and OS interaction
  [
    "src/serve.ts",
    "Network server and OS browser-open requiring system integration",
  ],
  // Colors uses module-level TTY detection; branch coverage requires TTY control
  [
    "src/colors.ts",
    "Module-level Deno.stdout.isTerminal() prevents branch coverage in CI",
  ],
  // set-fns is a vendored utility library — user has explicitly marked it DO NOT CHANGE
  [
    "src/set-fns.ts",
    "Vendored set-theory utility; user marked DO NOT CHANGE; unused exports have no coverage",
  ],
  // GUI server uses Deno.serve — requires network and system integration
  [
    "src/gui/server.ts",
    "Network server requiring system integration",
  ],
  // GUI HTML is a static string export — no executable logic to cover
  [
    "src/gui/html.ts",
    "Static HTML/JS UI content; no executable logic to test",
  ],
]);

const input = await new Response(Deno.stdin.readable).text();
const lines = input.split("\n");

// Parse coverage table: | path | branch% | line% |
const filePattern =
  /\|\s*\S+\/src\/([^\s|]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/;
const failures: { file: string; line: number; branch: number }[] = [];

for (const line of lines) {
  const match = line.match(filePattern);
  if (!match) continue;
  const file = `src/${match[1]}`;
  const branch = parseFloat(match[2]);
  const lineCov = parseFloat(match[3]);

  if (EXCLUDED_FILES.has(file)) continue;
  if (lineCov < 100 || branch < 100) {
    failures.push({ file, line: lineCov, branch });
  }
}

if (failures.length > 0) {
  console.error("Coverage enforcement failed — 100% required:\n");
  for (const f of failures) {
    console.error(`  ${f.file}: line=${f.line}% branch=${f.branch}%`);
  }
  console.error(
    "\nTo exclude a file, add `// coverage:ignore — <reason>` at the top",
  );
  console.error("and list it in scripts/check-coverage.ts EXCLUDED_FILES.\n");
  Deno.exit(1);
}

console.log(
  "Coverage check passed: all files at 100% (or excluded with justification).",
);
