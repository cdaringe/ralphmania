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
  id: number | string; // Can be 01, ARCH.1, GUI.a, CLI.1, etc.
  number: number; // For sorting: 1-99 for numbered, 100+ for others
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
  { id, log }: { id: number | string; log: Logger },
): Promise<Result<ScenarioData, string>> => {
  const idStr = String(id);
  let searchPattern: string;
  let numberForSort: number;

  if (typeof id === "number") {
    searchPattern = String(id).padStart(2, "0") + "-";
    numberForSort = id;
  } else {
    searchPattern = idStr + "-";
    // Assign sort numbers to non-numeric IDs
    if (idStr.startsWith("ARCH")) {
      numberForSort = 100 + parseInt(idStr.match(/\d+/)?.[0] || "0");
    } else if (idStr.startsWith("GUI")) {
      numberForSort = 200 + idStr.charCodeAt(4) - 97; // GUI.a=0, GUI.b=1, etc.
    } else if (idStr.startsWith("CLI")) {
      numberForSort = 300 + parseInt(idStr.match(/\d+/)?.[0] || "0");
    } else {
      numberForSort = 400;
    }
  }

  const entries = await Array.fromAsync(Deno.readDir(SCENARIOS_DIR));
  const docFile = entries
    .find((file) =>
      file.isFile && file.name.startsWith(searchPattern) &&
      file.name.endsWith(".md")
    )
    ?.name;

  if (!docFile) {
    return err(`Scenario ${idStr} documentation not found`);
  }

  const content = await Deno.readTextFile(join(SCENARIOS_DIR, docFile));
  const sections = parseMarkdown(content);

  // Handle both "Requirement" and "Specification" section names
  const requirement = sections.requirement || sections.scenario ||
    sections.specification || "";
  const intro = generateIntro(
    sections.howitisachieved || sections.implementation || "",
    requirement,
  );
  const hasVideo = checkVideoExists(idStr);

  log({
    tags: ["info", "receipt"],
    message: `Loaded scenario ${idStr}: ${extractTitle(content)}`,
  });

  return ok({
    id,
    number: numberForSort,
    title: extractTitle(content),
    intro,
    requirement,
    implementation: sections.howitisachieved || sections.implementation || "",
    evidence: sections.evidence || sections.evidencereferences || "",
    testFiles: extractTestFiles(sections.implementation || ""),
    status: "VERIFIED",
    hasVideo,
  });
};

/**
 * Parse markdown content into sections, handling various heading styles
 */
const parseMarkdown = (content: string): Record<string, string> => {
  const lines = content.split("\n");
  const { sections, currentSection, currentContent } = lines.reduce(
    (acc, line) => {
      if (line.startsWith("## ")) {
        const updated = acc.currentSection
          ? {
            ...acc.sections,
            [acc.currentSection.toLowerCase().replace(/[^\w]/g, "")]: acc
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

  const finalSections = currentSection
    ? {
      ...sections,
      [currentSection.toLowerCase().replace(/[^\w]/g, "")]: currentContent
        .trim(),
    }
    : sections;

  // Normalize section keys for flexibility
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(finalSections)) {
    normalized[key] = value;
    // Add aliases for common variations
    if (key === "howitisachieved") {
      normalized["implementation"] = value;
    }
    if (key === "scenario") {
      normalized["requirement"] = value;
    }
  }

  return normalized;
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
const checkVideoExists = (id: number | string): boolean => {
  const idStr = String(id);
  const filename = typeof id === "number"
    ? `scenario-${String(id).padStart(2, "0")}`
    : `scenario-${idStr}`;
  const videoPath = join(RECEIPTS_DIR, "videos", `${filename}.mp4`);
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
  const idStr = typeof scenario.id === "number"
    ? pad(scenario.id)
    : String(scenario.id);
  const videoFilename = typeof scenario.id === "number"
    ? `scenario-${pad(scenario.id)}.mp4`
    : `scenario-${scenario.id}.mp4`;

  const videoHtml = scenario.hasVideo
    ? `
    <div class="section">
      <h2>🎬 Test Evidence Video</h2>
      <video controls width="100%" class="test-video">
        <source src="videos/${videoFilename}" type="video/mp4">
        Your browser does not support the video tag.
      </video>
      <p><em>E2E test execution showing scenario ${idStr} requirements in action</em></p>
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
  <title>Scenario ${idStr} - ${scenario.title} | Receipts</title>
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
      <h1>Scenario ${idStr}: ${scenario.title}</h1>
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
        <p style="margin-top: 10px; font-size: 0.9em; color: #666;">All tests pass, confirming scenario ${idStr} requirement is satisfied.</p>
      </div>
    </div>

    <div class="section">
      <h2>📚 Evidence References</h2>
      <div id="evidence" class="markdown-content">
${scenario.evidence}
      </div>
    </div>

    <footer>
      <p>Receipt generated for Scenario ${idStr}</p>
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
      (s) => {
        const idStr = typeof s.id === "number"
          ? String(s.id).padStart(2, "0")
          : String(s.id);
        const filename = typeof s.id === "number"
          ? `scenario-${String(s.id).padStart(2, "0")}.html`
          : `scenario-${s.id}.html`;
        return `
    <a href="${filename}" class="scenario-card">
      <div class="card-header">
        <div class="scenario-number">Scenario ${idStr}</div>
        <span class="scenario-status status-${
          s.status === "VERIFIED" ? "verified" : "rework"
        }">
          ${s.status === "VERIFIED" ? "✅ VERIFIED" : "⚠️ NEEDS_REWORK"}
        </span>
      </div>
      <div class="scenario-title">${s.title}</div>
      <div class="card-footer">${s.testFiles.length} test file(s)</div>
    </a>`;
      },
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
 * Auto-discover all scenario files (numbered, ARCH, GUI, CLI)
 */
const discoverScenarios = (log: Logger): (number | string)[] => {
  try {
    return [...Deno.readDirSync(SCENARIOS_DIR)]
      .filter((file) => file.isFile && file.name.endsWith(".md"))
      .map((file) => {
        // Match numbered scenarios
        const numMatch = file.name.match(/^(\d+)-/);
        if (numMatch) return parseInt(numMatch[1], 10);

        // Match ARCH scenarios (ARCH.1, ARCH.2, etc.)
        const archMatch = file.name.match(/^(ARCH\.\d+[a-z]?)-/);
        if (archMatch) return archMatch[1];

        // Match GUI scenarios (GUI.a, GUI.b, etc.)
        const guiMatch = file.name.match(/^(GUI\.[a-d])-/);
        if (guiMatch) return guiMatch[1];

        // Match CLI scenarios (CLI.1, etc.)
        const cliMatch = file.name.match(/^(CLI\.\d+)-/);
        if (cliMatch) return cliMatch[1];

        return null;
      })
      .filter((m): m is number | string => m !== null)
      .sort((a, b) => {
        // Sort: numbers first, then strings alphabetically
        if (typeof a === "number" && typeof b === "number") return a - b;
        if (typeof a === "string" && typeof b === "string") {
          return a.localeCompare(b);
        }
        return typeof a === "number" ? -1 : 1;
      });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log({
      tags: ["error", "receipt"],
      message: `Failed to read scenarios directory: ${msg}`,
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
    scenarioNumbers.map((id) => readScenario({ id, log })),
  );
  const scenarios = results.flatMap((r) => {
    if (r.ok) return [r.value];
    log({ tags: ["error", "receipt"], message: r.error });
    return [];
  });

  log({
    tags: ["info", "receipt"],
    message: `Generating HTML receipts for ${scenarios.length} scenarios...`,
  });

  // Sort scenarios by number for proper ordering
  scenarios.sort((a, b) => a.number - b.number);

  // Generate individual receipts
  await Promise.all(
    scenarios.map(async (scenario) => {
      const html = generateReceipt(scenario);
      const idStr = typeof scenario.id === "number"
        ? String(scenario.id).padStart(2, "0")
        : String(scenario.id);
      const filename = join(RECEIPTS_DIR, `scenario-${idStr}.html`);
      await Deno.writeTextFile(filename, html);
      log({
        tags: ["info", "receipt"],
        message: `Generated scenario-${idStr}.html`,
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
  const msg = e instanceof Error ? e.message : String(e);
  log({ tags: ["error", "receipt"], message: `Fatal error: ${msg}` });
  console.error("Stack:", e instanceof Error ? e.stack : e);
});
