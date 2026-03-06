# Scenario 2: CLI Flags

**Spec:** The CLI SHALL accept `--agent` (`-a`), `--iterations` (`-i`), and
`--plugin` (`-p`) flags, supporting `claude` and `codex` as agent backends.

## Implementation

`src/cli.ts` — `parseArgs` from `jsr:@std/cli` parses all three flags with short
aliases:

```ts
parseArgs(rawArgs, {
  string: ["agent", "iterations", "plugin"],
  alias: { a: "agent", i: "iterations", p: "plugin" },
  default: { agent: "claude" },
});
```

Valid agents are constrained by `VALID_AGENTS = ["claude", "codex"] as const`
(`src/types.ts:1`), enforced via `isAgent()` guard in `cli.ts`.

Parsing rejects invalid agents or missing/non-positive iterations with a `USAGE`
error string.

## Evidence

- `src/cli.ts` — `parseCliArgs` and `parseCliArgsInteractive` both accept
  `-a`/`--agent`, `-i`/`--iterations`, `-p`/`--plugin`
- `src/types.ts` — `VALID_AGENTS = ["claude", "codex"]`
- `src/cli_test.ts` — 9 tests covering long flags, short flags, plugin path,
  default agent, missing iterations, invalid agent, zero/negative iterations
- `src/constants.ts` — `USAGE` string documents the expected invocation
