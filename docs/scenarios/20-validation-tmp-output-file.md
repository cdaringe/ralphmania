# Scenario 20: Validation tmp output file

**Area:** UX
**Spec:** The system SHALL provide a tmp file for the validation script to write to, and IFF that file contains content on validation script exit, that file shall be used rather than the default stdio capture.

## Implementation

### `src/constants.ts`

Added `RALPH_OUTPUT_FILE_VAR = "RALPH_OUTPUT_FILE"` — the name of the environment variable injected into validation scripts. The `VALIDATE_TEMPLATE` comment now mentions this variable so new users discover it immediately.

### `src/validation.ts` — `runValidation`

Before spawning the validation subprocess, the function calls `Deno.makeTempFile()` to create a uniquely-named temp file. The path is injected into the child process via `RALPH_OUTPUT_FILE=<path>`.

After the subprocess exits:

1. The temp file is read; if its trimmed content is non-empty it **replaces** the iteration log (with ANSI stripped), and the tee-captured stdio log is discarded.
2. If the temp file is empty (or unwritten), the default stdio-captured log is kept unchanged.

The temp file is deleted via `Deno.remove` in both the success and error paths.

## Evidence

- **`src/validation_test.ts`** — 4 tests covering:
  - stdio capture used when script does not write to `$RALPH_OUTPUT_FILE`
  - `$RALPH_OUTPUT_FILE` content replaces stdio when the script writes to it
  - Validation still passes (exit 0) even when the file is written
  - ANSI escape codes are stripped from the tmp file content

All 105 tests pass (`deno test --allow-all`).
