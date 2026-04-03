# GUI.f — Publish step includes self-contained GUI bundle

## Scenario

"The publish step SHALL include the GUI compiled and fully contained"

## How it is satisfied

When the orchestrator loop completes with all scenarios VERIFIED, `mod.ts` calls
`publishContainedGui` (from `src/gui/publish.ts`) which produces standalone HTML
pages with **all JS and CSS inlined** — no CDN, importmap, or external
dependencies required at runtime.

Call site in `mod.ts`:

```typescript
if (allDone) {
  const guiOutDir = path.join(RALPH_RECEIPTS_DIRNAME, "gui");
  const guiResult = await publishContainedGui({ outDir: guiOutDir, log });
}
```

## What `publishContainedGui` produces

`src/gui/publish.ts` compiles all island entry points via esbuild
(`npm:esbuild@~0.25.5`) in a single pass —
`bundle: true, splitting: false,
minify: true`. Preact is **bundled inline** via
a `denoNpmBundlePlugin` that resolves `preact` imports to their Deno npm cache
paths using `import.meta.resolve()`. CSS from `src/gui/css/*.css` is
concatenated and inlined in a `<style>` tag. Output:

- `index.html` — main orchestrator view
- `worker.html` — per-worker detail page
- `scenario.html` — per-scenario detail page
- `manifest.json` — `{ fullyContained: true, generatedAt, assets }`

No server, CDN, or importmap needed to view the output — fully offline-capable.

## Evidence

- Call site: `mod.ts` line ~304 — `publishContainedGui` called when `allDone`
- Implementation: `src/gui/publish.ts` — `denoNpmBundlePlugin` resolves preact
  to file paths; no `external` config
- Co-located tests: `src/gui/publish.test.ts` (4 tests) — happy path, manifest
  check, self-contained assertion (no importmap), error case
- Integration test: `test/gui_publish_test.ts` — asserts no importmap, no
  external URLs, app-root present
- E2E test: `test/gui_publish_e2e_test.ts` — serves published output as static
  site, verifies all pages load
