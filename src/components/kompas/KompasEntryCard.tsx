"use client";
import KompasEntryCardView from "./KompasEntryCardView";

import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { findRow, type KompasRow } from "@/lib/kompas/state";

/**
 * De permanente ingang naar Ontdek Versado (Versado Kompas): op Vandaag en op
 * het profiel. Bewust geen extra tab in de onderbalk. Eén rij met een grote
 * tikdoel, ook zonder app-ervaring herkenbaar.
 */
export default function KompasEntryCard({ className = "" }: { className?: string }) {
  // Voor wie Ontdek Versado nog nooit opende (ook bestaande accounts): eenmalig een rustig "Nieuw"-label,
  // zonder pop-up. Het verdwijnt zodra de uitleg geopend is.
  const state = useLiveQuery<{ rows: KompasRow[] }>(["kompas", "state"], () => fetchJson<{ rows: KompasRow[] }>("/api/kompas/state"), { scopes: ["kompas"], staleTime: 60_000 });
  const isNew = state.data ? !findRow(state.data.rows, { topicId: "versado", scope: "", kind: "GUIDE" }) : false;
  return <KompasEntryCardView isNew={isNew} className={className}/>;
}
