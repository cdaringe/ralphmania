# Scenario 24: Receipt Markdown Rendering

## Specification

The receipts SHALL ensure all markdown is properly rendered.

## Implementation

All three markdown content sections in generated receipts (requirement,
implementation, evidence) are now rendered via `markdown-it` client-side with
`highlight.js` syntax highlighting.

**Changes in `generate_receipts.ts`:**

1. **Requirement section** (`line ~211`): Changed from naive `\n` → `<br>`
   replacement to a proper `markdown-content` div with `id="requirement"`,
   matching the pattern used by implementation and evidence sections.
2. **Client-side script** (`line ~265`): Added `reqEl` rendering alongside
   `implEl` and `evidenceEl`, so all three sections call `md.render()`.
3. **markdown-it config**: Changed `html: false` → `html: true` to support
   embedded HTML within markdown content.

## Evidence References

- `generate_receipts.ts:211` — requirement div now has `id="requirement"` and
  `class="markdown-content"`
- `generate_receipts.ts:251` — markdown-it configured with `html: true`
- `generate_receipts.ts:265-269` — all three elements rendered via `md.render()`
- `test/generate_receipts_test.ts` — 5 tests asserting proper markdown rendering
  setup
