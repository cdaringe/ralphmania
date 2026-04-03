/**
 * Reference page — CLI flags, plugin hooks, statuses, env vars.
 * @module
 */
import type * as preact from "preact";
import { Layout } from "../layout.tsx";

export const ReferencePage = (): preact.VNode => (
  <Layout
    title="reference"
    description="Full CLI reference for ralphmania flags, plugin hooks, and statuses."
  >
    <div class="page-layout">
      {/* Sidebar */}
      <aside class="sidebar">
        <nav>
          <div class="sidebar-section">Reference</div>
          <ul class="sidebar-nav">
            <li>
              <a href="#cli-flags">CLI Flags</a>
            </li>
            <li>
              <a href="#plugin-hooks">Plugin Hooks</a>
            </li>
            <li>
              <a href="#statuses">Progress Statuses</a>
            </li>
            <li>
              <a href="#env-vars">Environment Variables</a>
            </li>
          </ul>
        </nav>
      </aside>

      {/* Main content */}
      <main class="content">
        <h2 id="cli-flags">CLI Flags</h2>
        <p>
          All flags can be passed to{" "}
          <code>deno run -A jsr:@cdaringe/ralphmania</code>.
        </p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Flag</th>
                <th>Short</th>
                <th>Type</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>--agent</code>
                </td>
                <td>
                  <code>-a</code>
                </td>
                <td>string</td>
                <td>AI agent to use (default: <code>claude</code>)</td>
              </tr>
              <tr>
                <td>
                  <code>--iterations</code>
                </td>
                <td>
                  <code>-i</code>
                </td>
                <td>number</td>
                <td>
                  Maximum number of agent iterations to run (required)
                </td>
              </tr>
              <tr>
                <td>
                  <code>--plugin</code>
                </td>
                <td>
                  <code>-p</code>
                </td>
                <td>string</td>
                <td>
                  Path to a plugin file exporting a{" "}
                  <code>RalphPlugin</code> default
                </td>
              </tr>
              <tr>
                <td>
                  <code>--reset-worktrees</code>
                </td>
                <td>—</td>
                <td>boolean</td>
                <td>Remove and re-create all worker git worktrees on start</td>
              </tr>
              <tr>
                <td>
                  <code>--gui</code>
                </td>
                <td>—</td>
                <td>boolean</td>
                <td>
                  Open the live GUI in the browser while the orchestrator runs
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 id="plugin-hooks">Plugin Hooks</h2>
        <p>
          Plugins export a named <code>plugin</code>{" "}
          object conforming to the <code>Plugin</code>{" "}
          type. All hooks are optional and async-friendly.
        </p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hook</th>
                <th>Called when</th>
                <th>Can modify</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>onConfigResolved</code>
                </td>
                <td>Once, before the loop starts</td>
                <td>agent, iterations, specFile, progressFile</td>
              </tr>
              <tr>
                <td>
                  <code>onModelSelected</code>
                </td>
                <td>Each iteration, after model resolution</td>
                <td>ModelSelection (model, provider)</td>
              </tr>
              <tr>
                <td>
                  <code>onPromptBuilt</code>
                </td>
                <td>Each iteration, after prompt construction</td>
                <td>prompt string</td>
              </tr>
              <tr>
                <td>
                  <code>onCommandBuilt</code>
                </td>
                <td>Each iteration, after CLI command assembly</td>
                <td>CommandSpec (command, args, env)</td>
              </tr>
              <tr>
                <td>
                  <code>onIterationEnd</code>
                </td>
                <td>After the agent subprocess exits</td>
                <td>observe only</td>
              </tr>
              <tr>
                <td>
                  <code>onValidationComplete</code>
                </td>
                <td>After the validation script runs</td>
                <td>ValidationResult (pass/fail/messages)</td>
              </tr>
              <tr>
                <td>
                  <code>onLoopEnd</code>
                </td>
                <td>Once after the loop exits, regardless of outcome</td>
                <td>observe only</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Example plugin</h3>
        <pre><code>{`import type { Plugin } from "jsr:@cdaringe/ralphmania";

export const plugin: Plugin = {
  onPromptBuilt({ prompt }) {
    // Append extra instructions to every agent prompt
    return prompt + "\\nAlways use TypeScript strict mode.";
  },
  onLoopEnd({ finalState, log }) {
    log({ tags: ["info"], message: \`Loop ended after \${finalState.iteration} iterations\` });
  },
};`}</code></pre>

        <h2 id="statuses">Progress Statuses</h2>
        <p>
          Each scenario in <code>progress.md</code>{" "}
          carries one of five statuses:
        </p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span class="badge badge-gray">WIP</span>
                </td>
                <td>Work in progress — agent has not yet submitted</td>
              </tr>
              <tr>
                <td>
                  <span class="badge badge-gray">WORK_COMPLETE</span>
                </td>
                <td>
                  Agent submitted a result, awaiting validation by the
                  orchestrator
                </td>
              </tr>
              <tr>
                <td>
                  <span class="badge badge-green">VERIFIED</span>
                </td>
                <td>Validation passed — scenario is done</td>
              </tr>
              <tr>
                <td>
                  <span class="badge badge-gray">NEEDS_REWORK</span>
                </td>
                <td>
                  Validation failed — scenario will be retried in the next
                  iteration
                </td>
              </tr>
              <tr>
                <td>
                  <span class="badge badge-gray">OBSOLETE</span>
                </td>
                <td>
                  The scenario was removed from <code>specification.md</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 id="env-vars">Environment Variables</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Variable</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>ANTHROPIC_API_KEY</code>
                </td>
                <td>
                  Required when using the <code>claude</code> agent
                </td>
              </tr>
              <tr>
                <td>
                  <code>RALPH_LOG</code>
                </td>
                <td>
                  Set to <code>debug</code> for verbose orchestrator logging
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>
    </div>
  </Layout>
);
