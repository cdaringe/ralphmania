# DOCSSITE.1 — Beautiful Concise Docs Site for GitHub Pages

## Scenario

> The project SHALL host a beautiful, concise docs site, for hosting on github
> pages.

## Implementation

### Static site generator

A Deno + Preact static site lives in `site/`:

| File                            | Role                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| `site/build.ts`                 | Build script; exports `buildSite(opts)` for testability               |
| `site/src/layout.tsx`           | Shared `Layout` HTML shell (nav, footer)                              |
| `site/src/styles.css`           | Full stylesheet — green (`#1da462`) accent, white/gray-50 backgrounds |
| `site/src/pages/index.tsx`      | Home: hero, feature cards, "how it works", CTAs                       |
| `site/src/pages/quickstart.tsx` | Quick start guide with code examples                                  |
| `site/src/pages/reference.tsx`  | CLI flags, plugin hooks, statuses, env vars                           |

Pages are rendered server-side via `preact-render-to-string` (already a project
dep) and written as plain `.html` files. No runtime JS required.

### Build process

```sh
deno run -A site/build.ts      # writes to site/dist/
deno task site:build           # alias in deno.json
```

`buildSite` accepts `{ outDir, srcDir }` for testability (temp dir in tests).

### GitHub Pages deployment

`.github/workflows/pages.yml` deploys on every push to `main` via the modern
Actions approach:

- **build** job: `deno run -A site/build.ts` → `actions/upload-pages-artifact`
  with `site/dist/`
- **deploy** job: `actions/deploy-pages` after `build`

Permissions: `pages: write` + `id-token: write`.

### Content

- **Home** (`index.html`): hero with install command, 4 feature cards (Iterative
  / Validated / Escalating / Extensible), 5-step "how it works", dual CTAs
- **Quick Start** (`quickstart.html`): installation, `specification.md` example,
  run commands, `progress.md` statuses, plugin example
- **Reference** (`reference.html`): all 5 CLI flags with short aliases, all 7
  plugin hooks with correct names (`onConfigResolved`…`onLoopEnd`), 5 progress
  statuses, environment variables

### Design

- CSS variables: `--accent: #1da462`, `--accent-light: #e8f8f0`, white &
  `--gray-50` backgrounds
- System font stack, `--font-mono` for code
- Responsive layout with sidebar on doc pages

### Tests

`test/site_build_test.ts` — 20 tests, all passing:

- File existence: `index.html`, `quickstart.html`, `reference.html`,
  `styles.css`
- DOCTYPE prefix on every HTML file
- Content assertions: install command, feature names, nav links, CLI flags, all
  7 plugin hooks, all 5 statuses, `ANTHROPIC_API_KEY`
- CSS accent color present

## Evidence

- `site/build.ts` exports `buildSite` matching `BuildOpts` type; CSS copied via
  `Deno.copyFile`
- `deno lint site/ test/site_build_test.ts` — no errors
- `deno task test test/site_build_test.ts` — 20/20 passed
- `.github/workflows/pages.yml` uses the standard
  `actions/upload-pages-artifact` + `actions/deploy-pages` pipeline
- `deno.json` task `"site:build": "deno run -A site/build.ts"` added
- `site/dist/` added to `.gitignore`
