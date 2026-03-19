// coverage:ignore — Module-level Deno.stdout.isTerminal() prevents branch coverage in CI
/** ANSI color utilities with automatic TTY detection. */

const isTTY = Deno.stdout.isTerminal();

const wrap = (code: string, reset: string) =>
  isTTY ? (s: string) => `${code}${s}${reset}` : (s: string) => s;

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

export const bold = wrap(`${ESC}1m`, RESET);
export const dim = wrap(`${ESC}2m`, RESET);
export const italic = wrap(`${ESC}3m`, RESET);

export const red = wrap(`${ESC}31m`, RESET);
export const green = wrap(`${ESC}32m`, RESET);
export const yellow = wrap(`${ESC}33m`, RESET);
export const blue = wrap(`${ESC}34m`, RESET);
export const magenta = wrap(`${ESC}35m`, RESET);
export const cyan = wrap(`${ESC}36m`, RESET);
export const white = wrap(`${ESC}37m`, RESET);
export const gray = wrap(`${ESC}90m`, RESET);

export const bgCyan = wrap(`${ESC}46m`, RESET);
export const bgMagenta = wrap(`${ESC}45m`, RESET);
