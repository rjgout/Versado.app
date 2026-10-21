"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

// Herkomst van een studieles (CFM), tab-gebonden en alleen met veilige interne routes.
//
// De terugknop van een studieles gaat terug naar waar de gebruiker vandaan kwam (Vandaag, weekpad, Mijn studiemap, ...). Alleen
// `router.back()` vertrouwen is niet genoeg: zonder Navigation API (oudere Safari) is na een herlaad niet meer te zien of de
// vorige geschiedenispagina wel de herkomst is, en een eerdere studieactiviteit in dezelfde tab mag niet doorwerken.
// Daarom legt de centrale routebewaker (NavigationScroll) bij het BINNENKOMEN van een les één herkomst vast in sessionStorage:
//   { les, herkomst, lengte van de geschiedenis op dat moment }.
// De terugknop gebruikt `router.back()` alleen als die herkomst aantoonbaar nog het vorige geschiedenisitem is:
//   - met Navigation API: het vorige item heeft exact het adres van de herkomst;
//   - zonder: de geschiedenis is niet langer of korter geworden sinds het binnenkomen (`history.length`), dus de les staat nog
//     direct achter de herkomst (stap-naar-stap vervangt het item en verandert dat niet).
// Klopt dat niet (directe link, nieuwe tab, andere les, oude herkomst), dan geldt de veilige terugval. Geen URL-parameter,
// dus geen open redirect; een adres wordt alleen bewaard als het een bekende interne route is.

const KEY = "vs-study-origin";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface StudyOriginRecord {
  /** `/study-lesson/<id>/<collectie>`: één studieactiviteit. */
  base: string;
  /** Veilig intern adres (pad + query) van de pagina waar de gebruiker de les opende. */
  origin: string;
  historyLength: number;
  createdAt: number;
}
interface Stored {
  record: StudyOriginRecord | null;
  /** De vorige herkomst, om terug/vooruit-navigatie (oudere Safari meldt die pas na de routewissel) ongedaan te maken. */
  backup: StudyOriginRecord | null;
  /** Alleen waar tot de eerstvolgende routewissel: de herkomst is net door een gewone navigatie vastgelegd (zie settleStudyTraverse). */
  fresh?: boolean;
}

export interface StudyOriginStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const BASE_PATTERN = /^\/study-lesson\/([^/?#]+)\/([^/?#]+)/;
/** Pagina's die bij een les horen (verwijzingen en lofzangen): terugkeren vanaf daar verandert de herkomst niet. */
const SATELLITES = [/^\/scripture\//, /^\/dev\/lofzangen(?:\/|$)/];
/** Veilige interne bestemmingen als herkomst; alles daarbuiten telt als "geen betrouwbare herkomst". */
const ORIGIN_PREFIXES = ["/dashboard", "/courses", "/study-folder", "/kompas", "/acties", "/profile", "/live", "/friends", "/groups", "/tools", "/study-lesson/"];

export function studyBaseOf(pathname: string): string | null {
  const match = BASE_PATTERN.exec(pathname);
  return match ? `/study-lesson/${match[1]}/${match[2]}` : null;
}

/** "pad?query" (of alleen een pad) → een veilig intern adres, of null. */
export function safeStudyOrigin(location: string): string | null {
  const [path, query = ""] = location.split("?");
  if (!path || path.length > 200 || query.length > 200) return null;
  if (!/^\/[A-Za-z0-9._~%\-/]*$/.test(path) || path.includes("//") || path.includes("..")) return null;
  if (!ORIGIN_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))) return null;
  if (query && !/^[A-Za-z0-9=&_\-.%:,]*$/.test(query)) return null;
  return query ? `${path}?${query}` : path;
}

function load(storage: StudyOriginStorage): Stored {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? "null") as Partial<Stored> | null;
    const ok = (record: unknown): record is StudyOriginRecord => {
      const r = record as StudyOriginRecord | null;
      return Boolean(r && typeof r.base === "string" && typeof r.origin === "string" && typeof r.historyLength === "number" && typeof r.createdAt === "number");
    };
    return { record: ok(raw?.record) ? raw!.record! : null, backup: ok(raw?.backup) ? raw!.backup! : null, fresh: raw?.fresh === true };
  } catch {
    return { record: null, backup: null };
  }
}
function save(storage: StudyOriginStorage, state: Stored) {
  try {
    if (!state.record && !state.backup) storage.removeItem(KEY);
    else storage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* Geblokkeerde opslag: dan geldt altijd de veilige terugval. */
  }
}

/**
 * Een routewissel: alleen het BINNENKOMEN van een les (vanaf een pagina buiten die les) legt de herkomst vast. Stap-naar-stap
 * (zelfde les) en een terugkeer vanaf een verwijzing of lofzang veranderen niets; een nieuwe les of een nieuwe ingang vervangt de
 * oude herkomst, zodat een eerdere activiteit nooit doorwerkt.
 */
export function noteStudyRouteChange(
  storage: StudyOriginStorage,
  input: { from: string; toPathname: string; historyLength: number; traverse: boolean; now?: number },
): void {
  const state = load(storage);
  // Elke routewissel haalt de "net vastgelegd"-markering weg; alleen een nieuwe vastlegging zet hem weer aan.
  if (state.fresh) save(storage, { ...state, fresh: false });
  const base = studyBaseOf(input.toPathname);
  if (!base) return;
  const fromPath = input.from.split("?")[0];
  if (studyBaseOf(fromPath) === base) return;
  // De les blijft direct achter de herkomst staan; alleen de lengte van de geschiedenis (die na terug niet krimpt) loopt mee.
  const keep = () => {
    if (state.record?.base === base) save(storage, { ...state, record: { ...state.record, historyLength: input.historyLength }, fresh: false });
  };
  if (SATELLITES.some((pattern) => pattern.test(fromPath))) return keep();
  if (input.traverse) {
    // Terug/vooruit naar een les: de eigen herkomst blijft gelden; weten we die niet meer, dan de veilige terugval.
    if (state.record?.base === base) return keep();
    save(storage, { record: state.backup?.base === base ? state.backup : null, backup: state.record });
    return;
  }
  const origin = safeStudyOrigin(input.from);
  save(storage, {
    record: origin ? { base, origin, historyLength: input.historyLength, createdAt: input.now ?? Date.now() } : null,
    backup: state.record,
    fresh: true,
  });
}

/** Oudere Safari meldt terug/vooruit pas ná de routewissel: maak de zojuist vastgelegde herkomst dan ongedaan. */
export function settleStudyTraverse(storage: StudyOriginStorage, pathname: string, historyLength: number): void {
  const base = studyBaseOf(pathname);
  if (!base) return;
  const state = load(storage);
  if (!state.fresh) return;
  if (state.backup?.base === base) save(storage, { record: { ...state.backup, historyLength }, backup: null });
  else save(storage, { record: null, backup: null });
}

export interface HistoryProbe {
  historyLength: number;
  /** Adres (pad + query) van het vorige geschiedenisitem; `undefined` zonder Navigation API, `null` zonder vorig item. */
  previousEntry?: string | null;
}

/** Is de vastgelegde herkomst aantoonbaar nog het vorige geschiedenisitem? */
export function originIsPreviousEntry(storage: StudyOriginStorage, pathname: string, probe: HistoryProbe, now = Date.now()): StudyOriginRecord | null {
  const base = studyBaseOf(pathname);
  const { record } = load(storage);
  if (!base || !record || record.base !== base || now - record.createdAt > MAX_AGE_MS || record.createdAt > now) return null;
  if (probe.previousEntry !== undefined) return probe.previousEntry === record.origin ? record : null;
  return probe.historyLength === record.historyLength ? record : null;
}

/** Wat de terugknop doet: browser-terug als de herkomst klopt, anders vervangen door de veilige terugval. */
export function resolveStudyBack(
  storage: StudyOriginStorage,
  pathname: string,
  probe: HistoryProbe,
  fallbackHref: string,
  now?: number,
): { action: "back" } | { action: "replace"; href: string } {
  return originIsPreviousEntry(storage, pathname, probe, now) ? { action: "back" } : { action: "replace", href: fallbackHref };
}

/** "Terug naar het weekpad" (stap 6): is de herkomst al dat pad, dan terug (geen dubbel geschiedenisitem), anders vervangen. */
export function resolveReturnToPath(
  storage: StudyOriginStorage,
  pathname: string,
  probe: HistoryProbe,
  pathHref: string,
  now?: number,
): { action: "back" } | { action: "replace"; href: string } {
  const record = originIsPreviousEntry(storage, pathname, probe, now);
  return record && record.origin.split("?")[0] === pathHref.split("?")[0] ? { action: "back" } : { action: "replace", href: pathHref };
}

// --- Browserkant -------------------------------------------------------------------------------------------------------------

interface NavEntryLike { url: string | null }
interface NavApiLike { currentEntry: { index: number } | null; entries(): NavEntryLike[] }

function browserStorage(): StudyOriginStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
function probeBrowser(): HistoryProbe {
  const api = (window as unknown as { navigation?: NavApiLike }).navigation;
  const base = { historyLength: window.history.length };
  if (!api?.currentEntry || typeof api.entries !== "function") return base;
  const previous = api.entries()[api.currentEntry.index - 1];
  if (!previous?.url) return { ...base, previousEntry: null };
  try {
    const url = new URL(previous.url);
    if (url.origin !== window.location.origin) return { ...base, previousEntry: null };
    return { ...base, previousEntry: `${url.pathname}${url.search}` };
  } catch {
    return { ...base, previousEntry: null };
  }
}

/** Voor NavigationScroll (de centrale routebewaker). */
export function recordStudyRouteChange(from: string, toPathname: string, traverse: boolean) {
  const storage = browserStorage();
  if (storage) noteStudyRouteChange(storage, { from, toPathname, historyLength: window.history.length, traverse });
}
export function settleStudyTraverseInBrowser() {
  const storage = browserStorage();
  if (storage) settleStudyTraverse(storage, window.location.pathname, window.history.length);
}

/** De terugknop van een studieles: herkomst als die klopt, anders de veilige terugval (met replace, geen extra item). */
export function useStudyBack(pathname: string, fallbackHref: string, enabled = true): () => void {
  const router = useRouter();
  return useCallback(() => {
    const storage = browserStorage();
    const result = enabled && storage ? resolveStudyBack(storage, pathname, probeBrowser(), fallbackHref) : ({ action: "replace", href: fallbackHref } as const);
    if (result.action === "back") router.back();
    else router.replace(result.href);
  }, [router, pathname, fallbackHref, enabled]);
}

/** "Terug naar het weekpad": zelfde regel als de terugknop, maar de bestemming is het weekpad. */
export function useStudyReturnToPath(pathname: string, pathHref: string): () => void {
  const router = useRouter();
  return useCallback(() => {
    const storage = browserStorage();
    const result = storage ? resolveReturnToPath(storage, pathname, probeBrowser(), pathHref) : ({ action: "replace", href: pathHref } as const);
    if (result.action === "back") router.back();
    else router.replace(result.href);
  }, [router, pathname, pathHref]);
}
