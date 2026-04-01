/**
 * SSE provider island — boots a single EventSource connection and
 * dispatches events into the shared event-store.
 *
 * This is the top-level island on the main page. Other islands read
 * from the event-store module rather than opening their own connections.
 *
 * @module
 */
import { useEffect } from "preact/hooks";
import {
  dispatch,
  resetStore,
  setConnected,
  setHydrated,
} from "./event-store.ts";
import type { ComponentChildren } from "preact";

type Props = { readonly children?: ComponentChildren };

export default function SseProvider({ children }: Props): ComponentChildren {
  useEffect(() => {
    let es: EventSource;
    let reconnectTimer: number | undefined;

    const connect = (): void => {
      // Clear any stale UI state before starting a fresh initial sync.
      resetStore();
      es = new EventSource("/events");
      es.onopen = (): void => {
        setConnected(true);
        setHydrated(true);
      };
      es.onmessage = (e: MessageEvent): void => {
        try {
          dispatch(JSON.parse(e.data));
        } catch { /* malformed event */ }
      };
      es.onerror = (): void => {
        resetStore();
        es.close();
        reconnectTimer = setTimeout(connect, 3000) as unknown as number;
      };
    };

    connect();
    return (): void => {
      es?.close();
      clearTimeout(reconnectTimer);
      resetStore();
    };
  }, []);

  return <>{children}</>;
}
