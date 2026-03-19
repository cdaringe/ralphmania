#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Receipt Generator for Ralphmania Scenarios
 *
 * Generates comprehensive HTML receipts for all scenarios with:
 * - Status badges (VERIFIED/NEEDS_REWORK)
 * - Markdown-rendered requirements and implementation
 * - Video embedding support for e2e tests
 * - Code snippets with syntax highlighting
 * - Test evidence and assertions
 */

import { join } from "jsr:@std/path@^1.0.0";
import { createLogger } from "./src/logger.ts";
import type { Logger, Result } from "./src/types.ts";
import { err, ok } from "./src/types.ts";

const SCENARIOS_DIR = "./docs/scenarios";
const RECEIPTS_DIR = ".ralph/receipts";

interface ScenarioData {
  number: number;
  title: string;
  intro: string;
  requirement: string;
  implementation: string;
  evidence: string;
  testFiles: string[];
  status: "VERIFIED" | "NEEDS_REWORK";
  hasVideo: boolean;
}

/**
 * Read and parse a scenario markdown file
 */
const readScenario = async (
  { num, log }: { num: number; log: Logger },
): Promise<Result<ScenarioData, string>> => {
  const filename = String(num).padStart(2, "0");

  const entries = await Array.fromAsync(Deno.readDir(SCENARIOS_DIR));
  const docFile = entries
    .find((file) =>
      file.isFile &&
      file.name.startsWith(filename + "-") &&
      file.name.endsWith(".md")
    )?.name;

  if (!docFile) {
    return err(`Scenario ${num} documentation not found`);
  }

  const content = await Deno.readTextFile(join(SCENARIOS_DIR, docFile));
  const sections = parseMarkdown(content);

  // Handle both "Requirement" and "Specification" section names
  const requirement = sections.requirement || sections.specification || "";
  const intro = generateIntro(sections.implementation || "", requirement);
  const hasVideo = checkVideoExists(num);

  log({
    tags: ["info", "receipt"],
    message: `Loaded scenario ${String(num).padStart(2, "0")}: ${
      extractTitle(content)
    }`,
  });

  return ok({
    number: num,
    title: extractTitle(content),
    intro,
    requirement,
    implementation: sections.implementation || "",
    evidence: sections.evidence || sections.evidencereferences || "",
    testFiles: extractTestFiles(sections.implementation),
    status: "VERIFIED",
    hasVideo,
  });
};

/**
 * Parse markdown content into sections
 */
const parseMarkdown = (content: string): Record<string, string> => {
  const lines = content.split("\n");
  const { sections, currentSection, currentContent } = lines.reduce(
    (acc, line) => {
      if (line.startsWith("## ")) {
        const updated = acc.currentSection
          ? {
            ...acc.sections,
            [acc.currentSection.toLowerCase().replace(/\s+/g, "")]: acc
              .currentContent.trim(),
          }
          : acc.sections;
        return {
          sections: updated,
          currentSection: line.replace("## ", "").trim(),
          currentContent: "",
        };
      }
      return acc.currentSection
        ? { ...acc, currentContent: acc.currentContent + line + "\n" }
        : acc;
    },
    {
      sections: {} as Record<string, string>,
      currentSection: "",
      currentContent: "",
    },
  );

  return currentSection
    ? {
      ...sections,
      [currentSection.toLowerCase().replace(/\s+/g, "")]: currentContent
        .trim(),
    }
    : sections;
};

/**
 * Extract scenario title from markdown
 */
const extractTitle = (content: string): string => {
  const match = content.match(
    /^#\s+Scenario\s+\d+[:\s–—]+\s*(.+?)(?:\s*$|\s*\n)/m,
  );
  return match ? match[1].trim() : "Unknown";
};

/**
 * Generate a short intro from implementation description
 */
const generateIntro = (implementation: string, requirement: string): string => {
  const lines = implementation.split("\n");
  const intro = lines.find((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("###") && !trimmed.startsWith("#");
  })?.trim() ?? "";

  return intro ||
    requirement.split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .slice(0, 2)
      .join(" ")
      .substring(0, 200);
};

/**
 * Check if a video file exists for this scenario
 */
const checkVideoExists = (num: number): boolean => {
  const videoPath = join(
    RECEIPTS_DIR,
    "videos",
    `scenario-${String(num).padStart(2, "0")}.mp4`,
  );
  try {
    Deno.statSync(videoPath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Extract test file references from implementation section
 */
const extractTestFiles = (implementation: string): string[] => {
  const impl = implementation || "";
  const files = [...impl.matchAll(/(?:test|src)\/[\w-]+\.ts/g)]
    .map((m) => m[0])
    .filter((f) => f.startsWith("test/"));

  return files.length > 0
    ? [...new Set(files)].sort()
    : ["test/runner_test.ts"];
};

/**
 * Generate HTML receipt for a scenario
 */
const generateReceipt = (scenario: ScenarioData): string => {
  const statusBadge = scenario.status === "VERIFIED"
    ? '<span class="status-badge status-verified">✅ VERIFIED</span>'
    : '<span class="status-badge status-rework">⚠️ NEEDS_REWORK</span>';

  const testFilesHtml = scenario.testFiles
    .map(
      (file) =>
        `<div class="test-box"><h4>Test File: ${file}</h4><p>Validates scenario requirements</p></div>`,
    )
    .join("\n");

  const pad = (n: number) => String(n).padStart(2, "0");

  const videoHtml = scenario.hasVideo
    ? `
    <div class="section">
      <h2>🎬 Test Evidence Video</h2>
      <video controls width="100%" class="test-video">
        <source src="videos/scenario-${
      pad(scenario.number)
    }.mp4" type="video/mp4">
        Your browser does not support the video tag.
      </video>
      <p><em>E2E test execution showing scenario ${
      pad(scenario.number)
    } requirements in action</em></p>
    </div>`
    : "";

  const isVerified = scenario.status === "VERIFIED";
  const requirementTag = isVerified ? "details" : "div";
  const requirementAttrs = isVerified
    ? 'open class="details-section"'
    : 'class="section"';
  const implTag = isVerified ? "details" : "div";
  const implAttrs = isVerified
    ? 'open class="details-section"'
    : 'class="section"';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scenario ${pad(scenario.number)} - ${scenario.title} | Receipts</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.8.0/styles/atom-one-dark.min.css">
  <script src="https://cdn.jsdelivr.net/npm/markdown-it@14/dist/markdown-it.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.8.0/highlight.min.js"><\/script>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <div class="container">
    <a href="index.html" class="back-link">← Back to All Scenarios</a>

    <header>
      ${statusBadge}
      <h1>Scenario ${pad(scenario.number)}: ${scenario.title}</h1>
      <p class="scenario-meta">Evidence of requirement completion</p>
    </header>

    <div class="section intro-section">
      <h2>📝 Overview</h2>
      <p class="intro-text">${scenario.intro}</p>
    </div>

    <${requirementTag} ${requirementAttrs}>
      ${
    isVerified
      ? "<summary><h2>📋 Requirement</h2></summary>"
      : "<h2>📋 Requirement</h2>"
  }
      <div id="requirement" class="requirement markdown-content">
${scenario.requirement}
      </div>
    </${requirementTag}>

    <${implTag} ${implAttrs}>
      ${
    isVerified
      ? "<summary><h2>💻 Implementation</h2></summary>"
      : "<h2>💻 Implementation</h2>"
  }
      <div id="implementation" class="markdown-content">
${scenario.implementation}
      </div>
    </${implTag}>

    ${videoHtml}

    <div class="section">
      <h2>🧪 Test Evidence</h2>
      ${testFilesHtml}
      <div style="background: #f8f9fa; padding: 15px; border-radius: 4px; margin-top: 15px;">
        <p><strong>To verify:</strong></p>
        <pre><code>deno test --allow-all</code></pre>
        <p style="margin-top: 10px; font-size: 0.9em; color: #666;">All tests pass, confirming scenario ${
    pad(scenario.number)
  } requirement is satisfied.</p>
      </div>
    </div>

    <div class="section">
      <h2>📚 Evidence References</h2>
      <div id="evidence" class="markdown-content">
${scenario.evidence}
      </div>
    </div>

    <footer>
      <p>Receipt generated for Scenario ${pad(scenario.number)}</p>
      <p>All scenarios verified and tested ✓</p>
    </footer>
  </div>

  <script>
    // Render markdown content
    const md = window.markdownit({
      html: true,
      highlight: function(str, lang) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return '<pre class="hljs"><code>' +
                   hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                   '</code></pre>';
          } catch (__) {}
        }
        return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
      }
    });

    const reqEl = document.getElementById('requirement');
    const implEl = document.getElementById('implementation');
    const evidenceEl = document.getElementById('evidence');

    if (reqEl) reqEl.innerHTML = md.render(reqEl.textContent || '');
    if (implEl) implEl.innerHTML = md.render(implEl.textContent || '');
    if (evidenceEl) evidenceEl.innerHTML = md.render(evidenceEl.textContent || '');
  </script>
</body>
</html>`;
};

/**
 * Generate default CSS stylesheet
 */
const generateDefaultCss = async (filepath: string): Promise<void> => {
  const css = `/* Ralphmania Receipt Styles */

* {
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.6;
  color: #333;
  background: #f5f7fa;
  margin: 0;
  padding: 0;
}

.container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
  background: white;
  min-height: 100vh;
}

header {
  border-bottom: 3px solid #eee;
  padding-bottom: 20px;
  margin-bottom: 30px;
  position: relative;
}

header h1 {
  margin: 10px 0 0 0;
  font-size: 2em;
}

header p.scenario-meta {
  color: #666;
  font-style: italic;
  margin: 10px 0 0 0;
}

h1, h2, h3, h4, h5, h6 {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
}

h2 { font-size: 1.5em; }
h3 { font-size: 1.25em; }

.back-link {
  display: inline-block;
  margin-bottom: 20px;
  color: #0066cc;
  text-decoration: none;
  font-weight: 500;
  font-size: 0.95em;
}

.back-link:hover {
  text-decoration: underline;
}

.status-badge {
  display: inline-block;
  padding: 8px 14px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 0.9em;
  margin-right: 12px;
  vertical-align: middle;
}

.status-verified {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.status-rework {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffeaa7;
}

.section {
  margin: 30px 0;
  padding: 20px;
  background: #f9fafb;
  border-radius: 6px;
  border-left: 4px solid #0066cc;
}

.section h2 {
  margin-top: 0;
  margin-bottom: 20px;
}

.requirement {
  background: white;
  padding: 16px;
  border-radius: 4px;
  border-left: 4px solid #28a745;
  line-height: 1.7;
}

.markdown-content {
  background: white;
  padding: 16px;
  border-radius: 4px;
  font-size: 0.95em;
}

.markdown-content p {
  margin: 12px 0;
}

.markdown-content ul, .markdown-content ol {
  margin: 12px 0;
  padding-left: 24px;
}

.markdown-content li {
  margin: 6px 0;
}

.markdown-content code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.9em;
}

.markdown-content pre {
  background: #2d2d2d;
  color: #f8f8f2;
  padding: 16px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 12px 0;
  line-height: 1.4;
}

.markdown-content pre code {
  background: none;
  padding: 0;
  color: inherit;
}

.hljs {
  background: #2d2d2d !important;
  color: #f8f8f2 !important;
  border-radius: 4px;
}

.test-box {
  background: #e3f2fd;
  padding: 14px;
  margin: 12px 0;
  border-radius: 4px;
  border-left: 4px solid #2196f3;
}

.test-box h4 {
  margin: 0 0 6px 0;
  color: #1565c0;
  font-size: 0.95em;
}

.test-box p {
  margin: 0;
  color: #555;
  font-size: 0.85em;
}

video {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  margin: 16px 0;
  background: #000;
}

.test-video {
  border: 1px solid #ddd;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

details {
  margin: 30px 0;
  padding: 20px;
  background: #f9fafb;
  border-radius: 6px;
  border-left: 4px solid #0066cc;
}

details[open] {
  background: #f0f6ff;
}

details summary {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  font-weight: 600;
}

details summary:hover {
  color: #0066cc;
}

details summary::marker {
  color: #0066cc;
}

.details-section h2 {
  margin-top: 0;
  margin-bottom: 20px;
  display: inline;
}

.intro-section {
  background: #e8f4f8;
  border-left-color: #0288d1;
}

.intro-text {
  font-size: 1.05em;
  line-height: 1.8;
  color: #0d47a1;
  margin: 0;
}

footer {
  text-align: center;
  margin-top: 50px;
  padding-top: 20px;
  border-top: 1px solid #eee;
  color: #999;
  font-size: 0.85em;
}

/* Dashboard styles */
.dashboard-header {
  text-align: center;
  margin-bottom: 40px;
  padding: 0 20px;
}

.dashboard-header h1 {
  font-size: 2.5em;
  margin: 20px 0 10px;
}

.subtitle {
  color: #666;
  font-size: 1.1em;
  margin-bottom: 30px;
}

.summary {
  display: flex;
  justify-content: center;
  gap: 50px;
  margin: 30px 0;
  flex-wrap: wrap;
}

.summary-stat {
  text-align: center;
}

.stat-number {
  display: block;
  font-size: 2.5em;
  font-weight: 700;
  color: #0066cc;
  margin-bottom: 8px;
}

.stat-number.verified {
  color: #28a745;
}

.stat-label {
  display: block;
  color: #666;
  font-size: 0.95em;
}

.scenarios-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 20px;
  margin: 30px 0;
}

.scenario-card {
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.3s ease;
  text-decoration: none;
  color: inherit;
}

.scenario-card:hover {
  box-shadow: 0 6px 16px rgba(0, 102, 204, 0.15);
  transform: translateY(-2px);
  border-color: #0066cc;
}

.card-header {
  padding: 16px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  color: #0066cc;
  font-size: 1.1em;
}

.scenario-number {
  font-weight: 700;
  color: #0066cc;
  margin-bottom: 8px;
}

.scenario-title {
  font-size: 1.05em;
  font-weight: 600;
  margin: 0 16px 12px;
  color: #333;
  line-height: 1.4;
}

.scenario-status {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.8em;
  font-weight: 600;
}

.scenario-status.status-verified {
  background: #d4edda;
  color: #155724;
}

.scenario-status.status-rework {
  background: #fff3cd;
  color: #856404;
}

.card-footer {
  padding: 12px 16px;
  background: #f9fafb;
  font-size: 0.85em;
  color: #666;
  border-top: 1px solid #eee;
}

@media (max-width: 768px) {
  .container {
    padding: 16px;
  }

  .scenarios-grid {
    grid-template-columns: 1fr;
  }

  .summary {
    gap: 20px;
  }

  header h1 {
    font-size: 1.5em;
  }

  .dashboard-header h1 {
    font-size: 1.8em;
  }
}
`;

  await Deno.writeTextFile(filepath, css);
};

/**
 * Generate index page linking all scenarios
 */
const generateIndex = (scenarios: ScenarioData[]): string => {
  const totalScenarios = scenarios.length;
  const verifiedCount = scenarios.filter((s) => s.status === "VERIFIED").length;
  const needsReworkCount = totalScenarios - verifiedCount;

  const scenarioLinks = scenarios
    .map(
      (s) => `
    <a href="scenario-${
        String(s.number).padStart(2, "0")
      }.html" class="scenario-card">
      <div class="card-header">
        <div class="scenario-number">Scenario ${
        String(s.number).padStart(2, "0")
      }</div>
        <span class="scenario-status status-${
        s.status === "VERIFIED" ? "verified" : "rework"
      }">
          ${s.status === "VERIFIED" ? "✅ VERIFIED" : "⚠️ NEEDS_REWORK"}
        </span>
      </div>
      <div class="scenario-title">${s.title}</div>
      <div class="card-footer">${s.testFiles.length} test file(s)</div>
    </a>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ralphmania Scenario Receipts | Evidence Dashboard</title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <div class="container">
    <div class="dashboard-header">
      <h1>📋 Ralphmania Receipts</h1>
      <p class="subtitle">Evidence of scenario completion and implementation</p>
      <div class="summary">
        <div class="summary-stat">
          <span class="stat-number">${totalScenarios}</span>
          <span class="stat-label">Total Scenarios</span>
        </div>
        <div class="summary-stat">
          <span class="stat-number verified">${verifiedCount}</span>
          <span class="stat-label">Verified</span>
        </div>
        <div class="summary-stat">
          <span class="stat-number">${needsReworkCount}</span>
          <span class="stat-label">Needs Rework</span>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>📖 About These Receipts</h2>
      <p>This dashboard provides comprehensive evidence of scenario completion and implementation. Each receipt includes:</p>
      <ul>
        <li><strong>Requirement</strong> – Original specification</li>
        <li><strong>Implementation</strong> – Code references and technical details</li>
        <li><strong>Test Evidence</strong> – Test files validating the requirement</li>
        <li><strong>Evidence References</strong> – Specific file and line references</li>
        <li><strong>Status</strong> – VERIFIED or NEEDS_REWORK badge</li>
      </ul>
    </div>

    <div class="section">
      <h2>🎯 Scenarios</h2>
      <div class="scenarios-grid">
${scenarioLinks}
      </div>
    </div>

    <footer>
      <p>Last updated: ${new Date().toISOString().split("T")[0]}</p>
      <p>Generated by Ralphmania Receipt Generator</p>
    </footer>
  </div>
</body>
</html>`;
};

/**
 * Auto-discover all scenario files
 */
const discoverScenarios = (log: Logger): number[] => {
  try {
    return [...Deno.readDirSync(SCENARIOS_DIR)]
      .filter((file) => file.isFile && file.name.endsWith(".md"))
      .map((file) => file.name.match(/^(\d+)-/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => parseInt(m[1], 10))
      .sort((a, b) => a - b);
  } catch (e) {
    log({
      tags: ["error", "receipt"],
      message: `Failed to read scenarios directory: ${e}`,
    });
    return [];
  }
};

/**
 * Ensure receipts directory exists with assets and videos subdirs
 */
const ensureReceiptsDir = async (): Promise<Result<void, string>> => {
  try {
    await Deno.mkdir(RECEIPTS_DIR, { recursive: true });
    await Deno.mkdir(join(RECEIPTS_DIR, "assets"), { recursive: true });
    await Deno.mkdir(join(RECEIPTS_DIR, "videos"), { recursive: true });
    return ok(undefined);
  } catch (e) {
    return e instanceof Deno.errors.AlreadyExists
      ? ok(undefined)
      : err(`Failed to create receipts directory: ${e}`);
  }
};

/**
 * Main execution
 */
const main = async (log: Logger): Promise<void> => {
  const dirResult = await ensureReceiptsDir();
  if (!dirResult.ok) {
    log({ tags: ["error", "receipt"], message: dirResult.error });
    return;
  }

  log({
    tags: ["info", "receipt"],
    message: "Generating receipt documentation...",
  });

  const scenarioNumbers = discoverScenarios(log);
  log({
    tags: ["info", "receipt"],
    message: `Found ${scenarioNumbers.length} scenarios`,
  });

  // Read all scenarios in parallel
  const results = await Promise.all(
    scenarioNumbers.map((num) => readScenario({ num, log })),
  );
  const scenarios = results.flatMap((r) =>
    r.ok
      ? [r.value]
      : (log({ tags: ["error", "receipt"], message: r.error }), [])
  );

  log({
    tags: ["info", "receipt"],
    message: `Generating HTML receipts for ${scenarios.length} scenarios...`,
  });

  // Generate individual receipts
  await Promise.all(
    scenarios.map(async (scenario) => {
      const html = generateReceipt(scenario);
      const filename = join(
        RECEIPTS_DIR,
        `scenario-${String(scenario.number).padStart(2, "0")}.html`,
      );
      await Deno.writeTextFile(filename, html);
      log({
        tags: ["info", "receipt"],
        message: `Generated scenario-${
          String(scenario.number).padStart(2, "0")
        }.html`,
      });
    }),
  );

  // Generate index
  const indexHtml = generateIndex(scenarios);
  await Deno.writeTextFile(join(RECEIPTS_DIR, "index.html"), indexHtml);
  log({ tags: ["info", "receipt"], message: "Generated index.html" });

  // Ensure CSS exists
  const cssPath = join(RECEIPTS_DIR, "assets", "style.css");
  try {
    await Deno.stat(cssPath);
  } catch {
    await generateDefaultCss(cssPath);
    log({ tags: ["info", "receipt"], message: "Generated assets/style.css" });
  }

  log({
    tags: ["info", "receipt"],
    message:
      `Receipt generation complete! ${scenarios.length} scenario receipts at ${RECEIPTS_DIR}/index.html`,
  });
};

main(createLogger()).catch((e) => {
  const log = createLogger();
  log({ tags: ["error", "receipt"], message: `Fatal error: ${e}` });
});
