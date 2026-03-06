# Scenario 6 — Auto-create `specification.validate.sh`

**Spec:** The system SHALL auto-create `specification.validate.sh` with a
placeholder on first run if it does not exist, and halt until the user fills it
in.

## Implementation

### 1. Detection + creation (`src/validation.ts`)

`ensureValidationHook` checks for the file's existence via `Deno.stat`. If
absent it writes the template, marks it executable (`chmod 0o755`), logs an info
message, and returns `err(...)`:

```ts
// src/validation.ts
export const ensureValidationHook = async (log) => {
  const exists = await Deno.stat(VALIDATE_SCRIPT).then(() => true, () => false);
  if (exists) return ok(undefined);
  await Deno.writeTextFile(VALIDATE_SCRIPT, VALIDATE_TEMPLATE);
  await Deno.chmod(VALIDATE_SCRIPT, 0o755);
  log({
    tags: ["info", "hook"],
    message:
      `Created ${VALIDATE_SCRIPT}. Fill in your validation logic and re-run.`,
  });
  return err(
    `${VALIDATE_SCRIPT} created — fill in validation logic before re-running.`,
  );
};
```

### 2. Placeholder template (`src/constants.ts`)

`VALIDATE_TEMPLATE` is a `#!/usr/bin/env bash` script with `set -euo pipefail`,
a TODO comment, and `exit 1` so the system halts immediately:

```sh
#!/usr/bin/env bash
set -euo pipefail
# Validates that specification requirements are met.
# Fill in your validation logic below.
# Exit 0 on success, non-zero on failure.
# stdout/stderr will be captured and provided to the agent on failure.
echo "TODO: implement validation checks"
exit 1
```

### 3. Halt enforcement (`mod.ts`)

`main()` calls `ensureValidationHook` and checks its `Result`. An `err` result
logs the message and exits with code `1`, halting the loop before any agent
iteration runs:

```ts
// mod.ts lines 114-118
const hookResult = await ensureValidationHook(log);
if (!hookResult.ok) {
  log({ tags: ["error"], message: hookResult.error });
  return 1;
}
```

## Evidence

| Concern                         | Location                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| File existence check + creation | `src/validation.ts` `ensureValidationHook`                                              |
| Executable placeholder template | `src/constants.ts` `VALIDATE_TEMPLATE`, `VALIDATE_SCRIPT = "specification.validate.sh"` |
| Halt on missing/unfilled script | `mod.ts` lines 114–118                                                                  |

The `exit 1` in the template ensures a freshly-created (unfilled) script always
causes the system to treat validation as failed, effectively halting progress
until the user replaces it with real checks.
