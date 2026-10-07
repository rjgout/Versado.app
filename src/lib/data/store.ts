// Kern van de live-data-laag (docs/DATA-REFRESH.md). Puur TypeScript zonder
// React of window: de omgeving (klok, zichtbaarheid, netwerk, timers) wordt
// meegegeven, zodat dit met node:test te testen is en in de browser één
// singleton kan zijn (zie client.ts).
//
// Regels die hier zijn vastgelegd, en nergens anders per pagina:
// - Eén ophaalactie per key tegelijk (dedupe), ook met veel componenten.
// - Verouderde data blijft zichtbaar tijdens verversen en bij een fout; een
//   nieuwe key (andere content/taal) toont nooit de data van de oude.
// - Een gebeurtenis maakt alleen de gekoppelde datasets (scopes) ongeldig, en
//   alleen wat nu in beeld is wordt meteen opnieuw opgehaald.
// - Niets wordt opgehaald terwijl de tab verborgen of het toestel offline is;
//   bij terugkeer worden alleen verouderde datasets gecontroleerd.
import { scopesForEvent, type DataEvent, type DataScope } from "./scopes";

export type QueryKey = readonly unknown[];

function sameJson(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function serializeKey(key: QueryKey): string {
  return JSON.stringify(key);
}

export interface QuerySnapshot<T = unknown> {
  data: T | undefined;
  /** Laatste fout; data blijft staan als die er al was. */
  error: unknown | null;
  /** loading: nog nooit data gehad; error: fout zonder data; success: er is data. */
  status: "loading" | "success" | "error";
  isFetching: boolean;
  fetchedAt: number | null;
  /** Ongeldig verklaard en nog niet opnieuw opgehaald. */
  invalidated: boolean;
}

const LOADING_SNAPSHOT: QuerySnapshot = Object.freeze({
  data: undefined,
  error: null,
  status: "loading",
  isFetching: false,
  fetchedAt: null,
  invalidated: false,
}) as QuerySnapshot;

export interface QueryOptions<T> {
  fetcher: () => Promise<T>;
  /** Datasets waar deze query bij hoort; bepaalt wat een gebeurtenis ongeldig maakt. */
  scopes: readonly DataScope[];
  /** Hoe lang data vers blijft (ms). Standaard 30 s. */
  staleTime?: number;
  /** Alleen voor data zonder realtime: ophalen zolang in beeld, hooguit zo vaak (ms). */
  pollMs?: number;
  /** Server-gerenderde beginwaarde: telt als net opgehaald. */
  initialData?: T;
  /**
   * Data met een bekend verloopmoment (bv. "het volgende woord komt om 18:00"):
   * geeft het moment (klok van de browser, ms) waarop deze data niet meer klopt.
   * De data is dan verouderd ongeacht staleTime, ook na een tab die lang verborgen was.
   */
  validUntil?: (data: T, fetchedAt: number) => number | null;
}

export interface LiveEnvironment {
  now: () => number;
  isVisible: () => boolean;
  isOnline: () => boolean;
  random: () => number;
  schedule: (fn: () => void, ms: number) => () => void;
}

export const DEFAULT_STALE_TIME = 30_000;
/** Minimale tijd tussen twee router-verversingen van dezelfde serverpagina. */
export const PAGE_MIN_REFRESH_INTERVAL = 2_000;
/** Hoe lang een verversing mag duren voordat een volgende wordt toegestaan. */
export const PAGE_REFRESH_TIMEOUT = 10_000;
/** Ongebruikte data blijft zo lang in het geheugen (terugnavigeren is dan direct vers). */
export const GC_TIME = 5 * 60_000;

interface Observer {
  fetcher: () => Promise<unknown>;
  staleTime: number;
  pollMs: number | null;
  scopes: readonly DataScope[];
  validUntil: ((data: unknown, fetchedAt: number) => number | null) | null;
}

interface Entry {
  key: string;
  snapshot: QuerySnapshot;
  observers: Set<Observer>;
  listeners: Set<() => void>;
  scopes: Set<DataScope>;
  inflight: Promise<void> | null;
  /** Wordt verhoogd bij elke invalidatie, zodat een lopende fetch weet dat hij al achterloopt. */
  generation: number;
  lastObserverFetcher: (() => Promise<unknown>) | null;
  lastReleasedAt: number | null;
}

export interface PageOptions {
  scopes: readonly DataScope[];
  /** Na hoeveel ms een getoonde pagina als verouderd geldt. Standaard 30 s. */
  staleTime?: number;
  /** Vraagt de server om een verse versie (router.refresh()). */
  refresh: () => void;
}

interface PageRecord {
  id: string;
  options: PageOptions;
  shownAt: number;
  /** Telt invalidaties; een pagina is "vuil" zolang het getoonde volgnummer achterloopt. */
  dirtySeq: number;
  /** Volgnummer dat de getoonde render al verwerkt heeft. */
  servedSeq: number;
  /** Volgnummer op het moment dat de lopende verversing werd gevraagd. */
  requestedSeq: number;
  refreshing: boolean;
  lastRefreshAt: number | null;
  trailing: boolean;
  /** Moment (browserklok, ms) waarop de getoonde inhoud niet meer klopt, bv. een nieuw woord om 18:00. */
  expiresAt: number | null;
}

export interface PageHandle {
  /** De pagina heeft een verse server-render ontvangen. Wist ook het verloopmoment van de vorige render. */
  markFresh(): void;
  /** Verloopmoment van de getoonde render (browserklok), of null. */
  setExpiry(at: number | null): void;
  release(): void;
}

export interface RevalidateOptions {
  /** Negeer staleTime (terug online, app hervat, bfcache): er kan van alles gemist zijn. */
  force?: boolean;
}

export class LiveDataStore {
  private readonly entries = new Map<string, Entry>();
  private readonly pages = new Map<string, PageRecord>();
  private readonly versions = new Map<DataScope, number>();
  private readonly seenPages = new Map<string, { token: string; versions: string; at: number }>();
  private readonly pendingCancels = new Set<() => void>();

  constructor(private readonly env: LiveEnvironment) {}

  // --- Queries ----------------------------------------------------------

  /** Maakt de entry aan als die nog niet bestaat (ook voor wie alleen meeluistert). */
  private ensure(entryKey: string): Entry {
    let entry = this.entries.get(entryKey);
    if (!entry) {
      entry = {
        key: entryKey,
        snapshot: { ...LOADING_SNAPSHOT },
        observers: new Set(),
        listeners: new Set(),
        scopes: new Set(),
        inflight: null,
        generation: 0,
        lastObserverFetcher: null,
        lastReleasedAt: this.env.now(),
      };
      this.entries.set(entryKey, entry);
    }
    return entry;
  }

  /** Begin met meekijken naar een key; haalt zo nodig op. Geeft de sleutel en een release-functie. */
  observe<T>(key: QueryKey, options: QueryOptions<T>): { entryKey: string; release: () => void } {
    const entryKey = serializeKey(key);
    const entry = this.ensure(entryKey);
    if (options.initialData !== undefined && entry.snapshot.data === undefined) {
      this.patch(entry, { data: options.initialData, status: "success", fetchedAt: this.env.now() });
    }
    const observer: Observer = {
      fetcher: options.fetcher as () => Promise<unknown>,
      staleTime: options.staleTime ?? DEFAULT_STALE_TIME,
      pollMs: options.pollMs ?? null,
      scopes: options.scopes,
      validUntil: (options.validUntil as Observer["validUntil"]) ?? null,
    };
    for (const scope of options.scopes) entry.scopes.add(scope);
    entry.observers.add(observer);
    entry.lastObserverFetcher = observer.fetcher;
    entry.lastReleasedAt = null;
    this.maybeFetch(entry, false);

    const target = entry;
    return {
      entryKey,
      release: () => {
        target.observers.delete(observer);
        if (target.observers.size === 0) target.lastReleasedAt = this.env.now();
      },
    };
  }

  /** De fetcher kan tussen renders wijzigen (closures); de nieuwste telt. */
  updateFetcher<T>(entryKey: string, fetcher: () => Promise<T>): void {
    const entry = this.entries.get(entryKey);
    if (!entry) return;
    for (const observer of entry.observers) observer.fetcher = fetcher as () => Promise<unknown>;
    entry.lastObserverFetcher = fetcher as () => Promise<unknown>;
  }

  subscribe(entryKey: string, listener: () => void): () => void {
    const entry = this.ensure(entryKey);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  /** Stabiele verwijzing zolang er niets verandert (vereist door useSyncExternalStore). */
  getSnapshot<T>(entryKey: string): QuerySnapshot<T> {
    return (this.entries.get(entryKey)?.snapshot ?? LOADING_SNAPSHOT) as QuerySnapshot<T>;
  }

  /** Vervangt de data direct (antwoord van een mutation, optimistische update). */
  setData<T>(key: QueryKey, update: T | ((previous: T | undefined) => T)): void {
    const entry = this.entries.get(serializeKey(key));
    if (!entry) return;
    const next = typeof update === "function" ? (update as (previous: T | undefined) => T)(entry.snapshot.data as T | undefined) : update;
    this.patch(entry, { data: next, status: "success", error: null, fetchedAt: this.env.now() });
  }

  /** Handmatig opnieuw ophalen, ook als de data vers is. */
  refetch(entryKey: string): Promise<void> {
    const entry = this.entries.get(entryKey);
    return entry ? this.fetchEntry(entry) : Promise.resolve();
  }

  // --- Invalidatie ------------------------------------------------------

  /** Maakt alle datasets van een gebeurtenis (of scopes) ongeldig; wat in beeld is wordt opnieuw opgehaald. */
  invalidate(target: DataEvent | readonly DataScope[], options: { jitterMs?: number } = {}): void {
    const scopes: readonly DataScope[] = typeof target === "string" ? scopesForEvent(target) : target;
    for (const scope of scopes) this.versions.set(scope, (this.versions.get(scope) ?? 0) + 1);
    const wanted = new Set(scopes);

    for (const entry of this.entries.values()) {
      if (![...entry.scopes].some((scope) => wanted.has(scope))) continue;
      entry.generation += 1;
      if (!entry.snapshot.invalidated) this.patch(entry, { invalidated: true });
      if (entry.observers.size === 0) continue;
      this.later(() => this.maybeFetch(entry, true), options.jitterMs);
    }
    for (const page of this.pages.values()) {
      if (!page.options.scopes.some((scope) => wanted.has(scope))) continue;
      page.dirtySeq += 1;
      this.later(() => this.maybeRefreshPage(page, false), options.jitterMs);
    }
  }

  scopeVersion(scope: DataScope): number {
    return this.versions.get(scope) ?? 0;
  }

  // --- Terugkeer, focus, netwerk, polling -------------------------------

  /**
   * Controleert wat in beeld is. Zonder `force` alleen wat verouderd of ongeldig is
   * (focus, tab zichtbaar); met `force` alles (terug online, app hervat).
   */
  revalidate(options: RevalidateOptions = {}): void {
    for (const entry of this.entries.values()) {
      if (entry.observers.size > 0) this.maybeFetch(entry, options.force === true);
    }
    for (const page of this.pages.values()) this.maybeRefreshPage(page, options.force === true);
  }

  /**
   * Eén centrale klokslag (door de browser alleen gestart zolang de tab zichtbaar is):
   * haalt data met pollMs op die daaraan toe is en ruimt ongebruikte data op.
   */
  tick(): void {
    const now = this.env.now();
    // Pagina's met een verloopmoment (nieuw woord om 18:00) ververst de klokslag op tijd; geen polling.
    for (const page of this.pages.values()) if (page.expiresAt !== null) this.maybeRefreshPage(page, false);
    for (const [key, entry] of this.entries) {
      if (entry.observers.size === 0) {
        if (entry.lastReleasedAt !== null && now - entry.lastReleasedAt >= GC_TIME) this.entries.delete(key);
        continue;
      }
      // Data met een verloopmoment: controleren op elke klokslag (alleen zichtbaar), niet via polling.
      if (this.isExpired(entry)) this.maybeFetch(entry, false);
      const intervals = [...entry.observers].map((o) => o.pollMs).filter((ms): ms is number => ms !== null);
      if (intervals.length === 0) continue;
      const pollMs = Math.min(...intervals);
      const age = entry.snapshot.fetchedAt === null ? Infinity : now - entry.snapshot.fetchedAt;
      if (age >= pollMs) this.maybeFetch(entry, true);
    }
  }

  /** Voor uitloggen of een andere gebruiker: niets van de vorige sessie blijft staan. */
  reset(): void {
    for (const cancel of this.pendingCancels) cancel();
    this.pendingCancels.clear();
    this.entries.clear();
    this.pages.clear();
    this.seenPages.clear();
    this.versions.clear();
  }

  // --- Serverpagina's (router.refresh) ----------------------------------

  /**
   * Meldt een zojuist getoonde server-render. `token` verandert bij elke verse
   * render. Dezelfde token opnieuw = de pagina komt uit de routercache (terug-
   * navigatie): dan geeft dit true als er sindsdien iets ongeldig is verklaard
   * of de pagina te oud is, en moet de pagina zelf een verse versie vragen.
   */
  noteServerRender(pageId: string, token: string, scopes: readonly DataScope[], staleTime = DEFAULT_STALE_TIME): boolean {
    const now = this.env.now();
    const versions = scopes.map((scope) => `${scope}:${this.scopeVersion(scope)}`).join("|");
    const previous = this.seenPages.get(pageId);
    const needsRefresh = previous !== undefined && previous.token === token && (previous.versions !== versions || now - previous.at >= staleTime);
    if (!previous || previous.token !== token) this.seenPages.set(pageId, { token, versions, at: now });
    return needsRefresh;
  }

  observePage(id: string, options: PageOptions): PageHandle {
    const record: PageRecord = {
      id,
      options,
      shownAt: this.env.now(),
      dirtySeq: 0,
      servedSeq: 0,
      requestedSeq: 0,
      refreshing: false,
      lastRefreshAt: null,
      trailing: false,
      expiresAt: null,
    };
    this.pages.set(id, record);
    return {
      markFresh: () => {
        record.shownAt = this.env.now();
        // Een invalidatie tijdens het verversen is nog niet verwerkt: dan volgt direct een nieuwe ronde.
        record.servedSeq = record.refreshing ? record.requestedSeq : record.dirtySeq;
        record.refreshing = false;
        record.expiresAt = null;
        if (record.dirtySeq > record.servedSeq) this.maybeRefreshPage(record, false);
      },
      setExpiry: (at) => {
        record.expiresAt = at;
      },
      release: () => {
        if (this.pages.get(id) === record) this.pages.delete(id);
      },
    };
  }

  /** Vraagt een serverpagina direct om een verse versie (bv. na terugnavigeren vanuit de cache). */
  refreshPageNow(id: string): void {
    const page = this.pages.get(id);
    if (page) this.maybeRefreshPage(page, true);
  }

  // --- Intern -----------------------------------------------------------

  private later(fn: () => void, jitterMs?: number): void {
    if (!jitterMs || jitterMs <= 0) {
      fn();
      return;
    }
    const delay = Math.floor(this.env.random() * jitterMs);
    const cancel = this.env.schedule(() => {
      this.pendingCancels.delete(cancel);
      fn();
    }, delay);
    this.pendingCancels.add(cancel);
  }

  private maybeRefreshPage(page: PageRecord, force: boolean): void {
    if (!this.env.isVisible() || !this.env.isOnline()) return;
    const now = this.env.now();
    const expired = page.expiresAt !== null && now >= page.expiresAt;
    const stale = expired || now - page.shownAt >= (page.options.staleTime ?? DEFAULT_STALE_TIME);
    const dirty = page.dirtySeq > page.servedSeq;
    if (!(dirty || stale || force)) return;
    if (page.lastRefreshAt !== null) {
      const since = now - page.lastRefreshAt;
      if (since < PAGE_MIN_REFRESH_INTERVAL) {
        // Niet weggooien: een invalidatie vlak na een verversing krijgt een laatste ronde.
        if (dirty && !page.trailing) {
          page.trailing = true;
          const cancel = this.env.schedule(() => {
            this.pendingCancels.delete(cancel);
            page.trailing = false;
            this.maybeRefreshPage(page, false);
          }, PAGE_MIN_REFRESH_INTERVAL - since);
          this.pendingCancels.add(cancel);
        }
        return;
      }
      if (page.refreshing && since < PAGE_REFRESH_TIMEOUT) return;
    }
    page.refreshing = true;
    page.requestedSeq = page.dirtySeq;
    page.lastRefreshAt = now;
    page.options.refresh();
  }

  private maybeFetch(entry: Entry, force: boolean): void {
    // Tijdens een lopende fetch markeert invalidate() de generatie; fetchEntry haalt daarna nogmaals op.
    if (entry.observers.size === 0 || entry.inflight) return;
    if (!this.env.isVisible() || !this.env.isOnline()) return;
    const snapshot = entry.snapshot;
    const staleTime = Math.min(...[...entry.observers].map((o) => o.staleTime));
    const age = snapshot.fetchedAt === null ? Infinity : this.env.now() - snapshot.fetchedAt;
    // Een fout zonder data wordt bij elke nieuwe trigger (focus, online, invalidatie) opnieuw geprobeerd, nooit in een lus.
    if (snapshot.data === undefined || snapshot.invalidated || age >= staleTime || force || this.isExpired(entry)) void this.fetchEntry(entry);
  }

  private isExpired(entry: Entry): boolean {
    const { data, fetchedAt } = entry.snapshot;
    if (data === undefined || fetchedAt === null) return false;
    for (const observer of entry.observers) {
      const until = observer.validUntil?.(data, fetchedAt) ?? null;
      if (until !== null && this.env.now() >= until) return true;
    }
    return false;
  }

  private fetchEntry(entry: Entry): Promise<void> {
    if (entry.inflight) return entry.inflight;
    const fetcher = entry.lastObserverFetcher;
    if (!fetcher) return Promise.resolve();
    const generation = entry.generation;
    this.patch(entry, { isFetching: true });
    // De afronding hangt aan .finally zodat entry.inflight altijd pas ná de toewijzing leeg wordt.
    const run = this.runFetch(entry, fetcher, generation).finally(() => {
      entry.inflight = null;
      if (entry.snapshot.invalidated && entry.snapshot.error === null) this.maybeFetch(entry, true);
    });
    entry.inflight = run;
    return run;
  }

  private async runFetch(entry: Entry, fetcher: () => Promise<unknown>, generation: number): Promise<void> {
    try {
      const fetched = await fetcher();
      // Ongewijzigde data behoudt zijn verwijzing: geen onnodige renders en een lijst waar
      // je doorheen scrolt blijft staan na een stille controle.
      const data = sameJson(entry.snapshot.data, fetched) ? entry.snapshot.data : fetched;
      this.patch(entry, {
        data,
        status: "success",
        error: null,
        isFetching: false,
        fetchedAt: this.env.now(),
        // Tijdens het ophalen opnieuw ongeldig verklaard: dit antwoord kan al achterhaald zijn.
        invalidated: entry.generation !== generation,
      });
    } catch (error) {
      this.patch(entry, { error, isFetching: false, status: entry.snapshot.data !== undefined ? "success" : "error" });
    }
  }

  private patch(entry: Entry, change: Partial<QuerySnapshot>): void {
    entry.snapshot = { ...entry.snapshot, ...change };
    for (const listener of entry.listeners) listener();
  }
}
