/**
 * Shared HTML utility functions for GUI islands.
 * @module
 */

/** HTML-escape a string for safe insertion. */
export const escHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Format a timestamp as HH:MM:SS. */
export const fmtTime = (ts: number): string =>
  new Date(ts).toTimeString().slice(0, 8);
