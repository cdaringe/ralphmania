# Scenario 12 – User-Provided Plugins

**Status: COMPLETE**

## Requirement

The system SHALL support user-provided plugins (via `--plugin`) with hooks:
`onConfigResolved`, `onModelSelected`, `onPromptBuilt`, `onCommandBuilt`,
`onIterationEnd`, `onValidationComplete`, `onLoopEnd`.

## Implementation

### Plugin Interface

`src/plugin.ts` – `Plugin` type defines all seven optional hooks:

| Hook                   | Fires                                     | Can Modify                                                                                                 |
| ---------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `onConfigResolved`     | Before loop starts                        | `agent`, `iterations`, `level`, `parallel`, `gui`, `guiPort`, `resetWorktrees`, `specFile`, `progressFile` |
| `onModelSelected`      | Each iteration, after model resolution    | `ModelSelection`                                                                                           |
| `onPromptBuilt`        | Each iteration, after prompt construction | prompt string                                                                                              |
| `onCommandBuilt`       | Each iteration, after command spec built  | `CommandSpec`                                                                                              |
| `onIterationEnd`       | After agent subprocess exits              | observation only                                                                                           |
| `onValidationComplete` | After validation script runs              | `ValidationResult`                                                                                         |
| `onLoopEnd`            | After loop exits (any reason)             | observation only                                                                                           |

Each hook receives a `HookContext` (`{ agent, log, iterationNum }`) plus
hook-specific data.

### Loading

`src/plugin.ts` – `loadPlugin({ pluginPath, log })`:

- Accepts file paths, `file://`, `http://`, `https://`, `jsr:`, `npm:`
  specifiers.
- Relative file paths are resolved against `cwd()`.
- Uses dynamic `import()` and `resolvePlugin` to extract the named `plugin`
  export from the module: `export const plugin: Plugin = { ... }`.
- Returns `noopPlugin` (empty object) when no `--plugin` flag is given.

### Integration Points

`mod.ts`:

- `--plugin`/`-p` flag parsed by `parseCliArgsInteractive`.
- `loadPlugin` called before the loop; failure exits with code 1.
- `plugin.onConfigResolved` called to allow overriding any CLI config field
  (`agent`, `iterations`, `level`, `parallel`, `gui`, `guiPort`,
  `resetWorktrees`, `specFile`, `progressFile`). All return fields are optional;
  omitted fields keep the CLI-resolved value.
- `printBanner` and loop run with the (possibly overridden) config.

`src/runner.ts` – `runIteration` / `runLoopIteration`:

- `plugin.onModelSelected`, `onPromptBuilt`, `onCommandBuilt` applied in
  sequence.
- `plugin.onIterationEnd` called after each subprocess exits (including
  timeout).
- `plugin.onValidationComplete` applied to raw validation result.

`mod.ts` – after loop:
`plugin.onLoopEnd?.({ finalState, totalIterations, log })`.

### Example

```ts
import type { Plugin } from "@cdaringe/ralphmania";

export const plugin: Plugin = {
  onModelSelected({ selection, ctx }) {
    ctx.log({ tags: ["info", "plugin"], message: `Using ${selection.model}` });
    return selection;
  },
};
```

## Evidence

- `src/plugin.ts`: `Plugin`, `HookContext`, `loadPlugin`, `resolvePlugin`,
  `noopPlugin`
- `mod.ts`: `--plugin` flag, `loadPlugin`, `onConfigResolved`, `onLoopEnd`
- `src/runner.ts`: `onModelSelected`, `onPromptBuilt`, `onCommandBuilt`,
  `onIterationEnd`, `onValidationComplete`
