/**
 * Home page — hero, features, how it works, CTA.
 * @module
 */
import type * as preact from "preact";
import { Layout } from "../layout.tsx";

export const IndexPage = (): preact.VNode => (
  <Layout
    title="home"
    description="AI agent orchestration for iterative spec-driven development"
  >
    {/* Hero */}
    <section class="hero">
      <div class="hero-inner">
        <h1>
          <span>ralph</span>mania
        </h1>
        <p class="tagline">
          AI agent orchestration for iterative spec-driven development
        </p>
        <div class="hero-install">
          <span>$</span>
          <code>deno run -A jsr:@cdaringe/ralphmania -i 10</code>
        </div>
        <div class="hero-cta">
          <a href="quickstart.html" class="btn btn-primary">Quick Start</a>
          <a href="reference.html" class="btn btn-secondary">Reference</a>
          <a
            href="https://github.com/cdaringe/ralphmania"
            class="btn btn-secondary"
          >
            GitHub
          </a>
        </div>
      </div>
    </section>

    {/* Features */}
    <section class="section">
      <div class="section-inner">
        <div class="section-title">
          <h2>Why ralphmania?</h2>
          <p>A task runner that thinks for itself — and checks its own work.</p>
        </div>
        <div class="feature-grid">
          <div class="feature-card">
            <div class="feature-icon">&#x1f504;</div>
            <h3>Iterative</h3>
            <p>
              Runs AI agents in a loop over your specification, making progress
              on each scenario until completion.
            </p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">&#x2713;</div>
            <h3>Validated</h3>
            <p>
              Each scenario is verified before being marked done. Failed
              validation triggers targeted rework.
            </p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">&#x1f4c8;</div>
            <h3>Escalating</h3>
            <p>
              Configurable escalation strategies let you widen search or retry
              with different agents on failure.
            </p>
          </div>
          <div class="feature-card">
            <div class="feature-icon">&#x1f9e9;</div>
            <h3>Extensible</h3>
            <p>
              Plugin hooks let you intercept every stage — before, during, and
              after each scenario run.
            </p>
          </div>
        </div>
      </div>
    </section>

    {/* How it works */}
    <section class="section section-alt">
      <div class="section-inner">
        <div class="section-title">
          <h2>How it works</h2>
          <p>Five steps from spec to shipped.</p>
        </div>
        <div class="steps">
          <div class="step">
            <div class="step-num">1</div>
            <div class="step-body">
              <h3>Write a specification</h3>
              <p>
                Author a markdown table of scenarios in{" "}
                <code>specification.md</code>.
              </p>
            </div>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <div class="step-body">
              <h3>Run ralphmania</h3>
              <p>
                Execute <code>deno run -A jsr:@cdaringe/ralphmania -i 10</code>
                {" "}
                to start the loop.
              </p>
            </div>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <div class="step-body">
              <h3>Agent works each scenario</h3>
              <p>
                An AI agent is dispatched per scenario, running in an isolated
                git worktree.
              </p>
            </div>
          </div>
          <div class="step">
            <div class="step-num">4</div>
            <div class="step-body">
              <h3>Validation &amp; rework</h3>
              <p>
                Completed scenarios are validated. Failures are flagged{" "}
                <code>NEEDS_REWORK</code> and retried.
              </p>
            </div>
          </div>
          <div class="step">
            <div class="step-num">5</div>
            <div class="step-body">
              <h3>Progress tracked in progress.md</h3>
              <p>
                A living <code>progress.md</code>{" "}
                file records every scenario's status throughout the run.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    {/* Bottom CTA */}
    <section class="section">
      <div class="section-inner section-cta">
        <h2>Ready to automate your workflow?</h2>
        <p class="section-cta-sub">
          Get started in under a minute.
        </p>
        <div class="hero-cta">
          <a href="quickstart.html" class="btn btn-primary">
            Read the Quick Start
          </a>
          <a
            href="https://jsr.io/@cdaringe/ralphmania"
            class="btn btn-secondary"
          >
            View on JSR
          </a>
        </div>
      </div>
    </section>
  </Layout>
);
