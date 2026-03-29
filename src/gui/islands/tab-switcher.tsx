/**
 * Tab switcher island — toggles between Graph and Log panels.
 * @module
 */
import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

type Props = {
  readonly graphPanel: ComponentChildren;
  readonly logPanel: ComponentChildren;
};

export default function TabSwitcher(
  { graphPanel, logPanel }: Props,
): preact.JSX.Element {
  const [active, setActive] = useState<"graph" | "log">("graph");

  return (
    <>
      <div id="tab-bar">
        <button
          type="button"
          class={`tab${active === "graph" ? " active" : ""}`}
          data-tab="graph"
          onClick={(): void => setActive("graph")}
        >
          Graph
        </button>
        <button
          type="button"
          class={`tab${active === "log" ? " active" : ""}`}
          data-tab="log"
          onClick={(): void => setActive("log")}
        >
          Log
        </button>
      </div>
      <div
        id="graph-panel"
        class={`panel${active === "graph" ? " active" : ""}`}
      >
        {graphPanel}
      </div>
      <div
        id="log-panel"
        class={`panel${active === "log" ? " active" : ""}`}
      >
        {logPanel}
      </div>
    </>
  );
}
