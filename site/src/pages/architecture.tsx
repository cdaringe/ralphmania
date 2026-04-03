/**
 * Architecture page — system overview, workflow visuals, state annotations,
 * and plugin lifecycle markers.
 * @module
 */
import type * as preact from "preact";
import { Layout } from "../layout.tsx";

/**
 * A single node in a flow diagram, rendered as a labelled box.
 * `active` highlights it green; `annotation` adds a small badge.
 */
const FlowNode = (
  { label, annotation, active, variant }: {
    label: string;
    annotation?: string;
    active?: boolean;
    variant?: "decision" | "terminal";
  },
): preact.VNode => (
  <div
    class={[
      "flow-node",
      active ? "flow-node--active" : "",
      variant === "decision" ? "flow-node--decision" : "",
      variant === "terminal" ? "flow-node--terminal" : "",
    ].filter(Boolean).join(" ")}
  >
    <span class="flow-node-label">{label}</span>
    {annotation && <span class="flow-annotation">{annotation}</span>}
  </div>
);

/** Downward arrow between flow nodes. */
const FlowArrow = ({ label }: { label?: string }): preact.VNode => (
  <div class="flow-arrow">
    <div class="flow-arrow-line" />
    {label && <span class="flow-arrow-label">{label}</span>}
  </div>
);

/** Horizontal group of nodes displayed side by side. */
const FlowRow = (
  { children }: { children: preact.ComponentChildren },
): preact.VNode => <div class="flow-row">{children}</div>;

export const ArchitecturePage = (): preact.VNode => (
  <Layout
    title="architecture"
    description="System architecture, workflow visuals, state machines, and plugin lifecycle for ralphmania."
  >
    <div class="page-layout">
      {/* Sidebar */}
      <aside class="sidebar">
        <nav>
          <div class="sidebar-section">Architecture</div>
          <ul class="sidebar-nav">
            <li>
              <a href="#overview">System Overview</a>
            </li>
            <li>
              <a href="#orchestrator">Orchestrator Workflow</a>
            </li>
            <li>
              <a href="#worker">Worker Pipeline</a>
            </li>
            <li>
              <a href="#merge">Merge &amp; Reconcile</a>
            </li>
            <li>
              <a href="#escalation">Model Escalation</a>
            </li>
            <li>
              <a href="#scenario-lifecycle">Scenario Lifecycle</a>
            </li>
            <li>
              <a href="#plugin-lifecycle">Plugin Lifecycle</a>
            </li>
            <li>
              <a href="#file-map">File Map</a>
            </li>
          </ul>
        </nav>
      </aside>

      {/* Main content */}
      <main class="content">
        {/* ── System Overview ───────────────────────────── */}
        <h2 id="overview">System Overview</h2>
        <p>
          Ralphmania is a spec-driven AI orchestrator built on hexagonal
          architecture. The user writes a <code>specification.md</code>{" "}
          and a validation script; the orchestrator drives one or more AI agents
          in parallel to implement every scenario, validating after each round.
        </p>

        <div class="flow-diagram">
          <FlowRow>
            <FlowNode label="specification.md" variant="terminal" />
            <FlowNode label="progress.md" variant="terminal" />
            <FlowNode
              label="specification.validate.sh"
              variant="terminal"
            />
          </FlowRow>
          <FlowArrow label="read by" />
          <FlowNode label="CLI Parser" />
          <FlowArrow />
          <FlowNode
            label="Orchestrator Loop"
            active
            annotation="state machine"
          />
          <FlowArrow label="spawns" />
          <FlowRow>
            <FlowNode label="Worker 0" annotation="worktree" />
            <FlowNode label="Worker 1" annotation="worktree" />
            <FlowNode label="Worker N" annotation="worktree" />
          </FlowRow>
          <FlowArrow label="merge &amp; validate" />
          <FlowNode label="Validation" annotation="script runner" />
          <FlowArrow />
          <FlowNode
            label="Receipts / Exit"
            variant="terminal"
            annotation="exit 0"
          />
        </div>

        {/* ── Orchestrator Workflow ─────────────────────── */}
        <h2 id="orchestrator">Orchestrator Workflow</h2>
        <p>
          The orchestrator is a finite state machine (FSM) defined in{" "}
          <code>src/machines/state-machine.ts</code>. Each state transition is
          logged and checkpointed to <code>.ralph/loop-state.json</code>{" "}
          for crash recovery.
        </p>

        <div class="flow-diagram">
          <FlowNode label="init" active annotation="state change" />
          <FlowArrow label="restore checkpoint" />
          <FlowNode
            label="reading_progress"
            active
            annotation="state change"
          />
          <FlowArrow label="parse progress.md" />
          <FlowNode
            label="finding_actionable"
            active
            annotation="state change"
          />
          <FlowArrow label="cluster &amp; select batch" />
          <FlowNode
            label="running_workers"
            active
            annotation="state change + plugin:onModelSelected"
          />
          <FlowArrow label="workers complete, merge queue" />
          <FlowNode
            label="validating"
            active
            annotation="state change + plugin:onValidationComplete"
          />
          <FlowArrow label="check doneness" />
          <FlowNode
            label="checking_doneness"
            active
            annotation="state change"
          />
          <FlowArrow />
          <FlowRow>
            <FlowNode
              label="done"
              variant="terminal"
              annotation="plugin:onLoopEnd"
            />
            <FlowNode
              label="reading_progress"
              annotation="loop back"
            />
          </FlowRow>
        </div>

        <div class="callout">
          <p>
            <strong>State persistence:</strong>{" "}
            A checkpoint is written after every state transition. If the process
            crashes, the orchestrator resumes from the last checkpointed state
            and iteration count.
          </p>
        </div>

        {/* ── Worker Pipeline ──────────────────────────── */}
        <h2 id="worker">Worker Pipeline</h2>
        <p>
          Each worker runs in an isolated git worktree and follows its own FSM
          defined in{" "}
          <code>src/machines/worker-machine.ts</code>. The parent orchestrator
          prescribes exactly one scenario per worker to prevent conflicts.
        </p>

        <div class="flow-diagram">
          <FlowNode
            label="resolving_model"
            active
            annotation="plugin:onModelSelected"
          />
          <FlowArrow label="escalation lookup" />
          <FlowNode
            label="model_resolved"
            active
            annotation="plugin:onPromptBuilt"
          />
          <FlowArrow label="build prompt" />
          <FlowNode
            label="prompt_built"
            active
            annotation="plugin:onCommandBuilt"
          />
          <FlowArrow label="build command" />
          <FlowNode label="command_built" active annotation="state change" />
          <FlowArrow label="spawn agent subprocess" />
          <FlowNode
            label="running_agent"
            active
            annotation="NDJSON stream"
          />
          <FlowArrow label="completion marker?" />
          <FlowNode
            label="done"
            variant="terminal"
            annotation="plugin:onIterationEnd"
          />
        </div>

        <div class="callout">
          <p>
            <strong>Non-interactive:</strong> All agent subprocesses run with
            {" "}
            <code>CI=true</code>, no TTY, and stdin null to prevent hangs in
            automated pipelines.
          </p>
        </div>

        {/* ── Merge & Reconcile ────────────────────────── */}
        <h2 id="merge">Merge &amp; Reconcile</h2>
        <p>
          Workers enqueue their worktree branches into a merge queue as they
          finish. The orchestrator dequeues and merges sequentially. On
          conflict, a reconciliation agent is spawned to resolve it — no work is
          ever discarded.
        </p>

        <div class="flow-diagram">
          <FlowRow>
            <FlowNode label="Worker 0 done" variant="terminal" />
            <FlowNode label="Worker 1 done" variant="terminal" />
          </FlowRow>
          <FlowArrow label="enqueue branches" />
          <FlowNode label="Merge Queue" active />
          <FlowArrow label="git merge --no-edit" />
          <FlowNode label="Merge Attempt" variant="decision" />
          <FlowArrow />
          <FlowRow>
            <FlowNode
              label="Success"
              variant="terminal"
              annotation="validate"
            />
            <FlowNode label="Conflict" annotation="reconcile agent" />
          </FlowRow>
        </div>

        {/* ── Model Escalation ─────────────────────────── */}
        <h2 id="escalation">Model Escalation</h2>
        <p>
          The Claude agent uses a 2-level escalation ladder controlled per
          scenario in{" "}
          <code>.ralph/escalation.json</code>. Escalation increases
          monotonically during rework and resets when the scenario exits{" "}
          <code>NEEDS_REWORK</code>.
        </p>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Level</th>
                <th>Model</th>
                <th>Tier</th>
                <th>Trigger</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span class="badge badge-green">L0</span>
                </td>
                <td>Sonnet</td>
                <td>general / high effort</td>
                <td>Default for new scenarios</td>
              </tr>
              <tr>
                <td>
                  <span class="badge badge-gray">L1</span>
                </td>
                <td>Opus</td>
                <td>strong / high effort</td>
                <td>
                  Scenario marked <code>NEEDS_REWORK</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p>
          For Codex agents, a rework-count threshold determines whether the
          general or strong model is used.
        </p>

        {/* ── Scenario Lifecycle ───────────────────────── */}
        <h2 id="scenario-lifecycle">Scenario Lifecycle</h2>
        <p>
          Every scenario in <code>progress.md</code>{" "}
          follows a strict state machine defined in{" "}
          <code>src/machines/scenario-machine.ts</code>. Invalid transitions are
          rejected and logged.
        </p>

        <div class="flow-diagram">
          <FlowNode label="UNIMPLEMENTED" active annotation="initial" />
          <FlowArrow />
          <FlowNode label="WIP" active annotation="state change" />
          <FlowArrow />
          <FlowNode label="WORK_COMPLETE" active annotation="state change" />
          <FlowArrow />
          <FlowRow>
            <FlowNode label="VERIFIED" variant="terminal" />
            <FlowNode
              label="NEEDS_REWORK"
              annotation="escalates model"
            />
          </FlowRow>
        </div>

        <p>
          From <code>NEEDS_REWORK</code>, the scenario cycles back to{" "}
          <code>WIP</code>{" "}
          for another attempt. Any non-terminal scenario can be marked{" "}
          <code>OBSOLETE</code> (terminal) by the user. The orchestrator skips
          {" "}
          <code>OBSOLETE</code> scenarios in completeness checks.
        </p>

        {/* ── Plugin Lifecycle ─────────────────────────── */}
        <h2 id="plugin-lifecycle">Plugin Lifecycle</h2>
        <p>
          Plugins intercept seven hooks during the orchestrator and worker
          lifecycles. Each hook is annotated in the diagrams above where it
          fires.
        </p>

        <div class="flow-diagram">
          <FlowNode
            label="onConfigResolved"
            active
            annotation="once, before loop"
          />
          <FlowArrow />
          <FlowNode
            label="onModelSelected"
            active
            annotation="per worker"
          />
          <FlowArrow />
          <FlowNode
            label="onPromptBuilt"
            active
            annotation="per worker"
          />
          <FlowArrow />
          <FlowNode
            label="onCommandBuilt"
            active
            annotation="per worker"
          />
          <FlowArrow />
          <FlowNode
            label="onIterationEnd"
            active
            annotation="per worker"
          />
          <FlowArrow />
          <FlowNode
            label="onValidationComplete"
            active
            annotation="per round"
          />
          <FlowArrow />
          <FlowNode
            label="onLoopEnd"
            active
            annotation="once, after loop"
          />
        </div>

        <div class="callout">
          <p>
            <strong>Mutability:</strong>{" "}
            Hooks that return a value can override the orchestrator's decision.
            For example, <code>onPromptBuilt</code> can rewrite the prompt and
            {" "}
            <code>onValidationComplete</code> can flip a failure to a pass.
          </p>
        </div>

        {/* ── File Map ─────────────────────────────────── */}
        <h2 id="file-map">File Map</h2>
        <p>
          Source is organized following hexagonal architecture: pure domain
          logic in <code>src/machines/</code>, I/O adapters in{" "}
          <code>src/ports/</code>, and domain-specific code clustered in
          subdirectories.
        </p>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Directory</th>
                <th>Responsibility</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>src/machines/</code>
                </td>
                <td>
                  FSMs: orchestrator, worker, scenario state machines (pure
                  logic, no I/O)
                </td>
              </tr>
              <tr>
                <td>
                  <code>src/ports/</code>
                </td>
                <td>
                  Port contracts (<code>types.ts</code>) and Deno adapters (
                  <code>impl.ts</code>)
                </td>
              </tr>
              <tr>
                <td>
                  <code>src/orchestrator/</code>
                </td>
                <td>
                  Parallel loop, merge queue, conflict-aware clustering
                </td>
              </tr>
              <tr>
                <td>
                  <code>src/git/</code>
                </td>
                <td>Worktree creation, cleanup, merge operations</td>
              </tr>
              <tr>
                <td>
                  <code>src/parsers/</code>
                </td>
                <td>Progress row parsing, scenario ID extraction</td>
              </tr>
              <tr>
                <td>
                  <code>src/gui/</code>
                </td>
                <td>
                  Live GUI: SSE server, islands, event bus, publish pipeline
                </td>
              </tr>
              <tr>
                <td>
                  <code>site/</code>
                </td>
                <td>Static docs site: Preact pages, CSS, build script</td>
              </tr>
              <tr>
                <td>
                  <code>.ralph/</code>
                </td>
                <td>
                  Runtime state: escalation, checkpoints, validation logs,
                  receipts, worktrees
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Key data flow</h3>
        <pre>
          <code>
            {`specification.md --> prompt --> agent --> code changes --> git commit
                                                          |
progress.md <---------- agent updates status -------------+
                                                          |
specification.validate.sh <--- runs after merge ----------+
         |
         +--> .ralph/validation/iteration-N.log --> feeds next iteration`}
          </code>
        </pre>
      </main>
    </div>
  </Layout>
);
