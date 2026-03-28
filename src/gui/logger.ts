/**
 * Logger wrapper that also emits log events to a GuiEventBus,
 * enabling the GUI to display live log output.
 *
 * @module
 */
import type { Logger } from "../types.ts";
import type { GuiEventBus } from "./events.ts";

/**
 * Returns a Logger that calls `base` for normal output and additionally
 * emits a `log` GuiEvent to `bus` for every message.
 */
export const createGuiLogger =
  (base: Logger, bus: GuiEventBus): Logger => (opts): void => {
    base(opts);
    bus.emit({
      type: "log",
      level: opts.tags[0],
      tags: opts.tags,
      message: opts.message,
      ts: Date.now(),
    });
  };
