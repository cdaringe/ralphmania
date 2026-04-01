import { TIMEOUT_MS, WORKER_IDLE_TIMEOUT_MS } from "./constants.ts";

export type TimeoutKind = "hard" | "idle";

export type IdleWatchdog = {
  readonly signal: AbortSignal;
  readonly touch: () => void;
  readonly stop: () => void;
  readonly timedOut: () => TimeoutKind | undefined;
};

/** Tracks worker output activity and aborts if no output arrives in time. */
export const createIdleWatchdog = (
  parentSignal: AbortSignal,
  opts?: {
    hardTimeoutMs?: number;
    idleTimeoutMs?: number;
  },
): IdleWatchdog => {
  const hardTimeoutMs = opts?.hardTimeoutMs ?? TIMEOUT_MS;
  const idleTimeoutMs = opts?.idleTimeoutMs ?? WORKER_IDLE_TIMEOUT_MS;
  const hardSignal = AbortSignal.timeout(hardTimeoutMs);
  const idleController = new AbortController();
  const combinedSignal = AbortSignal.any([
    parentSignal,
    hardSignal,
    idleController.signal,
  ]);

  let timeoutId = setTimeout(
    () => idleController.abort("idle-timeout"),
    idleTimeoutMs,
  );
  let timeoutKind: TimeoutKind | undefined;

  const syncTimeoutKind = (): void => {
    if (idleController.signal.aborted) {
      timeoutKind = "idle";
    } else if (hardSignal.aborted) {
      timeoutKind = "hard";
    }
  };

  idleController.signal.addEventListener("abort", syncTimeoutKind, {
    once: true,
  });
  hardSignal.addEventListener("abort", syncTimeoutKind, { once: true });

  return {
    signal: combinedSignal,
    touch: (): void => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(
        () => idleController.abort("idle-timeout"),
        idleTimeoutMs,
      );
    },
    stop: (): void => {
      clearTimeout(timeoutId);
    },
    timedOut: (): TimeoutKind | undefined => {
      syncTimeoutKind();
      return timeoutKind;
    },
  };
};
