"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { KompasIcon } from "@/components/kompas/KompasIcon";
import { interactiveCard } from "@/components/versado/styles";

/**
 * De permanente ingang naar Ontdek Versado (Versado Kompas): op Vandaag en op
 * het profiel. Bewust geen extra tab in de onderbalk. Eén rij met een grote
 * tikdoel, ook zonder app-ervaring herkenbaar.
 */
export default function KompasEntryCard({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <Link href="/kompas" data-kompas-target="kompas-entry" className={`${interactiveCard} flex min-h-[4.5rem] items-center gap-3 p-3 sm:p-4 ${className}`}>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-vs-accent-soft text-vs-accent">
        <KompasIcon className="h-7 w-7" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-lg font-extrabold leading-tight text-vs-fg">{t("kompas.entry.title")}</span>
        <span className="text-sm leading-snug text-vs-fg-2">{t("kompas.entry.text")}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-vs-fg-3" aria-hidden />
    </Link>
  );
}
