/**
 * Connection status indicator island.
 * Shows "live" badge or pulsing disconnected overlay.
 * @module
 */
import { useEffect, useState } from "preact/hooks";
import { getConnected, getHydrated, subscribe } from "./event-store.ts";

export default function ConnectionStatus(): preact.JSX.Element {
  const [connected, setLocal] = useState(getConnected());
  const [hydrated, setHydrated] = useState(getHydrated());
  useEffect(
    () =>
      subscribe(() => {
        setLocal(getConnected());
        setHydrated(getHydrated());
      }, ["connection", "hydration"]),
    [],
  );

  const live = connected && hydrated;

  return (
    <>
      <span class={live ? "badge" : "badge off"}>
        {live ? "live" : connected ? "loading" : "disconnected"}
      </span>
      {!live && (
        <div id="conn-status">
          <span class="dot" />
          <span>
            {connected ? "loading current state..." : "reconnecting..."}
          </span>
        </div>
      )}
    </>
  );
}
