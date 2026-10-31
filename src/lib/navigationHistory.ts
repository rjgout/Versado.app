"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { safeContentLocation } from "@/lib/contentPickerContract";

// Gedeelde navigatiestaat voor de hele app: scrollposities per
// geschiedenisitem (gebruikt door shell/NavigationScroll.tsx) en of er een
// bruikbare vorige pagina binnen de app is (gebruikt door elke terugknop).
//
// Een geschiedenisitem herkennen we aan de sleutel van de Navigation API
// (`navigation.currentEntry.key`): die blijft gelijk bij replaceState, ook
// wanneer Next.js zijn eigen state in het item overschrijft. Browsers zonder
// die API vallen terug op het adres; dan deelt hetzelfde adres op twee
// plekken in de geschiedenis één scrollpositie.

interface NavigationEntryLike {
  key: string;
}

interface NavigateEventLike {
  navigationType: "push" | "replace" | "reload" | "traverse";
  destination: { key: string; url: string };
}

interface NavigationLike {
  currentEntry: NavigationEntryLike | null;
  canGoBack: boolean;
  addEventListener(type: "navigate", listener: (event: NavigateEventLike) => void): void;
  removeEventListener(type: "navigate", listener: (event: NavigateEventLike) => void): void;
}

function navigationApi(): NavigationLike | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { navigation?: NavigationLike }).navigation;
  return api && api.currentEntry ? api : null;
}

export { currentEntryKey } from "./navigationEntry";
import { currentEntryKey } from "./navigationEntry";

const CONTENT_DEPARTURE_KEY = "vs-content-departure";
interface ContentDeparture {
  sessionKey: string;
  originEntryKey: string;
  pickerEntryKey: string | null;
  createdAt: number;
  scrollPosition?: number;
  location: { pathname: string; search: string };
}
let contentDeparture: ContentDeparture | null = null;

/** NavigationScroll bindt een aangevraagde kiezer alleen bij de echte routeovergang. */
export function bindContentDepartureEntry(previousPathname: string, pathname: string): void {
  try {
    const raw = contentDeparture ?? JSON.parse(window.sessionStorage.getItem(CONTENT_DEPARTURE_KEY) ?? "null") as ContentDeparture | null;
    if (!raw || raw.pickerEntryKey) return;
    if (pathname !== "/content" || raw.location?.pathname !== previousPathname || Date.now() - raw.createdAt > 30_000) {
      contentDeparture = null; window.sessionStorage.removeItem(CONTENT_DEPARTURE_KEY); return;
    }
    // Een late scroll/layoutmeting van de vertrekkende pagina mag het
    // bij linkactivatie vastgelegde vertrekpunt niet overschrijven.
    // Oudere opgeslagen entries zonder positie blijven compatibel.
    if (typeof raw.scrollPosition === "number" && Number.isFinite(raw.scrollPosition) && raw.scrollPosition >= 0) saveScrollPosition(raw.originEntryKey, raw.scrollPosition);
    raw.pickerEntryKey = currentEntryKey(); contentDeparture = raw;
    window.sessionStorage.setItem(CONTENT_DEPARTURE_KEY, JSON.stringify(raw));
  } catch { /* Opslag kan geblokkeerd zijn; de gebonden geheugenwaarde blijft. */ }
}

/** Voor de linknavigatie vastleggen; geen retouradres of gevoelige query in de URL. */
export function rememberContentDeparture(sessionKey: string, input: { pathname: string; search: string }): void {
  const location = safeContentLocation(input);
  if (!location) return;
  contentDeparture = { sessionKey, originEntryKey: currentEntryKey(), pickerEntryKey: null, createdAt: Date.now(), scrollPosition: window.scrollY, location };
  saveScrollPosition(contentDeparture.originEntryKey, window.scrollY);
  try { window.sessionStorage.setItem(CONTENT_DEPARTURE_KEY, JSON.stringify(contentDeparture)); } catch { /* Geheugenfallback. */ }
}

/** Alleen deze geschiedenis-entry, tab en geauthenticeerde sessie kunnen de keuze hernemen. */
export function contentDepartureLocation(sessionKey: string): { pathname: string; search: string } {
  const fallback = { pathname: "/dashboard", search: "" };
  try {
    const raw = contentDeparture ?? JSON.parse(window.sessionStorage.getItem(CONTENT_DEPARTURE_KEY) ?? "null") as ContentDeparture | null;
    if (!raw || raw.sessionKey !== sessionKey || Date.now() - raw.createdAt > 30 * 60_000 || raw.createdAt > Date.now() || !safeContentLocation(raw.location)) return fallback;
    const key = currentEntryKey();
    if (!raw.pickerEntryKey || raw.pickerEntryKey !== key) return fallback;
    contentDeparture = raw;
    try { window.sessionStorage.setItem(CONTENT_DEPARTURE_KEY, JSON.stringify(raw)); } catch { /* Geheugenfallback. */ }
    return safeContentLocation(raw.location) ?? fallback;
  } catch { return fallback; }
}

/**
 * Meldt terug/vooruit zodra het begint, met het item waar het heen gaat.
 * Eerder dan popstate: React zet de pagina van dat item binnen de
 * popstate-afhandeling van Next.js al synchroon neer. Geeft null zonder
 * Navigation API; dan blijft alleen popstate over.
 */
export function onTraverseStart(handler: (destinationKey: string, destinationUrl: URL) => void): (() => void) | null {
  const api = navigationApi();
  if (!api) return null;
  const listener = (event: NavigateEventLike) => {
    if (event.navigationType === "traverse") handler(`k:${event.destination.key}`, new URL(event.destination.url));
  };
  api.addEventListener("navigate", listener);
  return () => api.removeEventListener("navigate", listener);
}

const STORAGE_KEY = "vs-scroll-positions";
const MAX_ENTRIES = 150;
let positions: Map<string, number> | null = null;
let persistTimer: number | null = null;

function store(): Map<string, number> {
  if (positions) return positions;
  positions = new Map();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) for (const [key, value] of JSON.parse(raw) as [string, number][]) positions.set(key, value);
  } catch {
    // Geblokkeerde opslag: dan alleen in het geheugen, tot een herlaadbeurt.
  }
  return positions;
}

export function persistScrollPositions() {
  if (!positions) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...positions.entries()]));
  } catch {
    // Zie store().
  }
}

export function saveScrollPosition(key: string, y: number) {
  const map = store();
  // Opnieuw invoegen zet de sleutel achteraan, zodat de oudste eruit valt.
  map.delete(key);
  map.set(key, y);
  if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value as string);
  if (persistTimer !== null) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persistScrollPositions, 300);
}

export function savedScrollPosition(key: string): number | null {
  return store().get(key) ?? null;
}

// Aantal navigaties binnen de app sinds dit document geladen is; alleen
// nodig als terugval voor browsers zonder Navigation API.
let inAppNavigations = 0;

export function noteInAppNavigation() {
  inAppNavigations += 1;
}

/**
 * Is er een vorige pagina binnen de app om naar terug te gaan? Niet bij een
 * rechtstreeks geopende link in een nieuw tabblad of vanaf een andere site:
 * de Navigation API telt alleen items van dezelfde oorsprong.
 */
export function canGoBackInApp(): boolean {
  const api = navigationApi();
  if (api) return api.canGoBack;
  return inAppNavigations > 0;
}

/** Een expliciete semantische parent wint van toevallige browserhistorie. */
export function shouldUseFallback(canGoBack: boolean, forceFallback = false): boolean {
  return forceFallback || !canGoBack;
}

/**
 * Terug zoals de terugknop van de browser. Alleen zonder bruikbare vorige
 * pagina (een deeplink) gaat hij naar `fallbackHref`, en dan met replace: de
 * detailpagina blijft dan niet als extra stap in de geschiedenis staan.
 */
export function useBackNavigation(fallbackHref: string, options: { forceFallback?: boolean } = {}): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (shouldUseFallback(canGoBackInApp(), options.forceFallback)) router.replace(fallbackHref);
    else router.back();
  }, [router, fallbackHref, options.forceFallback]);
}
