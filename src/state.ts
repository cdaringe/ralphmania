import type { LoopCheckpoint, LoopStep } from "./types.ts";
import { LOOP_STATE_FILE } from "./constants.ts";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const VALID_STEPS = new Set<string>(["agent", "validate", "rectify", "done"]);

const parseCheckpoint = (raw: string): LoopCheckpoint | undefined => {
  const parsed: unknown = JSON.parse(raw);
  return isRecord(parsed) &&
      typeof parsed.iterationsUsed === "number" &&
      typeof parsed.step === "string" &&
      VALID_STEPS.has(parsed.step)
    ? {
      iterationsUsed: parsed.iterationsUsed,
      step: parsed.step as LoopStep,
      validationFailurePath: typeof parsed.validationFailurePath === "string"
        ? parsed.validationFailurePath
        : undefined,
    }
    : undefined;
};

/**
 * Read the persisted loop checkpoint from disk.
 * Returns `undefined` if no checkpoint exists (fresh start).
 */
export const readLoopCheckpoint = (): Promise<LoopCheckpoint | undefined> =>
  Deno.readTextFile(LOOP_STATE_FILE)
    .then(parseCheckpoint)
    .catch((): undefined => undefined);

/**
 * Write the current loop checkpoint to disk so it can be restored on restart.
 */
export const writeLoopCheckpoint = (
  checkpoint: LoopCheckpoint,
): Promise<void> =>
  Deno.mkdir(".ralph", { recursive: true })
    .then(() =>
      Deno.writeTextFile(LOOP_STATE_FILE, JSON.stringify(checkpoint))
    );

/** Remove the checkpoint file when the loop completes cleanly. */
export const clearLoopCheckpoint = (): Promise<void> =>
  Deno.remove(LOOP_STATE_FILE).catch(() => {});
