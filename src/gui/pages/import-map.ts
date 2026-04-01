/**
 * Shared import map entries for browser-loaded Preact and React.
 * Used by all page shells to avoid duplicating CDN URLs.
 * @module
 */

export const PREACT_IMPORTS: Record<string, string> = {
  "preact": "https://esm.sh/preact@10",
  "preact/": "https://esm.sh/preact@10/",
  "preact/hooks": "https://esm.sh/preact@10/hooks",
  "preact/jsx-runtime": "https://esm.sh/preact@10/jsx-runtime",
};

export const REACT_IMPORTS: Record<string, string> = {
  "react": "https://esm.sh/react@19",
  "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime",
  "react-dom": "https://esm.sh/react-dom@19",
  "react-dom/client": "https://esm.sh/react-dom@19/client",
};
