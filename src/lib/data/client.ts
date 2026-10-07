"use client";

// De ene LiveDataStore van de browser plus de globale luisteraars (focus,
// zichtbaarheid, netwerk, app hervat, Socket.io). Alle dynamische data in de
// app loopt hierdoor; zie docs/DATA-REFRESH.md. Componenten gebruiken de
// hooks (useLiveQuery, LiveRefresh) en liveMutation, niet dit bestand direct.
import { getSocket } from "@/lib/socketClient";
import { LiveDataStore, type LiveEnvironment } from "./store";
import { DATA_EVENT_SOCKET_NAME, SOCKET_EVENT_TO_DATA_EVENT, isDataEvent, type DataEvent, type DataScope } from "./scopes";

const browserEnvironment: LiveEnvironment = {
  now: () => Date.now(),
  isVisible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
  isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
  random: () => Math.random(),
  schedule: (fn, ms) => {
    const id = window.setTimeout(fn, ms);
    return () => window.clearTimeout(id);
  },
};

export const liveData = new LiveDataStore(browserEnvironment);

/** Spreiding van realtime-verversingen, zodat niet iedereen op dezelfde milliseconde ophaalt. */
const REALTIME_JITTER_MS = 1_500;
/** Eén klokslag voor alle polling; loopt alleen zolang de tab zichtbaar is. */
const TICK_MS = 15_000;

/** Maakt datasets ongeldig na een eigen actie of een signaal; zie DATA_EVENTS in scopes.ts. */
export function invalidateData(target: DataEvent | readonly DataScope[]): void {
  liveData.invalidate(target);
}

/**
 * Start de globale luisteraars. Eén keer aanroepen (LiveDataProvider);
 * geeft de opruimfunctie terug.
 */
export function startLiveDataListeners(): () => void {
  const cleanups: Array<() => void> = [];
  const listen = (target: Window | Document, type: string, handler: (event: Event) => void) => {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };

  let ticker: number | null = null;
  const startTicker = () => {
    if (ticker === null) ticker = window.setInterval(() => liveData.tick(), TICK_MS);
  };
  const stopTicker = () => {
    if (ticker !== null) window.clearInterval(ticker);
    ticker = null;
  };
  cleanups.push(stopTicker);
  if (browserEnvironment.isVisible()) startTicker();

  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "visible") {
      startTicker();
      liveData.revalidate();
    } else {
      stopTicker();
    }
  });
  listen(window, "focus", () => liveData.revalidate());
  // bfcache: de pagina komt terug uit het geheugen zonder iets te laden.
  listen(window, "pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted) liveData.revalidate({ force: true });
  });
  listen(window, "online", () => liveData.revalidate({ force: true }));
  // Native app (Capacitor) vanuit de achtergrond terug; zie NativeAppBridge.
  listen(window, "versado:app-resumed", () => liveData.revalidate({ force: true }));

  // Realtime: de server stuurt alleen wát er veranderd is, nooit de gegevens.
  const socket = getSocket();
  let connectedBefore = socket.connected;
  const onConnect = () => {
    // Na een herverbinding kan er van alles gemist zijn.
    if (connectedBefore) liveData.revalidate({ force: true });
    connectedBefore = true;
  };
  const onDataEvent = (payload: unknown) => {
    const event = (payload as { event?: unknown } | null)?.event;
    if (isDataEvent(event)) liveData.invalidate(event, { jitterMs: REALTIME_JITTER_MS });
  };
  socket.on("connect", onConnect);
  socket.on(DATA_EVENT_SOCKET_NAME, onDataEvent);
  cleanups.push(() => {
    socket.off("connect", onConnect);
    socket.off(DATA_EVENT_SOCKET_NAME, onDataEvent);
  });
  // Gebeurtenissen die de server al per gebruiker stuurt (eigen apparaten, vrienden, meldingen).
  for (const [socketEvent, dataEvent] of Object.entries(SOCKET_EVENT_TO_DATA_EVENT)) {
    const handler = () => liveData.invalidate(dataEvent);
    socket.on(socketEvent, handler);
    cleanups.push(() => socket.off(socketEvent, handler));
  }

  return () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
}
