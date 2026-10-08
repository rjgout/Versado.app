"use client";

import { jsonMutation } from "@/lib/data/mutation";
import type { KompasKind, KompasStatusValue } from "@/lib/kompas/state";

/**
 * Legt vast dat de gebruiker iets met een uitleg of rondleiding deed. Faalt
 * stil: de status is een gemak, geen voorwaarde om iets te kunnen lezen of te
 * volgen, en raakt nooit XP, reeksen of resultaten.
 */
export async function recordKompasState(input: { topicId: string; scope: string; kind: KompasKind; status: KompasStatusValue }): Promise<void> {
  try {
    await jsonMutation("/api/kompas/state", { json: input }, { invalidates: "kompasChanged" });
  } catch {
    // niet opgeslagen: dezelfde uitleg kan dan eenmaal opnieuw verschijnen
  }
}
