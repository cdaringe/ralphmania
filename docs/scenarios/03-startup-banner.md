# Scenario 3 – Startup Banner

**Spec:** The CLI SHALL display a startup banner showing the selected agent, iteration count, and model ladder (fast/general/strong tiers).

## Implementation

`printBanner` in `mod.ts:40-70` is called at startup (after config resolution, before the loop) and writes directly to `Deno.stdout`:

```
──────────────────────────────────────────────
  ralphmania v0.9.0
──────────────────────────────────────────────
  agent        claude
  iterations   10

  Model Ladder
  fast    → haiku    (default build)
  general → sonnet   (rework escalation)
  strong  → opus     (heavy rework)
──────────────────────────────────────────────
```

- **Agent**: shown as provided via `--agent` (or interactive prompt).
- **Iterations**: shown as provided via `--iterations`.
- **Model ladder**: all three tiers (`fast`/`general`/`strong`) resolved via `getModel()` from `src/model.ts` and displayed with their purpose annotations.

## Evidence

- `mod.ts:40-70` – `printBanner` function implementation.
- `mod.ts:98` – `printBanner({ agent, iterations })` called in `main()` before the loop starts.
- `src/model.ts:5-16` – `getModel()` returns per-agent model names for all three tiers.
