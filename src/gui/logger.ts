/**
 * Logger wrapper that also emits log events to a GuiEventBus,
 * enabling the GUI to display live log output and orchestrator state.
 *
 * @module
 */
import type { Logger } from "../types.ts";
import type { GuiEventBus } from "./events.ts";

/** Pattern matching the orchestrator's state-transition log message: "from → to". */
const TRANSITION_RE = /^(\w+) \u2192 (\w+)$/;

/**
 * Returns a Logger that calls `base` for normal output and additionally:
 * - emits a `log` GuiEvent for every message
 * - emits a `state` GuiEvent when the message matches an orchestrator
 *   state-transition (`from → to` with the "transition" tag)
 */
export const createGuiLogger =
  (base: Logger, bus: GuiEventBus): Logger => (opts): void => {
    base(opts);
    const ts = Date.now();
    bus.emit({
      type: "log",
      level: opts.tags[0],
      tags: opts.tags,
      message: opts.message,
      ts,
    });
    // Emit an explicit state event for orchestrator transitions so the GUI
    // state panel updates even when debug logs are hidden.
    if (
      (opts.tags as string[]).includes("transition")
    ) {
      const m = opts.message.match(TRANSITION_RE);
      if (m !== null) {
        bus.emit({ type: "state", from: m[1], to: m[2], ts });
      }
    }
  };
