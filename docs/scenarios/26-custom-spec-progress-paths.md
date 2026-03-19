# Scenario 26: Custom Paths for specification.md and progress.md

**Status**: COMPLETE

## Requirement

> The plugin system SHALL support a custom path for `specification.md` and
> `progress.md`, allowing users to put files where they want.

## Implementation

### Plugin hook extension (`src/plugin.ts`)

`onConfigResolved` return type now includes optional `specFile` and
`progressFile` fields:

```ts
onConfigResolved?: (opts: { agent, iterations, log }) =>
  | { agent; iterations; specFile?: string; progressFile?: string }
  | Promise<{ ... }>;
```

A plugin returning these fields redirects all file I/O to the custom paths.

### Path propagation

The paths flow through the entire system from `mod.ts` down:

| Layer                 | Change                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mod.ts`              | Reads `specFile`/`progressFile` from `onConfigResolved` result; builds `FilePaths`; passes to `ensureProgressFile` and `runParallelLoop`              |
| `src/progress.ts`     | `ensureProgressFile(log, paths?)` accepts `FilePaths`; `DEFAULT_FILE_PATHS` exported for fallback                                                     |
| `src/orchestrator.ts` | `runParallelLoop` accepts `specFile?`/`progressFile?`; `readProgressContent` parameterized; both threaded to `runWorker`                              |
| `src/runner.ts`       | `runIteration` accepts `specFile?`/`progressFile?`; passes to `resolveModelSelection` and `buildPrompt`                                               |
| `src/model.ts`        | `resolveModelSelection` accepts `progressFile?` (defaults to `"./progress.md"`)                                                                       |
| `src/command.ts`      | `buildPrompt` accepts `specFile?`/`progressFile?`; uses `replaceAll` to rewrite `@specification.md` and `@progress.md` references in the agent prompt |

### Agent prompt rewriting

The `BASE_PROMPT` contains multiple `@specification.md` and `@progress.md`
references (Claude file-attachment syntax). When custom paths are set, all
occurrences are replaced so the agent reads the correct files:

```ts
BASE_PROMPT
  .replaceAll("@specification.md", `@${specFile ?? "specification.md"}`)
  .replaceAll("@progress.md", `@${progressFile ?? "progress.md"}`);
```

### Example plugin

```ts
export const plugin = {
  onConfigResolved({ agent, iterations }) {
    return {
      agent,
      iterations,
      specFile: "docs/my-spec.md",
      progressFile: "docs/my-progress.md",
    };
  },
};
```

## Tests

- **`test/command_test.ts`**: 4 new tests — custom `specFile`, custom
  `progressFile`, both together, and no custom paths (defaults unchanged).
- **`test/progress_test.ts`**: 3 new tests — `DEFAULT_FILE_PATHS` values,
  `ensureProgressFile` creates at custom path, appends rows to custom path.
- **`test/plugin_test.ts`**: 1 new test — `onConfigResolved` returns custom
  `specFile` and `progressFile`.

All 160 tests pass.
