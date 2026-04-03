/**
 * Quick Start guide page.
 * @module
 */
import type * as preact from "preact";
import { Layout } from "../layout.tsx";

export const QuickstartPage = (): preact.VNode => (
  <Layout
    title="quick start"
    description="Get ralphmania running in minutes."
  >
    <div class="page-layout">
      {/* Sidebar */}
      <aside class="sidebar">
        <nav>
          <div class="sidebar-section">Quick Start</div>
          <ul class="sidebar-nav">
            <li>
              <a href="#installation">Installation</a>
            </li>
            <li>
              <a href="#specification">Write a Spec</a>
            </li>
            <li>
              <a href="#running">Run It</a>
            </li>
            <li>
              <a href="#progress">Reading Progress</a>
            </li>
            <li>
              <a href="#plugins">Plugins</a>
            </li>
          </ul>
        </nav>
      </aside>

      {/* Main content */}
      <main class="content">
        <h2 id="installation">Installation</h2>
        <p>
          ralphmania runs on{" "}
          <strong>Deno v2</strong>. No install required — run directly from JSR:
        </p>
        <pre><code>deno run -A jsr:@cdaringe/ralphmania -i 10</code></pre>
        <p>Or cache it for repeated use:</p>
        <pre><code>deno install -Ag -n ralphmania jsr:@cdaringe/ralphmania
ralphmania -i 10</code></pre>

        <h2 id="specification">Write a Specification</h2>
        <p>
          Create a <code>specification.md</code>{" "}
          in your project root. Each row in a markdown table is one scenario the
          AI will tackle:
        </p>
        <pre><code>{`# My Project Specification

| # | Category | Description |
| - | -------- | ----------- |
| 1 | Setup    | Initialise the project with a deno.json and README |
| 2 | API      | Create a REST endpoint GET /health that returns 200 |
| 3 | Tests    | Write tests for the health endpoint |
| 4 | CI       | Add a GitHub Actions workflow that runs tests |`}</code></pre>
        <div class="callout">
          <p>
            <strong>Tip:</strong> Scenario IDs can be any string —{" "}
            <code>1</code>, <code>ARCH.1</code>,{" "}
            <code>GUI.a</code>, etc. ralphmania tracks them exactly as written.
          </p>
        </div>

        <h2 id="running">Running the Tool</h2>
        <p>
          From your project directory, run with the desired iteration count:
        </p>
        <pre><code>{`# Run up to 10 agent iterations
deno run -A jsr:@cdaringe/ralphmania -i 10

# Use a specific AI agent (default: claude)
deno run -A jsr:@cdaringe/ralphmania -i 10 --agent claude

# Load a plugin
deno run -A jsr:@cdaringe/ralphmania -i 10 --plugin ./plugin.ralph.ts

# Reset all worktrees before starting
deno run -A jsr:@cdaringe/ralphmania -i 10 --reset-worktrees`}</code></pre>

        <h2 id="progress">Reading Progress</h2>
        <p>
          ralphmania writes a <code>progress.md</code>{" "}
          file tracking every scenario:
        </p>
        <pre><code>{`# Progress

| # | Status        | Summary                     | Rework Notes |
| - | ------------- | --------------------------- | ------------ |
| 1 | VERIFIED      | Created deno.json + README  |              |
| 2 | WORK_COMPLETE | Health endpoint added       |              |
| 3 | WIP           |                             |              |
| 4 | WIP           |                             |              |`}</code></pre>
        <p>Possible statuses:</p>
        <ul>
          <li>
            <code>WIP</code> — work in progress, not yet submitted
          </li>
          <li>
            <code>WORK_COMPLETE</code> — agent finished, awaiting validation
          </li>
          <li>
            <code>VERIFIED</code> — passed validation, scenario done
          </li>
          <li>
            <code>NEEDS_REWORK</code> — validation failed, will be retried
          </li>
          <li>
            <code>OBSOLETE</code> — scenario removed from spec
          </li>
        </ul>

        <h2 id="plugins">Configuring via Plugins</h2>
        <p>
          Plugins are TypeScript files that export hooks. Create a{" "}
          <code>plugin.ralph.ts</code>:
        </p>
        <pre><code>{`import type { Plugin } from "jsr:@cdaringe/ralphmania";

export const plugin: Plugin = {
  onPromptBuilt({ prompt }) {
    return prompt + "\\nAlways add JSDoc comments to exported functions.";
  },
  onValidationComplete({ result }) {
    if (!result.passed) {
      console.log("Validation failed:", result.messages);
    }
    return result;
  },
};`}</code></pre>
        <p>
          See the <a href="reference.html">Reference</a>{" "}
          page for the full list of plugin hooks.
        </p>
      </main>
    </div>
  </Layout>
);
