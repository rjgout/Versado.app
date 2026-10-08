"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { parseRecent, pushRecent } from "@/lib/dictionaryView";

// Onlangs bekeken woorden leven alleen op dit apparaat (localStorage, per
// collectie): een gemak per bezoeker, geen servergegevens. Zonder opslag
// (privévenster, geblokkeerd) werkt het woordenboek gewoon zonder dit lijstje.
const EVENT = "versado:recent-words";
const keyFor = (collectionId: string) => `versado:dictionary:recent:${collectionId}`;

function read(collectionId: string): string | null {
  try {
    return window.localStorage.getItem(keyFor(collectionId));
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

export function rememberWord(collectionId: string, word: string): void {
  try {
    window.localStorage.setItem(keyFor(collectionId), JSON.stringify(pushRecent(parseRecent(read(collectionId)), word)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* geen opslag: geen lijstje */
  }
}

export function useRecentWords(collectionId: string): string[] {
  const raw = useSyncExternalStore(subscribe, useCallback(() => read(collectionId), [collectionId]), () => null);
  return useMemo(() => parseRecent(raw), [raw]);
}
