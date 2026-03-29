/**
 * ANSI SGR escape sequence to HTML span converter.
 * Pure function — no side effects or DOM dependencies.
 * @module
 */

/** Standard + bright ANSI foreground color codes mapped to CSS hex colors. */
const ANSI_COLORS: Record<number, string> = {
  30: "#18181b",
  31: "#f87171",
  32: "#4ade80",
  33: "#fbbf24",
  34: "#60a5fa",
  35: "#c084fc",
  36: "#22d3ee",
  37: "#d4d4d8",
  90: "#71717a",
  91: "#fca5a5",
  92: "#86efac",
  93: "#fde68a",
  94: "#93c5fd",
  95: "#d8b4fe",
  96: "#67e8f9",
  97: "#f4f4f5",
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// deno-lint-ignore no-control-regex
const ANSI_RE = /\x1b\[([0-9;]*)m/g;

/**
 * Convert a string containing ANSI SGR escape sequences into HTML with
 * styled `<span>` elements. The input is HTML-escaped first, so the output
 * is safe for `innerHTML`.
 */
export const ansiToHtml = (raw: string): string => {
  const escaped = escapeHtml(raw);
  let result = "";
  let open = false;
  let last = 0;

  // Reset regex state for each call
  ANSI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANSI_RE.exec(escaped)) !== null) {
    result += escaped.slice(last, m.index);
    last = m.index + m[0].length;
    const codes = m[1].split(";").map(Number);
    for (const c of codes) {
      if (c === 0 || c === 39) {
        if (open) {
          result += "</span>";
          open = false;
        }
      } else if (c === 1) {
        if (open) result += "</span>";
        result += '<span style="font-weight:700">';
        open = true;
      } else if (c === 2) {
        if (open) result += "</span>";
        result += '<span style="opacity:.6">';
        open = true;
      } else if (ANSI_COLORS[c]) {
        if (open) result += "</span>";
        result += `<span style="color:${ANSI_COLORS[c]}">`;
        open = true;
      }
    }
  }
  result += escaped.slice(last);
  if (open) result += "</span>";
  return result;
};
