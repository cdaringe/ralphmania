import type { LoopCheckpoint } from "./types.ts";
import { LOOP_STATE_FILE } from "./constants.ts";

/**
 * Read the persisted loop checkpoint from disk.
 * Returns `undefined` if no checkpoint exists (fresh start).
 */
export const readLoopCheckpoint = async (): Promise<
  LoopCheckpoint | undefined
> => {
  try {
    const raw = await Deno.readTextFile(LOOP_STATE_FILE);
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" && parsed !== null &&
      typeof parsed.iterationsUsed === "number"
    ) {
      return {
        iterationsUsed: parsed.iterationsUsed,
        validationFailurePath: typeof parsed.validationFailurePath === "string"
          ? parsed.validationFailurePath
          : undefined,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Write the current loop checkpoint to disk so it can be restored on restart.
 * Overwrites any previous checkpoint atomically via a temp file.
 */
export const writeLoopCheckpoint = async (
  checkpoint: LoopCheckpoint,
): Promise<void> => {
  await Deno.mkdir(".ralph", { recursive: true });
  await Deno.writeTextFile(LOOP_STATE_FILE, JSON.stringify(checkpoint));
};

/** Remove the checkpoint file when the loop completes cleanly. */
export const clearLoopCheckpoint = async (): Promise<void> => {
  await Deno.remove(LOOP_STATE_FILE).catch(() => {});
};
