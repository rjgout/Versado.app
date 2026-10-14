"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useUiLanguage } from "@/components/I18nProvider";
import RecordCard from "@/components/puzzle/RecordCard";
import { fetchJson } from "@/lib/data/fetchJson";
import { useLiveQuery } from "@/lib/data/hooks";
import { getLanguage } from "@/lib/languages";
import type { OwnRecordView } from "@/lib/puzzle/records";

type Mode = "ALL" | "SOLO" | "MATCH";
type Cat = "ALL" | "NO_HINTS" | "WITH_HINTS";
const PIECES = [6, 12, 24, 48, 96] as const;
const LEVELS = [["DISCOVERER", "jigsaw.discoverer"], ["ADVENTURER", "jigsaw.adventurer"], ["EXPERT", "jigsaw.expert"], ["MASTER", "jigsaw.master"]] as const;

// Persoonlijke records: altijd alleen van jezelf, ongeacht je privacy-instelling. Data via de live-datalaag
// (ophalen bij openen, focus en na een gerelateerde mutation), dus een nieuw record verschijnt zonder verversen.
export default function RecordsClient() {
  const t = useT(); const locale = getLanguage(useUiLanguage()).intlLocale;
  const [mode, setMode] = useState<Mode>("ALL"); const [cat, setCat] = useState<Cat>("ALL"); const [pieces, setPieces] = useState<number | null>(null); const [level, setLevel] = useState<string | null>(null);
  const params = new URLSearchParams();
  if (mode !== "ALL") params.set("mode", mode); if (cat !== "ALL") params.set("hintCategory", cat); if (pieces) params.set("pieceCount", String(pieces)); if (level) params.set("difficulty", level);
  const query = useLiveQuery<{ records: OwnRecordView[] }>(["puzzle", "records", params.toString()], () => fetchJson<{ records: OwnRecordView[] }>(`/api/puzzle/records?${params}`), { scopes: ["games", "friends"], staleTime: 2000 });
  const records = query.data?.records;
  const chip = (active: boolean) => `btn-secondary min-h-11 ${active ? "!border-vs-xp !bg-vs-xp/15" : ""}`;
  const group = (label: string, children: React.ReactNode) => <fieldset className="min-w-0"><legend className="text-sm font-semibold text-vs-fg-2">{label}</legend><div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={label}>{children}</div></fieldset>;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 pb-8">
      <header><h1 className="text-2xl font-extrabold text-vs-fg">{t("puzzleRecords.title")}</h1><p className="mt-1 text-vs-fg-2">{t("puzzleRecords.intro")}</p></header>
      <section className="grid gap-4 sm:grid-cols-2" aria-label={t("puzzleRecords.title")}>
        {group(t("puzzleRecords.filterMode"), (["ALL", "SOLO", "MATCH"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} className={chip(mode === value)} onClick={() => setMode(value)}>{value === "ALL" ? t("puzzleRecords.allModes") : t(`puzzleRecords.mode${value}`)}</button>))}
        {group(t("puzzleRecords.filterHints"), (["ALL", "NO_HINTS", "WITH_HINTS"] as const).map((value) => <button key={value} type="button" aria-pressed={cat === value} className={chip(cat === value)} onClick={() => setCat(value)}>{value === "ALL" ? t("puzzleRecords.allModes") : t(`puzzleRecords.cat${value}`)}</button>))}
        {group(t("puzzleRecords.filterPieces"), <><button type="button" aria-pressed={pieces === null} className={chip(pieces === null)} onClick={() => setPieces(null)}>{t("puzzleRecords.allPieces")}</button>{PIECES.map((n) => <button key={n} type="button" aria-pressed={pieces === n} className={chip(pieces === n)} onClick={() => setPieces(n)}>{n}</button>)}</>)}
        {group(t("puzzleRecords.filterLevel"), <><button type="button" aria-pressed={level === null} className={chip(level === null)} onClick={() => setLevel(null)}>{t("puzzleRecords.allLevels")}</button>{LEVELS.map(([value, key]) => <button key={value} type="button" aria-pressed={level === value} className={chip(level === value)} onClick={() => setLevel(value)}>{t(key)}</button>)}</>)}
      </section>
      <p className="text-sm text-vs-fg-2">{t("puzzleRecords.lbHintsRule")}</p>
      <section aria-live="polite" aria-busy={query.isFetching}>
        {!records && query.error ? <p role="alert" className="text-sm text-red-600">{t("puzzleRecords.error")} <button type="button" className="font-bold underline" onClick={() => void query.refetch()}>{t("puzzleRecords.retry")}</button></p>
          : !records ? <p className="text-vs-fg-2">{t("puzzleRecords.loading")}</p>
          : records.length === 0 ? <p className="rounded-2xl border border-vs-line bg-vs-surface p-4 text-vs-fg-2">{mode === "ALL" && cat === "ALL" && !pieces && !level ? t("puzzleRecords.empty") : t("puzzleRecords.emptyFiltered")}</p>
          : <ul className="flex flex-col gap-2">{records.map((record) => <RecordCard key={record.id} record={record} locale={locale} />)}</ul>}
      </section>
    </div>
  );
}
