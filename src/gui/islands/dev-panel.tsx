/**
 * Dev panel island for simulation mode.
 *
 * Provides interactive controls for the SimController: timing profile,
 * auto-advance toggle, per-scenario outcomes, validation/merge/failure
 * knobs, and step/reset actions.
 *
 * Reads initial state from GET /api/sim/config, applies changes via
 * POST /api/sim/config, and listens for sim_state SSE events.
 *
 * @module
 */
import { h } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

type SimConfig = {
  profile: string;
  autoAdvance: boolean;
  validationFailureRate: number;
  mergeConflictRate: number;
  workerFailureRate: number;
  scenarioCount: number;
  scenarioOutcomes: Record<string, string>;
};

const DEFAULT_CONFIG: SimConfig = {
  profile: "fast",
  autoAdvance: true,
  validationFailureRate: 0,
  mergeConflictRate: 0,
  workerFailureRate: 0,
  scenarioCount: 4,
  scenarioOutcomes: {},
};

const postConfig = async (partial: Partial<SimConfig>): Promise<void> => {
  await fetch("/api/sim/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(partial),
  });
};

const postAction = async (action: string): Promise<void> => {
  await fetch(`/api/sim/${action}`, { method: "POST" });
};

const DevPanel = (): preact.VNode => {
  const [collapsed, setCollapsed] = useState(false);
  const [config, setConfig] = useState<SimConfig>(DEFAULT_CONFIG);
  const configRef = useRef(config);
  configRef.current = config;

  // Fetch initial config
  useEffect(() => {
    fetch("/api/sim/config")
      .then((r) => r.json())
      .then((c: SimConfig) => setConfig(c))
      .catch(() => {});
  }, []);

  // Listen for sim_state SSE events
  useEffect(() => {
    const es = new EventSource("/events");
    es.onmessage = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "sim_state") {
          setConfig(data.config);
        }
      } catch { /* ignore parse errors */ }
    };
    return () => es.close();
  }, []);

  const updateConfig = useCallback((partial: Partial<SimConfig>) => {
    const next = { ...configRef.current, ...partial };
    setConfig(next);
    postConfig(partial);
  }, []);

  const scenarioIds = Array.from(
    { length: config.scenarioCount },
    (_, i) => `${i + 1}`,
  );

  return h(
    "div",
    { class: `dev-panel ${collapsed ? "collapsed" : ""}` },
    // Header
    h(
      "div",
      {
        class: "dev-panel-header",
        onClick: () => setCollapsed(!collapsed),
      },
      h("span", null, "sim controls"),
      h("span", { class: "toggle-icon" }, collapsed ? "\u25B2" : "\u25BC"),
    ),
    // Body
    h(
      "div",
      { class: "dev-panel-body" },
      // Profile
      h(
        "div",
        { class: "dev-panel-section" },
        h("label", null, "Timing Profile"),
        h("select", {
          value: config.profile,
          onChange: (e: Event) =>
            updateConfig({
              profile: (e.target as HTMLSelectElement).value,
            }),
        }, ...[
          h("option", { value: "instant" }, "Instant"),
          h("option", { value: "fast" }, "Fast"),
          h("option", { value: "realistic" }, "Realistic"),
        ]),
      ),
      // Auto-advance + Step button
      h(
        "div",
        { class: "dev-panel-section" },
        h(
          "div",
          { class: "dev-panel-toggle" },
          h("input", {
            type: "checkbox",
            checked: config.autoAdvance,
            onChange: (e: Event) =>
              updateConfig({
                autoAdvance: (e.target as HTMLInputElement).checked,
              }),
          }),
          h("span", null, "Auto-advance"),
        ),
        !config.autoAdvance &&
          h("button", {
            class: "dev-panel-btn primary",
            onClick: () => postAction("advance"),
          }, "Step"),
      ),
      // Validation failure rate
      h(
        "div",
        { class: "dev-panel-section" },
        h("label", null, "Validation Failure Rate"),
        h(
          "div",
          { class: "dev-panel-row" },
          h("input", {
            type: "range",
            min: 0,
            max: 100,
            value: Math.round(config.validationFailureRate * 100),
            onInput: (e: Event) =>
              updateConfig({
                validationFailureRate:
                  Number((e.target as HTMLInputElement).value) / 100,
              }),
          }),
          h(
            "span",
            { class: "value" },
            `${Math.round(config.validationFailureRate * 100)}%`,
          ),
        ),
      ),
      // Merge conflict rate
      h(
        "div",
        { class: "dev-panel-section" },
        h("label", null, "Merge Conflict Rate"),
        h(
          "div",
          { class: "dev-panel-row" },
          h("input", {
            type: "range",
            min: 0,
            max: 100,
            value: Math.round(config.mergeConflictRate * 100),
            onInput: (e: Event) =>
              updateConfig({
                mergeConflictRate:
                  Number((e.target as HTMLInputElement).value) / 100,
              }),
          }),
          h(
            "span",
            { class: "value" },
            `${Math.round(config.mergeConflictRate * 100)}%`,
          ),
        ),
      ),
      // Worker failure rate
      h(
        "div",
        { class: "dev-panel-section" },
        h("label", null, "Worker Failure Rate"),
        h(
          "div",
          { class: "dev-panel-row" },
          h("input", {
            type: "range",
            min: 0,
            max: 100,
            value: Math.round(config.workerFailureRate * 100),
            onInput: (e: Event) =>
              updateConfig({
                workerFailureRate:
                  Number((e.target as HTMLInputElement).value) / 100,
              }),
          }),
          h(
            "span",
            { class: "value" },
            `${Math.round(config.workerFailureRate * 100)}%`,
          ),
        ),
      ),
      // Scenario outcomes
      h(
        "div",
        { class: "dev-panel-section" },
        h("label", null, "Scenario Outcomes"),
        h(
          "div",
          { class: "scenario-outcomes" },
          ...scenarioIds.map((id) =>
            h(
              "div",
              { class: "scenario-outcome-row", key: id },
              h("span", { class: "id" }, id),
              h("select", {
                value: config.scenarioOutcomes[id] ?? "complete",
                onChange: (e: Event) => {
                  const outcomes = {
                    ...config.scenarioOutcomes,
                    [id]: (e.target as HTMLSelectElement).value,
                  };
                  updateConfig({ scenarioOutcomes: outcomes });
                },
              }, ...[
                h("option", { value: "complete" }, "Complete"),
                h("option", { value: "needs_rework" }, "Needs Rework"),
                h("option", { value: "timeout" }, "Timeout"),
              ]),
            )
          ),
        ),
      ),
      // Actions
      h(
        "div",
        { class: "dev-panel-section" },
        h(
          "div",
          { class: "dev-panel-actions" },
          h("button", {
            class: "dev-panel-btn primary",
            onClick: () => postAction("reset"),
          }, "Restart Sim"),
          h("button", {
            class: "dev-panel-btn",
            onClick: () => postAction("reset-config"),
          }, "Reset Config"),
        ),
      ),
    ),
  );
};

export default DevPanel;
