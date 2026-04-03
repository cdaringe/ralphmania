/**
 * Shared HTML shell layout for all static doc pages.
 * @module
 */
import type * as preact from "preact";

export type LayoutProps = {
  readonly title: string;
  readonly description: string;
  readonly children: preact.ComponentChildren;
};

export const Layout = ({
  title,
  description,
  children,
}: LayoutProps): preact.VNode => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="description" content={description} />
      <title>{`ralphmania · ${title}`}</title>
      <link rel="stylesheet" href="styles.css" />
    </head>
    <body>
      <nav class="nav">
        <div class="nav-inner">
          <a href="index.html" class="nav-brand">
            ralph<span>mania</span>
          </a>
          <ul class="nav-links">
            <li>
              <a href="quickstart.html">Quick Start</a>
            </li>
            <li>
              <a href="reference.html">Reference</a>
            </li>
            <li>
              <a href="https://github.com/cdaringe/ralphmania">GitHub</a>
            </li>
          </ul>
        </div>
      </nav>
      {children}
      <footer class="footer">
        <p>
          Built with <a href="https://deno.com">Deno</a> &amp;{" "}
          <a href="https://preactjs.com">Preact</a>. MIT licensed.
        </p>
      </footer>
    </body>
  </html>
);
