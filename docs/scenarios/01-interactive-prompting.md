# Scenario 1 – Interactive Prompting for Missing CLI Input

**Status: COMPLETE**

## Requirement

The user SHALL be prompted interactively for any missing information needed to complete a task when running the CLI iff there are no defaults for that required input.

## Implementation

### parseCliArgsInteractive

`src/cli.ts` – `parseCliArgsInteractive(rawArgs)` handles resolution with interactive fallback:

1. Parses `--agent`/`-a` and `--iterations`/`-i` from args.
2. Checks `Deno.stdin.isTerminal()` to determine if a TTY is available.
3. **Agent**: if the parsed value is not a valid agent string:
   - Non-TTY → returns `err(USAGE)` immediately.
   - TTY → calls `promptSelect` to show a numbered menu of `VALID_AGENTS` with `"claude"` as default.
4. **Iterations**: if the parsed value is missing, NaN, or < 1:
   - Non-TTY → returns `err(USAGE)`.
   - TTY → calls `promptNumber` with default 10 and min 1.
5. `--plugin`/`-p` has no required constraint and is passed through as-is.

### Interactive Prompt Helpers

Both helpers write directly to `Deno.stdout` (bypassing any stream buffering) and read from `Deno.stdin`:

- `promptSelect({ message, options, defaultValue })` — renders a numbered list, highlights the default with color, accepts numeric index, option name, or empty input (uses default).
- `promptNumber({ message, defaultValue, min })` — accepts numeric input or empty (uses default), rejects values below `min`.

### TTY Guard

The `iff there are no defaults` clause is honored: `--agent` defaults to `"claude"` in `parseCliArgs` (the non-interactive variant), so that flag never triggers a prompt when the default suffices. `--iterations` has no default, so it always prompts when missing in a TTY context.

### Entry Point

`mod.ts` calls `parseCliArgsInteractive(Deno.args)` — the interactive variant — so users launching from a terminal get prompted; CI/piped invocations fail fast with the usage error.

## Evidence

- `src/cli.ts`: `parseCliArgsInteractive`, `promptSelect`, `promptNumber`, `readLine`
- `src/types.ts`: `CliConfig` type
- `mod.ts:91`: `const parsed = await parseCliArgsInteractive(Deno.args)`
