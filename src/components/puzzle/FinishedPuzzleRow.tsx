"use client";

import Link from "next/link";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { getLanguage } from "@/lib/languages";
import type { HistoryItem } from "@/lib/puzzle/history";

// Eén afgeronde gezamenlijke puzzel of wedstrijd, voor de hub én de geschiedenisweergave (zelfde rij, zelfde acties).
// `import type` uit history.ts: dat bestand is voor de server, hier komt alleen het type mee.
export const FINISHED_ROW_CLASS = "flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800";

export default function FinishedPuzzleRow({ item }: { item: HistoryItem }) {
  const t = useT(); const locale = getLanguage(useUiLanguage()).intlLocale;
  const date = new Date(item.finishedAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const href = item.kind === "COOP" ? `/jigsaw/samen/${item.id}` : `/jigsaw/wedstrijd/${item.id}`;
  const label = item.kind === "MATCH" && item.questionOpen ? t("puzzleTogether.overview.answerQuestion") : t("puzzleTogether.overview.viewResult");
  return (
    <li className={FINISHED_ROW_CLASS}>
      <span className="min-w-0 text-sm">
        <span className="vs-wrap block">{t(item.kind === "COOP" ? "puzzleTogether.overview.coopLabel" : "puzzleTogether.overview.matchLabel")} · {item.pieceCount} · {t("puzzleTogether.overview.withNames", { names: item.players.join(", ") })}</span>
        <time dateTime={item.finishedAt} className="block text-xs text-vs-fg-2">{t("puzzleTogether.overview.finishedOn", { date })}</time>
      </span>
      <Link className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-3 text-sm font-semibold" href={href}>{label}</Link>
    </li>
  );
}
