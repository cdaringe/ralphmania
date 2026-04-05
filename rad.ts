import type { Task, Tasks } from "https://deno.land/x/rad@v8.0.3/src/mod.ts";

const TEST_PERMS =
  "--allow-read --allow-write --allow-run --allow-env --allow-net";
const TEST_CMD = `deno test ${TEST_PERMS}`;
const COVERAGE_DIR = "coverage/";

const shellTask = (cmd: string): Task => ({
  fn: ({ sh }) => sh(cmd),
});

const siteBuild = shellTask("deno run -A site/build.ts");
const testUnit = shellTask(
  `${TEST_CMD} --ignore=test/*_integration_test.ts src/ test/`,
);
const testIntegration = shellTask(
  `${TEST_CMD} test/*_integration_test.ts`,
);
const test: Task = {
  dependsOn: [testUnit, testIntegration],
};

const testCoverage = shellTask(
  `${TEST_CMD} --clean --coverage=${COVERAGE_DIR} && deno coverage ${COVERAGE_DIR}`,
);
const testCoverageHtml = shellTask(
  `${TEST_CMD} --clean --coverage=${COVERAGE_DIR} && deno coverage --html ${COVERAGE_DIR}`,
);
const testCoverageEnforce = shellTask(
  `${TEST_CMD} --clean --coverage=${COVERAGE_DIR} && bash -c 'deno coverage ${COVERAGE_DIR} 2>&1 | deno run --allow-read scripts/check-coverage.ts'`,
);
const fmt = shellTask("deno fmt");
const check = shellTask("deno check mod.ts");
const genGuiManifest = shellTask(
  "deno run --allow-read --allow-write scripts/gen-gui-manifest.ts",
);
const ralph = shellTask(
  "deno run -A mod.ts --iterations 30 --plugin plugin.ralph.ts",
);
const ralphDebug = shellTask(
  "deno run --inspect-brk -A mod.ts --iterations 30 --agent claude --plugin plugin.ralph.ts",
);
const yeetBump = shellTask(
  "deno eval \"const f='deno.json';const j=JSON.parse(Deno.readTextFileSync(f));const[a,b,c]=j.version.split('.').map(Number);j.version=[a,b+1,0].join('.');Deno.writeTextFileSync(f,JSON.stringify(j,null,2)+'\\n');console.log('Bumped to',j.version)\"",
);
const yeet: Task = {
  dependsOn: [yeetBump, genGuiManifest, fmt, testCoverage],
  dependsOnSerial: true,
  fn: ({ sh }) =>
    sh(
      "git add . || true && git commit -m 'chore: bump version' || true && gph || true && deno publish",
    ),
};

export const tasks: Tasks = {
  "site:build": siteBuild,
  sb: siteBuild,
  test,
  t: test,
  f: fmt,
  format: fmt,
  "test:unit": testUnit,
  "test:integration": testIntegration,
  "test:coverage": testCoverage,
  "test:coverage:html": testCoverageHtml,
  "test:coverage:enforce": testCoverageEnforce,
  fmt,
  check,
  "gen-gui-manifest": genGuiManifest,
  ralph,
  "ralph:debug": ralphDebug,
  "yeet:bump": yeetBump,
  yeet,
};
