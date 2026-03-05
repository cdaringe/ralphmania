# ralphmania

Run an AI agent in a loop until a specification is complete. Essentially, tell
`ralphmania`, "Here are my goals, do work until everything is done and
verified."

```bash
deno run -A jsr:@cdaringe/ralphmania -i 10
deno run -A jsr:@cdaringe/ralphmania -i 10 [-a claude|codex]
deno run -A jsr:@cdaringe/ralphmania -i 10 --plugin ./my-plugin.ts
```

- ✅ Good for projects where the specifications are evolving or not fully baked.
- ❌ Bad for projects with firm or static specifications.

<details>
<summary>What makes `ralphmania` different from naive-ralphing?</summary>

A basic "ralph loop" is great for one shot development. However, `ralphmania` is
designed for iterative development. Specifically, it has strong support for:

1. **REWORK** - letting the user update the the task tracking document
   (progress.md) if a specification has been refined or has not implemented per
   expectation.
2. **VERIFICATION** - a step that analyzes the intent of the coding work against
   the actual output. Can be skipped.
3. **VALIDATION** - a user-defined validation hook that can be as simple or
   complex as needed, with support for test scripts, static analysis, or manual
   review. Validation results are fed back into the loop to guide rework or
   escalation decisions.
4. **ESCALATION** - automatically switching to a stronger model when rework is
   detected, but scoping that escalation to just the failing scenarios to save
   on tokens and cost.
5. **PLUGINS** - support for changing the default flow if you want to tune
   default behaviors!

</details>

## How it works

1. Write a `specification.md` with scenarios
2. Run ralphmania -- it iterates an AI agent, tracking progress in `progress.md`
3. Each iteration is validated via `specification.validate.sh` (user tunable,
   created on first run)
4. Review `progress.md` between runs -- mark scenarios as `VERIFIED` or
   `NEEDS_REWORK` to request fixes
5. When rework is detected, ralphmania escalates to stronger models, scoped to
   failing scenarios

## Example

**specification.md:**

Write a specification document _like_ the following:

```md
## Scenarios

| # | Scenario  | Description                   |
| - | --------- | ----------------------------- |
| 1 | Auth      | Add login/logout with JWT     |
| 2 | Dashboard | Show user stats on /dashboard |
```

Try to append only. Mark invalid scenarios `REMOVED`.

**progress.md** (managed by the agent, editable by you):

```md
| # | Status       | Summary                     | Rework notes         |
| - | ------------ | --------------------------- | -------------------- |
| 1 | VERIFIED     | docs/scenarios/auth.md      |                      |
| 2 | NEEDS_REWORK | docs/scenarios/dashboard.md | missing error states |
```

Set a scenario to `NEEDS_REWORK` with notes and ralphmania will direct the agent
to fix it, escalating to a stronger model if rework persists. The agent
verification step will do this sometimes, or you the user may do this at the end
of an iteration cycle!

## Plugins

```typescript
import type { Plugin } from "jsr:@cdaringe/ralphmania";

const plugin: Plugin = {
  onPromptBuilt({ prompt }) {
    return prompt + "\nAlways use TypeScript.";
  },
};

export { plugin };
```

Hooks: `onConfigResolved`, `onModelSelected`, `onPromptBuilt`, `onCommandBuilt`,
`onIterationEnd`, `onValidationComplete`, `onLoopEnd`.
