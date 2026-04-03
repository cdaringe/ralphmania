# DOCSSITE.3 — Site theme: light grays, white, green accents

## Scenario

> The site SHALL be themed with generally light grays and white, with green
> accents (use greens like the logo on cdaringe.com).

## Implementation

Theme is applied via a single CSS file: **`site/src/styles.css`**.

### Color tokens (`site/src/styles.css` `:root` block)

| Token                       | Value     | Role                                                 |
| --------------------------- | --------- | ---------------------------------------------------- |
| `--accent`                  | `#1da462` | Primary green (matches cdaringe.com logo)            |
| `--accent-dark`             | `#158a50` | Hover/focus darken                                   |
| `--accent-light`            | `#e8f8f0` | Tinted backgrounds (badges, callouts, hero gradient) |
| `--white`                   | `#ffffff` | Page backgrounds                                     |
| `--gray-50`                 | `#f9fafb` | Alternate section / table header tint                |
| `--gray-100`                | `#f3f4f6` | Inline code background                               |
| `--gray-200`                | `#e5e7eb` | Borders                                              |
| `--gray-400` – `--gray-900` | dark ramp | Text / footer only                                   |

### White/gray usage

- `body { background: var(--white) }` — pure white canvas
- `.nav { background: var(--white) }` — sticky nav is white
- `.section-alt { background: var(--gray-50) }` — alternating sections use
  lightest gray
- `.hero` — `linear-gradient(135deg, var(--gray-50), var(--accent-light))` —
  pale gray-to-green fade

### Green accent usage

- `.btn-primary` — solid green fill with white text
- `.step-num` circles — green fill
- `.nav-brand span`, `.hero h1 span` — brand name accent highlight
- `.callout` — left-border + tinted background in green
- `.sidebar-nav a:hover` — green highlight on hover
- `.flow-node--active` — active state nodes are green-tinted (DOCSSITE.2
  integration)

### How layout uses the stylesheet

Every page is rendered through `site/src/layout.tsx` which emits:

```html
<link rel="stylesheet" href="styles.css" />
```

`buildSite()` copies `styles.css` to `outDir` alongside the HTML files so the
link resolves correctly whether served locally or on GitHub Pages.

## Tests

`test/site_build_test.ts` — DOCSSITE.3 section (5 tests):

1. **white background** — asserts `--white: #ffffff` is defined
2. **light gray scale** — asserts `--gray-50:`, `--gray-100:`, `--gray-200:`
   exist
3. **green accent** — asserts `--accent: #1da462`, `--accent-dark:`,
   `--accent-light:` exist
4. **white/light body & nav** — asserts `background: var(--white)` and `.nav`
   selector
5. **index.html links stylesheet & renders theme classes** — asserts
   `styles.css` link, `btn-primary`, `hero`

Plus pre-existing tests:

- `styles.css contains accent color` — verifies `#1da462`
- All `buildSite generates *.html` tests verify the CSS file is copied
