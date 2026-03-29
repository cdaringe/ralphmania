/**
 * Connection status indicator island.
 * Shows "live" badge or pulsing disconnected overlay.
 * @module
 */
import { useEffect, useState } from "preact/hooks";
import { getConnected, subscribe } from "./event-store.ts";

export default function ConnectionStatus(): preact.JSX.Element {
  const [connected, setLocal] = useState(getConnected());
  useEffect(() => subscribe(() => setLocal(getConnected())), []);

  return (
    <>
      <span class={connected ? "badge" : "badge off"}>
        {connected ? "live" : "disconnected"}
      </span>
      {!connected && (
        <div id="conn-status">
          <span class="dot" />
          <span>connecting to server...</span>
        </div>
      )}
    </>
  );
}
