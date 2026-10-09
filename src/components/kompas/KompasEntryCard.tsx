"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import VisualIdentityIcon from "@/components/versado/VisualIdentityIcon";
import { interactiveCard } from "@/components/versado/styles";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { findRow, type KompasRow } from "@/lib/kompas/state";

/**
 * De permanente ingang naar Ontdek Versado (Versado Kompas): op Vandaag en op
 * het profiel. Bewust geen extra tab in de onderbalk. Eén rij met een grote
 * tikdoel, ook zonder app-ervaring herkenbaar.
 */
export default function KompasEntryCard({ className = "" }: { className?: string }) {
  const t = useT();
  // Voor wie Ontdek Versado nog nooit opende (ook bestaande accounts): eenmalig een rustig "Nieuw"-label,
  // zonder pop-up. Het verdwijnt zodra de uitleg geopend is.
  const state = useLiveQuery<{ rows: KompasRow[] }>(["kompas", "state"], () => fetchJson<{ rows: KompasRow[] }>("/api/kompas/state"), { scopes: ["kompas"], staleTime: 60_000 });
  const isNew = state.data ? !findRow(state.data.rows, { topicId: "versado", scope: "", kind: "GUIDE" }) : false;
  return (
    <Link href="/kompas" data-kompas-target="kompas-entry" className={`${interactiveCard} flex min-h-[4.5rem] items-center gap-3 p-3 sm:p-4 ${className}`}>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-vs-accent-soft text-vs-accent">
        <VisualIdentityIcon asset="kompas" className="h-12 w-12" sizes="48px" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-center gap-2 text-lg font-extrabold leading-tight text-vs-fg">
          {t("kompas.entry.title")}
          {isNew && <span className="rounded-full bg-vs-accent px-2 py-0.5 text-xs font-extrabold text-vs-on-accent">{t("kompas.entry.new")}</span>}
        </span>
        <span className="text-sm leading-snug text-vs-fg-2">{t("kompas.entry.text")}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-vs-fg-3" aria-hidden />
    </Link>
  );
}
