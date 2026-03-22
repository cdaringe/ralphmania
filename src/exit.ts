/**
 * Compute the CLI exit code based on loop completion status.
 *
 * - 0: all scenarios VERIFIED (success)
 * - 1: iterations exhausted without all scenarios VERIFIED (failure, useful for CI/CD)
 *
 * Note: the abort exit code (130) is handled separately in the entry point.
 */
export const computeExitCode = (allDone: boolean): number => (allDone ? 0 : 1);
