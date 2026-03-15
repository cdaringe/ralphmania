# Scenario 21: serve receipts command

## Specification

> The CLI SHALL support a `serve receipts` command that serves the generated
> receipts in `.ralph/receipts/` as an http site and a `--open` flag that opens
> the browser.

## Implementation

### `src/serve.ts`

New module with two exports:

- **`parseServeArgs(rawArgs)`** — parses flags after `serve receipts`:
  `--open`/`-o` (boolean, default false) and `--port` (number, default 8421).
- **`serveReceipts(opts)`** — starts a `Deno.serve` HTTP server that statically
  serves files from `.ralph/receipts/` (or a custom `receiptsDir` for tests).
  Supports:
  - Root path `/` → `index.html` fallback
  - MIME type resolution for `.html`, `.css`, `.js`, `.json`, `.png`, `.jpg`,
    `.svg`, `.mp4`, `.webm`, etc.
  - `signal` parameter for graceful shutdown (used in tests)
  - `--open` triggers OS-native browser opener (`open` / `xdg-open` / `start`)

### `mod.ts` routing

Before entering the normal agentic loop, `import.meta.main` now checks:

```ts
if (Deno.args[0] === "serve" && Deno.args[1] === "receipts") {
  const { open, port } = parseServeArgs(Deno.args.slice(2));
  serveReceipts({ open, port });
}
```

This means `deno run -A mod.ts serve receipts` (optionally `--open`, `--port N`)
starts the HTTP server without entering the agentic loop.

## Usage

```sh
deno run -A mod.ts serve receipts            # serves on http://localhost:8421
deno run -A mod.ts serve receipts --open     # serves and opens browser
deno run -A mod.ts serve receipts --port 3000 --open
```

## Tests (`test/serve_test.ts`)

9 tests covering:

| Test                                 | Assertion                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `parseServeArgs defaults`            | `open=false`, `port=8421`                                                    |
| `parseServeArgs --open`              | `open=true`                                                                  |
| `parseServeArgs -o short flag`       | `open=true`                                                                  |
| `parseServeArgs --port 9000`         | `port=9000`                                                                  |
| `parseServeArgs --open --port 3000`  | both set                                                                     |
| `parseServeArgs invalid port`        | falls back to 8421                                                           |
| `serveReceipts serves files`         | `GET /index.html` → 200, body matches; `GET /` → 200 via index.html fallback |
| `serveReceipts 404 for missing file` | returns 404                                                                  |
| `serveReceipts correct MIME types`   | `.css` → `text/css`, `.js` → `text/javascript`                               |

All 9 pass: `ok | 9 passed | 0 failed`.
