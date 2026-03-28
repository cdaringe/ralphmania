// coverage:ignore — Re-exports from @cliffy/ansi; no branching logic to test
/** ANSI color utilities via @cliffy/ansi with automatic NO_COLOR support. */

import { colors } from "@cliffy/ansi/colors";

export const bold = (s: string): string => colors.bold(s);
export const dim = (s: string): string => colors.dim(s);
export const italic = (s: string): string => colors.italic(s);

export const red = (s: string): string => colors.red(s);
export const green = (s: string): string => colors.green(s);
export const yellow = (s: string): string => colors.yellow(s);
export const blue = (s: string): string => colors.blue(s);
export const magenta = (s: string): string => colors.magenta(s);
export const cyan = (s: string): string => colors.cyan(s);
export const white = (s: string): string => colors.white(s);
export const gray = (s: string): string => colors.brightBlack(s);

export const bgCyan = (s: string): string => colors.bgCyan(s);
export const bgMagenta = (s: string): string => colors.bgMagenta(s);
