import type { HymnComposition, HymnIndexEntry, ReadableHymn } from "@/lib/hymns/types";

// Client-kant van de lofzangenbibliotheek: haalt de (admin-only) gegevens op bij de server en bewaart ze lokaal in
// IndexedDB, zodat een tweede sessie, en een dienst zonder goede verbinding, geen verzoeken meer nodig heeft.
// Er gaat uitsluitend bibliotheekinhoud (tekst en noten) heen en weer; nooit audio of persoonsgegevens.
// Dit bestand staat bewust buiten src/lib/hymns: de privacytest verbiedt daar elk netwerk- en opslaggebruik.

const DB_NAME = "versado-lofzangen";
const STORE = "library";

export interface RecognitionBundle {
  dataVersion: string;
  compositions: HymnComposition[];
  members: { compositionId: string; number: number; title: string }[];
  calibration?: Record<string, { t: number[]; mean: number[]; std: number[] }>;
}

interface IndexResponse {
  dataVersion: string;
  hymns: HymnIndexEntry[];
}

interface Cached<T> {
  dataVersion: string;
  value: T;
}

// Lokale opslag is een versnelling, nooit een voorwaarde: sommige browsers (o.a. iOS Safari na een herstart, vergrendelde of privé-
// modus) laten indexedDB.open() soms nooit antwoorden. Zonder tijdslimiet zou het ophalen van een lofzang of van de herkenningsbundel
// dan eindeloos wachten terwijl de microfoon luistert. Elke opslagbewerking krijgt daarom een korte limiet; bij overschrijding gaat
// het gewoon via het netwerk.
const STORAGE_TIMEOUT_MS = 1500;
const FETCH_TIMEOUT_MS = 20000;

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

function openDb(): Promise<IDBDatabase | null> {
  return withTimeout(
    new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (typeof indexedDB === "undefined") return resolve(null);
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    }),
    STORAGE_TIMEOUT_MS,
    null
  );
}

async function idbGet<T>(key: string): Promise<Cached<T> | null> {
  const db = await openDb();
  if (!db) return null;
  return withTimeout(
    new Promise<Cached<T> | null>((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as Cached<T> | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    }),
    STORAGE_TIMEOUT_MS,
    null
  );
}

async function idbPut<T>(key: string, value: Cached<T>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await withTimeout(
    new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    }),
    STORAGE_TIMEOUT_MS,
    undefined
  );
}

async function fetchJsonOnce<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: "same-origin", signal: controller.signal });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Eén nieuwe poging bij een netwerkfout of serverfout (5xx); een duidelijke weigering (4xx) wordt niet herhaald. */
async function getJson<T>(url: string): Promise<T> {
  try {
    return await fetchJsonOnce<T>(url);
  } catch (err) {
    const status = err instanceof Error ? /: (\d{3})$/.exec(err.message)?.[1] : undefined;
    if (status && status.startsWith("4")) throw err;
    await new Promise((r) => setTimeout(r, 400));
    return fetchJsonOnce<T>(url);
  }
}

const memory = new Map<string, unknown>();
let knownVersion: string | null = null;

/** Het zoek- en lijstoverzicht. Offline of bij een fout: de lokaal bewaarde versie. */
export async function loadHymnIndex(): Promise<{ dataVersion: string; hymns: HymnIndexEntry[]; fromCache: boolean }> {
  try {
    const fresh = await getJson<IndexResponse>("/api/hymns/index");
    knownVersion = fresh.dataVersion;
    void idbPut("index", { dataVersion: fresh.dataVersion, value: fresh.hymns });
    return { ...fresh, fromCache: false };
  } catch (err) {
    const cached = await idbGet<HymnIndexEntry[]>("index");
    if (!cached) throw err;
    knownVersion = cached.dataVersion;
    return { dataVersion: cached.dataVersion, hymns: cached.value, fromCache: true };
  }
}

/** Eén lofzang, pas opgehaald als hij wordt geopend; daarna uit het geheugen of de lokale opslag zolang de dataversie klopt. */
export async function loadHymn(number: number): Promise<ReadableHymn> {
  const key = `hymn:${number}`;
  const mem = memory.get(key) as ReadableHymn | undefined;
  if (mem) return mem;
  const cached = await idbGet<ReadableHymn>(key);
  if (cached && (knownVersion === null || cached.dataVersion === knownVersion)) {
    memory.set(key, cached.value);
    return cached.value;
  }
  try {
    const res = await getJson<{ dataVersion: string; hymn: ReadableHymn }>(`/api/hymns/${number}`);
    memory.set(key, res.hymn);
    void idbPut(key, { dataVersion: res.dataVersion, value: res.hymn });
    return res.hymn;
  } catch (err) {
    if (cached) return cached.value; // offline: liever een iets oudere kopie dan niets
    throw err;
  }
}

export type BundleLoadState = "idle" | "loading" | "ready" | "error";
export interface LibraryDiagnostics {
  bundle: BundleLoadState;
  /** Korte reden van de laatste mislukte poging (alleen voor de beheerdersdiagnostiek). */
  bundleError: string | null;
  /** Waar de bundel vandaan kwam: geheugen, lokale opslag of netwerk. */
  bundleSource: "geheugen" | "opslag" | "netwerk" | null;
  compositions: number;
}
const diagnostics: LibraryDiagnostics = { bundle: "idle", bundleError: null, bundleSource: null, compositions: 0 };

export function getLibraryDiagnostics(): LibraryDiagnostics {
  return { ...diagnostics };
}

/** Alle composities voor de herkenning; één keer ophalen (en bewaren) vóór of tijdens het luisteren. */
export async function loadRecognitionBundle(): Promise<RecognitionBundle> {
  diagnostics.bundle = "loading";
  try {
    const bundle = await loadRecognitionBundleInner();
    diagnostics.bundle = "ready";
    diagnostics.bundleError = null;
    diagnostics.compositions = bundle.compositions.length;
    return bundle;
  } catch (err) {
    diagnostics.bundle = "error";
    diagnostics.bundleError = err instanceof Error ? err.message : "onbekende fout";
    throw err;
  }
}

async function loadRecognitionBundleInner(): Promise<RecognitionBundle> {
  const mem = memory.get("recognition") as RecognitionBundle | undefined;
  if (mem) {
    diagnostics.bundleSource = "geheugen";
    return mem;
  }
  const cached = await idbGet<RecognitionBundle>("recognition");
  if (cached && (knownVersion === null || cached.dataVersion === knownVersion)) {
    memory.set("recognition", cached.value);
    diagnostics.bundleSource = "opslag";
    return cached.value;
  }
  try {
    const res = await getJson<RecognitionBundle>("/api/hymns/recognition");
    diagnostics.bundleSource = "netwerk";
    memory.set("recognition", res);
    void idbPut("recognition", { dataVersion: res.dataVersion, value: res });
    return res;
  } catch (err) {
    if (cached) return cached.value;
    throw err;
  }
}

/** Kijkt welke lofzangen en of de herkenningsgegevens al lokaal staan (voor de tekst "Beschikbaar zonder verbinding"). */
export async function localLibraryStatus(): Promise<{ index: boolean; recognition: boolean }> {
  const [index, recognition] = await Promise.all([idbGet("index"), idbGet("recognition")]);
  return { index: index !== null, recognition: recognition !== null };
}

export interface LibraryReport {
  dataVersion: string;
  counts: Record<string, unknown>;
  incomplete: { number: number; title: string; levels: string[]; problems: string[] }[];
}

/** Kwaliteitsoverzicht (alleen beheerders); altijd vers, nooit lokaal bewaard. */
export async function loadLibraryReport(): Promise<LibraryReport> {
  return getJson<LibraryReport>("/api/hymns/report");
}
