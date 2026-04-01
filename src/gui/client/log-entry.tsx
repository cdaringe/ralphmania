/**
 * Shared LogEntry component and message-caching helpers.
 * Used by log-panel, worker-modal, and worker-page-app islands.
 * @module
 */
import { escHtml, fmtTime } from "./html.ts";
import { ansiToHtml } from "./ansi.ts";

/** Minimal shape a log event must satisfy to render in LogEntry. */
export type LogEventLike = {
  readonly ts: number;
  readonly level: string;
  readonly tags: readonly string[];
  readonly message: string;
  readonly seq: number;
};

const TAG_CLS: Record<string, string> = {
  info: "t-info",
  error: "t-error",
  debug: "t-debug",
  orchestrator: "t-orch",
  validate: "t-validate",
  transition: "t-trans",
  user: "t-user",
  input: "t-input",
};

const messageHtmlCache = new WeakMap<LogEventLike, string>();
const tagsHtmlCache = new WeakMap<LogEventLike, string>();

/** Get cached ANSI-to-HTML conversion for a log event message. */
export const getMessageHtml = (ev: LogEventLike): string => {
  const cached = messageHtmlCache.get(ev);
  if (cached !== undefined) return cached;
  const html = ansiToHtml(ev.message);
  messageHtmlCache.set(ev, html);
  return html;
};

/** Get cached HTML for a log event's tag badges. */
export const getTagsHtml = (ev: LogEventLike): string => {
  const cached = tagsHtmlCache.get(ev);
  if (cached !== undefined) return cached;
  const html = ev.tags
    .map((t) => `<span class="${TAG_CLS[t] ?? ""}">${escHtml(t)}</span>`)
    .join('<span style="color:#3f3f46">:</span>');
  tagsHtmlCache.set(ev, html);
  return html;
};

type Props = {
  readonly ev: LogEventLike;
  readonly showTags?: boolean;
};

/** Renders a single log line — with or without tag badges. */
export function LogEntry({ ev, showTags }: Props): preact.JSX.Element {
  if (showTags) {
    return (
      <div class="le">
        <span class="le-ts">{fmtTime(ev.ts)}</span>
        <span
          class="le-tags"
          dangerouslySetInnerHTML={{ __html: `[${getTagsHtml(ev)}]` }}
        />
        <span
          class="le-msg"
          dangerouslySetInnerHTML={{ __html: getMessageHtml(ev) }}
        />
      </div>
    );
  }
  const isUser = ev.tags.includes("user");
  const cls = isUser
    ? "t-user"
    : ev.level === "error"
    ? "t-error"
    : ev.level === "debug"
    ? "t-debug"
    : "t-info";
  return (
    <div class={`le${isUser ? " le-user" : ""}`}>
      <span class="le-ts">{fmtTime(ev.ts)}</span>
      <span
        class={`le-msg ${cls}`}
        dangerouslySetInnerHTML={{ __html: getMessageHtml(ev) }}
      />
    </div>
  );
}
