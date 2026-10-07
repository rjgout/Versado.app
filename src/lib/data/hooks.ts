"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { liveData } from "./client";
import { serializeKey, type QueryKey, type QuerySnapshot } from "./store";
import { subscribeTopic } from "./topics";
import type { DataScope, LiveTopic } from "./scopes";

/** Welke content en taal op dit moment gekozen zijn (zie LiveDataProvider). */
export interface ContentScope {
  collectionId: string;
  language: string;
}

export const ContentScopeContext = createContext<ContentScope | null>(null);

export function useContentScope(): ContentScope | null {
  return useContext(ContentScopeContext);
}

export interface UseLiveQueryOptions<T> {
  /** Datasets waar deze data bij hoort; bepaalt wat een gebeurtenis ongeldig maakt (scopes.ts). */
  scopes: readonly DataScope[];
  /**
   * Verplicht voor alles wat van de gekozen content of contenttaal afhangt: de key
   * krijgt dan automatisch "content + taal" mee, zodat data van de vorige keuze
   * nooit blijft staan. Zet de sectie zelf in `key` (bv. ["courses", "list"]).
   */
  contentScoped?: boolean;
  /** Hoe lang de data vers blijft (ms), standaard 30 s. */
  staleTime?: number;
  /** Alleen voor data zonder realtime-bron; wordt gepauzeerd in een verborgen tab. */
  pollMs?: number;
  /** Server-gerenderde beginwaarde. */
  initialData?: T;
  /** Moment (browserklok, ms) waarop deze data niet meer klopt; zie QueryOptions.validUntil. */
  validUntil?: (data: T, fetchedAt: number) => number | null;
  /**
   * Toon tijdens het laden van een andere key (bv. een andere maand) de vorige data in plaats
   * van een laadstatus. Nooit voor contentScoped data: die mag niet van de vorige keuze blijven staan.
   */
  keepPreviousData?: boolean;
  enabled?: boolean;
}

export interface LiveQueryResult<T> {
  data: T | undefined;
  error: unknown | null;
  /** Nog nooit data gehad. */
  isLoading: boolean;
  /** Er loopt nu een aanvraag (ook als er al data staat). */
  isFetching: boolean;
  /** Wanneer (browserklok, ms) de data voor het laatst is binnengekomen. */
  updatedAt: number | null;
  status: QuerySnapshot["status"];
  refetch: () => Promise<void>;
  /** Toon een antwoord of optimistische waarde direct; valideer daarna met invalidateData(). */
  setData: (update: T | ((previous: T | undefined) => T)) => void;
}

/**
 * De standaardmanier om dynamische data in een component te krijgen: ophalen bij
 * openen, opnieuw bij focus/terugkeer/online, direct na een gerelateerde mutation
 * en gedeeld met andere componenten met dezelfde key. Zie docs/DATA-REFRESH.md.
 */
export function useLiveQuery<T>(key: QueryKey, fetcher: () => Promise<T>, options: UseLiveQueryOptions<T>): LiveQueryResult<T> {
  const content = useContentScope();
  const fullKey: QueryKey = options.contentScoped
    ? [...key, { content: content?.collectionId ?? null, language: content?.language ?? null }]
    : key;
  const entryKey = serializeKey(fullKey);

  // De fetcher mag elke render een nieuwe closure zijn; de store gebruikt altijd de nieuwste.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const enabled = options.enabled !== false;
  const { scopes, staleTime, pollMs, initialData } = options;
  const validUntilRef = useRef(options.validUntil);
  useEffect(() => {
    validUntilRef.current = options.validUntil;
  });
  const hasValidUntil = options.validUntil !== undefined;
  const scopesKey = scopes.join(",");
  useEffect(() => {
    if (!enabled) return;
    const handle = liveData.observe(JSON.parse(entryKey) as QueryKey, {
      fetcher: () => fetcherRef.current(),
      scopes: scopesKey.split(",") as DataScope[],
      staleTime,
      pollMs,
      initialData,
      validUntil: hasValidUntil ? (data, fetchedAt) => validUntilRef.current?.(data as T, fetchedAt) ?? null : undefined,
    });
    return handle.release;
    // initialData bewust niet als dependency: alleen de eerste waarde telt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey, enabled, scopesKey, staleTime, pollMs, hasValidUntil]);

  const snapshot = useSyncExternalStore(
    useCallback((listener: () => void) => liveData.subscribe(entryKey, listener), [entryKey]),
    () => liveData.getSnapshot<T>(entryKey),
    () => liveData.getSnapshot<T>(entryKey)
  );

  // Stabiele functies: componenten mogen ze in effecten en dependency-lijsten gebruiken.
  const refetch = useCallback(() => liveData.refetch(entryKey), [entryKey]);
  const setData = useCallback(
    (update: T | ((previous: T | undefined) => T)) => liveData.setData(JSON.parse(entryKey) as QueryKey, update),
    [entryKey]
  );

  const [previous, setPrevious] = useState<T | undefined>(undefined);
  if (options.keepPreviousData && snapshot.data !== undefined && previous !== snapshot.data) setPrevious(snapshot.data);
  const data = snapshot.data !== undefined ? snapshot.data : (options.keepPreviousData ? previous : undefined) ?? initialData;
  return {
    data,
    error: snapshot.error,
    isLoading: data === undefined && snapshot.status === "loading",
    isFetching: snapshot.isFetching,
    updatedAt: snapshot.fetchedAt,
    status: data !== undefined && snapshot.status === "loading" ? "success" : snapshot.status,
    refetch,
    setData,
  };
}

/** Volg een realtime-onderwerp zolang de component in beeld is (zie LIVE_TOPICS in scopes.ts). */
export function useLiveTopic(topic: LiveTopic, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    return subscribeTopic(topic);
  }, [topic, enabled]);
}
