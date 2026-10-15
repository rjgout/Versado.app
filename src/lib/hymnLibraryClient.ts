import { NOTATION_VERSION, type SheetData } from "@/lib/hymns/notation/types";
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

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet<T>(key: string): Promise<Cached<T> | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Cached<T> | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut<T>(key: string, value: Cached<T>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
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

/** Alle composities voor de herkenning; één keer ophalen (en bewaren) vóór de microfoon start. */
export async function loadRecognitionBundle(): Promise<RecognitionBundle> {
  const mem = memory.get("recognition") as RecognitionBundle | undefined;
  if (mem) return mem;
  const cached = await idbGet<RecognitionBundle>("recognition");
  if (cached && (knownVersion === null || cached.dataVersion === knownVersion)) {
    memory.set("recognition", cached.value);
    return cached.value;
  }
  try {
    const res = await getJson<RecognitionBundle>("/api/hymns/recognition");
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

/** Bladmuziek van één lofzang: pas opgehaald als de gebruiker Bladmuziek kiest, daarna uit geheugen of lokale opslag zolang de dataversie klopt. */
export async function loadHymnSheet(number: number): Promise<SheetData | null> {
  // De notatieversie zit in de sleutel: verandert de notatie of de MusicXML-bouw (versie omhoog), dan wordt een oud blad nooit hergebruikt.
  const key = `sheet:v${NOTATION_VERSION}:${number}`;
  const mem = memory.get(key) as SheetData | undefined;
  if (mem) return mem;
  const cached = await idbGet<SheetData>(key);
  if (cached && (knownVersion === null || cached.dataVersion === knownVersion)) {
    memory.set(key, cached.value);
    return cached.value;
  }
  try {
    const res = await getJson<{ dataVersion: string; sheet: SheetData }>(`/api/hymns/${number}/sheet`);
    memory.set(key, res.sheet);
    void idbPut(key, { dataVersion: res.dataVersion, value: res.sheet });
    return res.sheet;
  } catch (err) {
    if (cached) return cached.value;
    // 404 = deze lofzang heeft geen notatie: geen fout, de tekst blijft leesbaar
    if (err instanceof Error && /: 404$/.test(err.message)) return null;
    throw err;
  }
}
