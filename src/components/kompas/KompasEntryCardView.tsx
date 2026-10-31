"use client";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { ChevronRight } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import VisualIdentityIcon from "@/components/versado/VisualIdentityIcon";
import { interactiveCard } from "@/components/versado/styles";
export default function KompasEntryCardView({ isNew, className = "" }: { isNew: boolean; className?: string }) {
  const t = useT();
  return (
    <Link href="/kompas" data-kompas-target="kompas-entry" className={`${interactiveCard} flex min-h-[4.5rem] items-center gap-3 p-3 sm:p-4 ${className}`}>
      <span className="vs-decor flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-vs-accent-soft text-vs-accent">
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
