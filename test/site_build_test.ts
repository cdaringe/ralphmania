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
  const cleanup = (): Promise<void> =>
    Deno.remove(outDir, { recursive: true });
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
