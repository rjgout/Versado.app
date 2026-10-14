"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// Weergavevoorkeuren van Lofzangen. Dit is bewust een eigen, kleine laag buiten src/lib/hymns: de muziekengine
// en het meezingscherm mogen geen opslag gebruiken (tests/hymns-privacy.test.ts), en dit bestand bewaart
// uitsluitend vier weergavekeuzes op dit toestel. Nooit microfoongeluid, herkenningsgegevens, lofzangkeuzes
// of iets over de gebruiker. Zonder opslag (privévenster, geblokkeerd) werkt alles met de standaardwaarden.

export type HymnView = "stanza" | "karaoke";
export type HymnTextSize = "normal" | "large" | "xlarge";

export interface HymnPrefs {
  view: HymnView;
  size: HymnTextSize;
  autoScroll: boolean;
  /** Rustige kerkweergave: minder visuele afleiding. */
  calm: boolean;
}

export const DEFAULT_HYMN_PREFS: HymnPrefs = { view: "stanza", size: "normal", autoScroll: true, calm: false };

const STORAGE_KEY = "versado:hymns:prefs:v1";
const EVENT = "versado:hymns-prefs";

/** Leest bewaarde voorkeuren; alles wat niet klopt valt terug op de standaard (nooit een fout). */
export function parseHymnPrefs(raw: string | null | undefined): HymnPrefs {
  if (!raw) return DEFAULT_HYMN_PREFS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof HymnPrefs, unknown>>;
    return {
      view: value.view === "karaoke" ? "karaoke" : "stanza",
      size: value.size === "large" || value.size === "xlarge" ? value.size : "normal",
      autoScroll: typeof value.autoScroll === "boolean" ? value.autoScroll : DEFAULT_HYMN_PREFS.autoScroll,
      calm: typeof value.calm === "boolean" ? value.calm : DEFAULT_HYMN_PREFS.calm,
    };
  } catch {
    return DEFAULT_HYMN_PREFS;
  }
}

function read(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

let memory: HymnPrefs | null = null;

export function useHymnPrefs(): [HymnPrefs, (patch: Partial<HymnPrefs>) => void] {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const stored = useMemo(() => parseHymnPrefs(raw), [raw]);
  const prefs = memory ?? stored;
  const update = useCallback((patch: Partial<HymnPrefs>) => {
    const next = { ...(memory ?? parseHymnPrefs(read())), ...patch };
    // Ook zonder opslag blijft de keuze gelden zolang de pagina openstaat.
    memory = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* geen opslag: de keuze geldt alleen voor deze sessie */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [prefs, update];
}
