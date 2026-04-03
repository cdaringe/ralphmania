import { assertEquals, assertStringIncludes } from "jsr:@std/assert@^1.0.11";
import { buildSite } from "../site/build.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTempBuild = async (): Promise<{
  outDir: string;
  srcDir: string;
  cleanup: () => Promise<void>;
}> => {
  const outDir = await Deno.makeTempDir();
  const srcDir = new URL("../site/src", import.meta.url).pathname;
  const cleanup = (): Promise<void> => Deno.remove(outDir, { recursive: true });
  return { outDir, srcDir, cleanup };
};

// ---------------------------------------------------------------------------
// Output file existence
// ---------------------------------------------------------------------------

Deno.test("buildSite generates index.html", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const stat = await Deno.stat(`${outDir}/index.html`);
    assertEquals(stat.isFile, true);
  } finally {
    await cleanup();
  }
});

Deno.test("buildSite generates quickstart.html", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const stat = await Deno.stat(`${outDir}/quickstart.html`);
    assertEquals(stat.isFile, true);
  } finally {
    await cleanup();
  }
});

Deno.test("buildSite generates reference.html", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const stat = await Deno.stat(`${outDir}/reference.html`);
    assertEquals(stat.isFile, true);
  } finally {
    await cleanup();
  }
});

Deno.test("buildSite copies styles.css", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const stat = await Deno.stat(`${outDir}/styles.css`);
    assertEquals(stat.isFile, true);
  } finally {
    await cleanup();
  }
});

Deno.test("buildSite generates architecture.html", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const stat = await Deno.stat(`${outDir}/architecture.html`);
    assertEquals(stat.isFile, true);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// DOCTYPE and title checks
// ---------------------------------------------------------------------------

Deno.test("index.html starts with <!DOCTYPE html>", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/index.html`);
    assertEquals(html.startsWith("<!DOCTYPE html>"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("quickstart.html starts with <!DOCTYPE html>", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/quickstart.html`);
    assertEquals(html.startsWith("<!DOCTYPE html>"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("reference.html starts with <!DOCTYPE html>", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/reference.html`);
    assertEquals(html.startsWith("<!DOCTYPE html>"), true);
  } finally {
    await cleanup();
  }
});

Deno.test("architecture.html starts with <!DOCTYPE html>", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/architecture.html`);
    assertEquals(html.startsWith("<!DOCTYPE html>"), true);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Content checks — index.html
// ---------------------------------------------------------------------------

Deno.test("index.html contains site title", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/index.html`);
    assertStringIncludes(html, "ralphmania");
  } finally {
    await cleanup();
  }
});

Deno.test("index.html contains tagline", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/index.html`);
    assertStringIncludes(html, "spec-driven development");
  } finally {
    await cleanup();
  }
});

Deno.test("index.html contains install command", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/index.html`);
    assertStringIncludes(html, "jsr:@cdaringe/ralphmania");
  } finally {
    await cleanup();
  }
});

Deno.test("index.html contains feature cards", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/index.html`);
    assertStringIncludes(html, "Iterative");
    assertStringIncludes(html, "Validated");
    assertStringIncludes(html, "Escalating");
    assertStringIncludes(html, "Extensible");
  } finally {
    await cleanup();
  }
});

Deno.test("index.html contains nav links", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/index.html`);
    assertStringIncludes(html, "quickstart.html");
    assertStringIncludes(html, "reference.html");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Content checks — quickstart.html
// ---------------------------------------------------------------------------

Deno.test("quickstart.html contains installation section", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/quickstart.html`);
    assertStringIncludes(html, "Installation");
    assertStringIncludes(html, "deno run -A");
  } finally {
    await cleanup();
  }
});

Deno.test("quickstart.html contains specification example", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/quickstart.html`);
    assertStringIncludes(html, "specification.md");
  } finally {
    await cleanup();
  }
});

Deno.test("quickstart.html contains progress statuses", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/quickstart.html`);
    assertStringIncludes(html, "VERIFIED");
    assertStringIncludes(html, "NEEDS_REWORK");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Content checks — reference.html
// ---------------------------------------------------------------------------

Deno.test("reference.html contains CLI flags table", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/reference.html`);
    assertStringIncludes(html, "--agent");
    assertStringIncludes(html, "--iterations");
    assertStringIncludes(html, "--plugin");
    assertStringIncludes(html, "--reset-worktrees");
    assertStringIncludes(html, "--gui");
  } finally {
    await cleanup();
  }
});

Deno.test("reference.html contains plugin hooks table", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/reference.html`);
    assertStringIncludes(html, "onConfigResolved");
    assertStringIncludes(html, "onModelSelected");
    assertStringIncludes(html, "onPromptBuilt");
    assertStringIncludes(html, "onCommandBuilt");
    assertStringIncludes(html, "onIterationEnd");
    assertStringIncludes(html, "onValidationComplete");
    assertStringIncludes(html, "onLoopEnd");
  } finally {
    await cleanup();
  }
});

Deno.test("reference.html contains all progress statuses", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/reference.html`);
    assertStringIncludes(html, "WIP");
    assertStringIncludes(html, "WORK_COMPLETE");
    assertStringIncludes(html, "VERIFIED");
    assertStringIncludes(html, "NEEDS_REWORK");
    assertStringIncludes(html, "OBSOLETE");
  } finally {
    await cleanup();
  }
});

Deno.test("reference.html contains environment variables", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/reference.html`);
    assertStringIncludes(html, "ANTHROPIC_API_KEY");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Content checks — architecture.html
// ---------------------------------------------------------------------------

Deno.test("architecture.html contains system overview section", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/architecture.html`);
    assertStringIncludes(html, "System Overview");
    assertStringIncludes(html, "specification.md");
    assertStringIncludes(html, "Orchestrator Loop");
  } finally {
    await cleanup();
  }
});

Deno.test("architecture.html contains orchestrator workflow with state annotations", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/architecture.html`);
    assertStringIncludes(html, "Orchestrator Workflow");
    assertStringIncludes(html, "reading_progress");
    assertStringIncludes(html, "finding_actionable");
    assertStringIncludes(html, "running_workers");
    assertStringIncludes(html, "validating");
    assertStringIncludes(html, "checking_doneness");
    assertStringIncludes(html, "state change");
  } finally {
    await cleanup();
  }
});

Deno.test("architecture.html contains worker pipeline with state annotations", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/architecture.html`);
    assertStringIncludes(html, "Worker Pipeline");
    assertStringIncludes(html, "resolving_model");
    assertStringIncludes(html, "model_resolved");
    assertStringIncludes(html, "prompt_built");
    assertStringIncludes(html, "command_built");
    assertStringIncludes(html, "running_agent");
  } finally {
    await cleanup();
  }
});

Deno.test("architecture.html contains plugin lifecycle annotations", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/architecture.html`);
    assertStringIncludes(html, "Plugin Lifecycle");
    assertStringIncludes(html, "onConfigResolved");
    assertStringIncludes(html, "onModelSelected");
    assertStringIncludes(html, "onPromptBuilt");
    assertStringIncludes(html, "onCommandBuilt");
    assertStringIncludes(html, "onIterationEnd");
    assertStringIncludes(html, "onValidationComplete");
    assertStringIncludes(html, "onLoopEnd");
  } finally {
    await cleanup();
  }
});

Deno.test("architecture.html contains merge and reconcile section", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/architecture.html`);
    assertStringIncludes(html, "Merge");
    assertStringIncludes(html, "Reconcile");
    assertStringIncludes(html, "Merge Queue");
  } finally {
    await cleanup();
  }
});

Deno.test("architecture.html contains model escalation section", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/architecture.html`);
    assertStringIncludes(html, "Model Escalation");
    assertStringIncludes(html, "Sonnet");
    assertStringIncludes(html, "Opus");
    assertStringIncludes(html, "escalation.json");
  } finally {
    await cleanup();
  }
});

Deno.test("architecture.html contains scenario lifecycle section", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/architecture.html`);
    assertStringIncludes(html, "Scenario Lifecycle");
    assertStringIncludes(html, "UNIMPLEMENTED");
    assertStringIncludes(html, "WIP");
    assertStringIncludes(html, "WORK_COMPLETE");
    assertStringIncludes(html, "VERIFIED");
    assertStringIncludes(html, "NEEDS_REWORK");
    assertStringIncludes(html, "OBSOLETE");
  } finally {
    await cleanup();
  }
});

Deno.test("architecture.html contains file map section", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/architecture.html`);
    assertStringIncludes(html, "File Map");
    assertStringIncludes(html, "src/machines/");
    assertStringIncludes(html, "src/ports/");
    assertStringIncludes(html, "src/orchestrator/");
  } finally {
    await cleanup();
  }
});

Deno.test("architecture.html sidebar has all section links", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/architecture.html`);
    assertStringIncludes(html, "#overview");
    assertStringIncludes(html, "#orchestrator");
    assertStringIncludes(html, "#worker");
    assertStringIncludes(html, "#merge");
    assertStringIncludes(html, "#escalation");
    assertStringIncludes(html, "#scenario-lifecycle");
    assertStringIncludes(html, "#plugin-lifecycle");
    assertStringIncludes(html, "#file-map");
  } finally {
    await cleanup();
  }
});

Deno.test("architecture.html flow diagrams annotate state changes visually", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const html = await Deno.readTextFile(`${outDir}/architecture.html`);
    // Flow nodes with active class should be present (green-highlighted state nodes)
    assertStringIncludes(html, "flow-node--active");
    // Annotation badges should mark plugin hooks and state changes
    assertStringIncludes(html, "flow-annotation");
    // Flow arrows connect nodes
    assertStringIncludes(html, "flow-arrow");
  } finally {
    await cleanup();
  }
});

Deno.test("all nav bars include architecture link", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    for (
      const page of [
        "index.html",
        "quickstart.html",
        "reference.html",
        "architecture.html",
      ]
    ) {
      const html = await Deno.readTextFile(`${outDir}/${page}`);
      assertStringIncludes(
        html,
        "architecture.html",
        `${page} should link to architecture`,
      );
    }
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// CSS content check
// ---------------------------------------------------------------------------

Deno.test("styles.css contains accent color", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const css = await Deno.readTextFile(`${outDir}/styles.css`);
    assertStringIncludes(css, "#1da462");
  } finally {
    await cleanup();
  }
});

Deno.test("styles.css contains flow diagram styles", async () => {
  const { outDir, srcDir, cleanup } = await makeTempBuild();
  try {
    await buildSite({ outDir, srcDir });
    const css = await Deno.readTextFile(`${outDir}/styles.css`);
    assertStringIncludes(css, ".flow-diagram");
    assertStringIncludes(css, ".flow-node");
    assertStringIncludes(css, ".flow-node--active");
    assertStringIncludes(css, ".flow-annotation");
    assertStringIncludes(css, ".flow-arrow");
  } finally {
    await cleanup();
  }
});
