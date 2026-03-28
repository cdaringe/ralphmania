import type { ContentBlock, SDKMessage } from "../../types.ts";

const SDK_MESSAGE_TYPES: ReadonlySet<string> = new Set<SDKMessage["type"]>([
  "result",
  "system",
  "assistant",
  "stream_event",
  "tool_use_summary",
]);

/** Narrows parsed JSON to a known SDK streaming message. */
export const isSDKMessage = (v: unknown): v is SDKMessage =>
  typeof v === "object" && v !== null &&
  SDK_MESSAGE_TYPES.has((v as { type: string }).type);

/** Pull a short, human-readable hint from a tool_use input payload. */
const summarizeToolInput = (input: unknown): string => {
  if (typeof input !== "object" || input === null) return "";
  const rec = input as Record<string, unknown>;
  const filePath = typeof rec["file_path"] === "string"
    ? rec["file_path"]
    : typeof rec["path"] === "string"
    ? rec["path"]
    : undefined;
  const pattern = typeof rec["pattern"] === "string"
    ? rec["pattern"]
    : undefined;
  const command = typeof rec["command"] === "string"
    ? rec["command"]
    : undefined;
  const parts: string[] = [];
  if (filePath) parts.push(filePath);
  if (pattern) parts.push(`pattern=${pattern}`);
  if (command) {
    parts.push(command.length > 80 ? command.slice(0, 77) + "..." : command);
  }
  return parts.join(" ");
};

const formatToolUse = (
  b: Extract<ContentBlock, { type: "tool_use" }>,
): string => {
  const hint = summarizeToolInput(b.input);
  return hint ? `[tool: ${b.name}] ${hint}` : `[tool: ${b.name}]`;
};

/**
 * Extract displayable text from a parsed SDK streaming message.
 * Biases towards showing MORE output so the user sees activity.
 *
 * @see {@link https://platform.claude.com/docs/en/agent-sdk/typescript#message-types}
 */
export const extractSDKText = (raw: unknown): string | undefined => {
  if (!isSDKMessage(raw)) return undefined;
  switch (raw.type) {
    case "assistant": {
      const parts = raw.message.content.flatMap((b): string[] => {
        switch (b.type) {
          case "text":
            return b.text ? [b.text] : [];
          case "tool_use":
            return [formatToolUse(b)];
          case "thinking":
            return b.thinking ? [b.thinking] : [];
        }
      });
      return parts.join("\n") || undefined;
    }
    case "result":
      return raw.subtype === "success"
        ? raw.result
        : `[${raw.subtype}] ${raw.errors.join(", ")}`;
    case "tool_use_summary":
      return raw.summary;
    case "system":
      return `[system: ${raw.subtype}]`;
    default:
      return undefined;
  }
};
