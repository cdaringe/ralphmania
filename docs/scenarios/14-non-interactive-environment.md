# Scenario 14 – Non-Interactive Subprocess Environment

**Status: COMPLETE**

## Requirement

Agent and validation subprocesses SHALL run in a non-interactive environment
(`CI=true`, no git/ssh prompts, stdin null) to prevent hangs.

## Implementation

### Environment Overrides

`src/constants.ts` – `NON_INTERACTIVE_ENV_OVERRIDES`:

```ts
export const NON_INTERACTIVE_ENV_OVERRIDES: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
  SSH_BATCH_MODE: "yes",
  DEBIAN_FRONTEND: "noninteractive",
  CI: "true",
};
```

These suppress interactive prompts from git, ssh, gpg, and apt-family tools that
would otherwise open `/dev/tty` and hang indefinitely.

### Merged Environment Helper

```ts
export const nonInteractiveEnv = (): Record<string, string> => ({
  ...Deno.env.toObject(), // inherit parent env
  ...NON_INTERACTIVE_ENV_OVERRIDES, // override interactive vars
});
```

### Applied to All Subprocesses

Every subprocess spawned by ralphmania uses `nonInteractiveEnv()` and
`stdin: "null"`:

- **Agent subprocess** (`src/runner.ts` – `runIteration`):
  ```ts
  new Deno.Command(spec.command, {
    stdin: "null",
    env: {
      ...nonInteractiveEnv(),
      ...(effort ? { CLAUDE_CODE_EFFORT_LEVEL: effort } : {}),
    },
    signal: combinedSignal,
  }).spawn();
  ```

- **Validation subprocess** (`src/validation.ts` – `runValidation`): Uses
  `nonInteractiveEnv()` and `stdin: "null"`.

- **Receipts subprocess** (`src/runner.ts` – `updateReceipts`):
  ```ts
  new Deno.Command(spec.command, {
    stdin: "null",
    env: nonInteractiveEnv(),
  }).output();
  ```

## Evidence

- `src/constants.ts`: `NON_INTERACTIVE_ENV_OVERRIDES`, `nonInteractiveEnv`
- `src/runner.ts`: `runIteration` and `updateReceipts` both use
  `stdin: "null"` + `nonInteractiveEnv()`
- `src/validation.ts`: validation subprocess also uses `nonInteractiveEnv()`
