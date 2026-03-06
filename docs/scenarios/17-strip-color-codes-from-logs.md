# Scenario 17 – Validation logs are plain text (no color codes)

## Requirement

> When flushing results to disk, the system SHALL not record terminal color codes, ensuring logs are plain text.

## Implementation

**File:** `src/validation.ts` – `runValidation`

The `tee` WritableStream previously wrote raw bytes identically to both stdout
and the log file. ANSI escape sequences (colors, cursor movement) would
therefore appear verbatim in `.ralph/validation/iteration-{N}.log`.

The fix decodes each chunk as UTF-8, strips all CSI escape sequences with the
regex `/\x1b\[[0-9;]*[A-Za-z]/g`, re-encodes the cleaned text, and writes only
the clean bytes to the file. The original (color-bearing) chunk is still
forwarded to stdout/stderr so the terminal output is unchanged.

```ts
// src/validation.ts
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const stripAnsi = (text: string): string =>
  text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

const tee = (dest: typeof Deno.stdout) =>
  new WritableStream<Uint8Array>({
    write(chunk) {
      dest.writeSync(chunk);  // colors preserved for terminal
      file.writeSync(encoder.encode(stripAnsi(decoder.decode(chunk))));  // plain text on disk
    },
  });
```

## Evidence

- Regex covers standard SGR color codes (`\x1b[0m`, `\x1b[1;32m`, etc.) and
  cursor-movement sequences produced by common CLI tools.
- Terminal output is unaffected (colors still shown at runtime).
- Log files under `.ralph/validation/` will contain only printable text,
  suitable for agent consumption on the next iteration.
