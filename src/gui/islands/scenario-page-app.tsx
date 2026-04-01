/**
 * Self-contained island for the per-scenario detail page (/scenario/:id).
 *
 * Fetches scenario detail from `/api/scenario/:id` and renders the
 * specification description alongside the current progress status.
 * Includes a form to mark the scenario as NEEDS_REWORK with notes.
 *
 * @module
 */
import { useEffect, useReducer } from "preact/hooks";

type ScenarioDetail = {
  readonly id: string;
  readonly area: string;
  readonly description: string;
  readonly status: string;
  readonly summary: string;
  readonly reworkNotes: string;
};

type State =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | {
    readonly phase: "loaded";
    readonly detail: ScenarioDetail;
    readonly reworkText: string;
    readonly saving: boolean;
    readonly saveMessage: string;
  };

type Action =
  | { readonly type: "loaded"; readonly detail: ScenarioDetail }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "set_rework_text"; readonly text: string }
  | { readonly type: "save_start" }
  | { readonly type: "save_done"; readonly detail: ScenarioDetail }
  | { readonly type: "save_error"; readonly message: string };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "loaded":
      return {
        phase: "loaded",
        detail: action.detail,
        reworkText: action.detail.reworkNotes,
        saving: false,
        saveMessage: "",
      };
    case "error":
      return { phase: "error", message: action.message };
    case "set_rework_text":
      return state.phase === "loaded"
        ? { ...state, reworkText: action.text }
        : state;
    case "save_start":
      return state.phase === "loaded"
        ? { ...state, saving: true, saveMessage: "" }
        : state;
    case "save_done":
      return state.phase === "loaded"
        ? {
          ...state,
          detail: action.detail,
          reworkText: action.detail.reworkNotes,
          saving: false,
          saveMessage: "saved",
        }
        : state;
    case "save_error":
      return state.phase === "loaded"
        ? { ...state, saving: false, saveMessage: action.message }
        : state;
  }
};

const statusBadgeClass = (status: string): string => {
  const key = status.toLowerCase().replace(/_/g, "-");
  return `status-badge sb-${key}`;
};

const getScenarioId = (): string => {
  const parts = globalThis.location?.pathname.split("/") ?? [];
  return decodeURIComponent(parts[parts.length - 1] ?? "");
};

const fetchDetail = (id: string): Promise<ScenarioDetail> =>
  fetch(`/api/scenario/${encodeURIComponent(id)}`).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

const patchScenario = (
  id: string,
  body: { status: string; reworkNotes: string },
): Promise<{ ok: boolean; error?: string }> =>
  fetch(`/api/scenario/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

export default function ScenarioPageApp(): preact.JSX.Element {
  const scenarioId = getScenarioId();
  const [state, dispatch] = useReducer(reducer, { phase: "loading" });

  useEffect(() => {
    // deno-lint-ignore no-undef
    document.title = `ralphmania \u00b7 ${scenarioId}`;
    fetchDetail(scenarioId)
      .then((detail) => dispatch({ type: "loaded", detail }))
      .catch((e) => dispatch({ type: "error", message: String(e) }));
  }, [scenarioId]);

  const submitRework = (): void => {
    if (state.phase !== "loaded" || state.saving) return;
    dispatch({ type: "save_start" });
    patchScenario(scenarioId, {
      status: "NEEDS_REWORK",
      reworkNotes: state.reworkText,
    })
      .then((res) => {
        if (!res.ok) {
          dispatch({ type: "save_error", message: res.error ?? "unknown" });
          return;
        }
        // Re-fetch to show updated state.
        return fetchDetail(scenarioId).then((detail) =>
          dispatch({ type: "save_done", detail })
        );
      })
      .catch((e) => dispatch({ type: "save_error", message: String(e) }));
  };

  return (
    <>
      <header>
        <h1>ralphmania</h1>
        <a class="back" href="/">&larr; overview</a>
        <span style="font-size:13px;color:var(--muted)">
          scenario &middot; {scenarioId}
        </span>
      </header>
      <main style="display:block;overflow-y:auto">
        {state.phase === "loading" && (
          <div class="detail-card" style="color:var(--muted)">Loading...</div>
        )}
        {state.phase === "error" && (
          <div class="detail-card" style="color:var(--error)">
            {state.message}
          </div>
        )}
        {state.phase === "loaded" && (
          <>
            <div class="detail-card">
              <div class="detail-row">
                <span class="detail-label">ID</span>
                <span class="detail-value" style="font-weight:700">
                  {state.detail.id}
                </span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Area</span>
                <span class="detail-value">{state.detail.area}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Status</span>
                <span class={statusBadgeClass(state.detail.status)}>
                  {state.detail.status}
                </span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Description</span>
              </div>
              <div class="detail-desc">{state.detail.description}</div>
              {state.detail.summary && (
                <>
                  <div class="detail-row">
                    <span class="detail-label">Summary</span>
                  </div>
                  <div
                    class="detail-value"
                    style="padding:0 4px"
                    dangerouslySetInnerHTML={{
                      __html: linkifyMarkdownLinks(state.detail.summary),
                    }}
                  />
                </>
              )}
              {state.detail.reworkNotes && (
                <div class="detail-row">
                  <span class="detail-label">Rework Notes</span>
                  <span class="detail-value">{state.detail.reworkNotes}</span>
                </div>
              )}
            </div>

            <div class="rework-form">
              <h3>Mark as Needs Rework</h3>
              <textarea
                value={state.reworkText}
                onInput={(e): void =>
                  dispatch({
                    type: "set_rework_text",
                    text: (e.target as HTMLTextAreaElement).value,
                  })}
                placeholder="Describe what needs to be reworked..."
              />
              <div class="rework-actions">
                <button
                  type="button"
                  class="rework-btn danger"
                  disabled={state.saving}
                  onClick={submitRework}
                >
                  {state.saving ? "Saving..." : "Mark NEEDS_REWORK"}
                </button>
                <span
                  class={`rework-status${
                    state.saveMessage && state.saveMessage !== "saved"
                      ? " error"
                      : ""
                  }`}
                >
                  {state.saveMessage}
                </span>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}

/** Convert `[text](url)` markdown links to `<a>` tags. */
const linkifyMarkdownLinks = (text: string): string =>
  text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" style="color:var(--accent)" target="_blank">$1</a>',
  );
