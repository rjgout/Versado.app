"use client";

import { useLiveQuery } from "./hooks";
import { fetchJson } from "./fetchJson";

/** Dezelfde centrale voorraad voor puzzels, winkel en bestaande hintspellen. */
export function useHintInventory(initialBalance?: number) {
  return useLiveQuery<{ hintBalance: number }>(["hints", "balance"], () => fetchJson("/api/hints"), {
    scopes: ["games"], staleTime: 1000,
    initialData: initialBalance === undefined ? undefined : { hintBalance: initialBalance },
  });
}
