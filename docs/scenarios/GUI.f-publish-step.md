# GUI.f — Publish step includes self-contained GUI bundle

## Scenario

"The publish step SHALL include the GUI compiled and fully contained"

## How it is satisfied

When the orchestrator loop completes with all scenarios VERIFIED, `mod.ts` calls
`publishContainedGui` (from `src/gui/publish.ts`) immediately after generating
evidence receipts.

Key call site in `mod.ts`:

```typescript
if (allDone) {
  const guiOutDir = path.join(RALPH_RECEIPTS_DIRNAME, "gui");
  const guiResult = await publishContainedGui({ outDir: guiOutDir, log });
  ...
}
```

`RALPH_RECEIPTS_DIRNAME` is `.ralph/receipts`, so the bundle lands at
`.ralph/receipts/gui/`.

## What `publishContainedGui` produces

`src/gui/publish.ts` compiles all island entry points with esbuild
(`npm:esbuild@~0.25.5`) in a single pass — `bundle: true, splitting: false` —
producing one self-contained ESM file per page. CSS is loaded from
`src/gui/css/*.css` and inlined. Preact is externalized and served from `esm.sh`
CDN via an inline `<script type="importmap">`. It writes:

- `index.html` — main orchestrator view
- `worker.html` — per-worker detail page
- `scenario.html` — per-scenario detail page
- `manifest.json` — includes `fullyContained: true` and `generatedAt` timestamp

No server-side compilation is required to view the output.

## Evidence

- Call site: `mod.ts` — `publishContainedGui` called when `allDone`
- Implementation: `src/gui/publish.ts` — esbuild-based single-pass compilation
- Tests: `src/gui/publish.test.ts`
  - happy path creates all four files
  - `manifest.json` has `fullyContained: true`
  - each HTML contains `<style>`, `<script type="importmap">`, and
    `<script type="module">`
  - returns `Err` when the output directory cannot be created
