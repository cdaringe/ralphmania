// coverage:ignore — JSX UI component; tested via e2e
/**
 * Per-worker detail page. HTML shell + mount point. The worker-boot
 * island loads the full worker page app.
 * @module
 */

// deno-lint-ignore no-explicit-any
export const WorkerPage = (): any => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>ralphmania · worker</title>
      <link rel="stylesheet" href="/css/base.css" />
      <link rel="stylesheet" href="/css/sidebar.css" />
      <link rel="stylesheet" href="/css/log.css" />
      <link rel="stylesheet" href="/css/worker.css" />
      <script
        type="importmap"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            imports: {
              "preact": "https://esm.sh/preact@10",
              "preact/": "https://esm.sh/preact@10/",
              "preact/hooks": "https://esm.sh/preact@10/hooks",
              "preact/jsx-runtime": "https://esm.sh/preact@10/jsx-runtime",
            },
          }),
        }}
      />
    </head>
    <body>
      <div id="app-root" />
      <script type="module" src="/islands/worker-boot.js" />
    </body>
  </html>
);
