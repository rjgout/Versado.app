"use client";

import { useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import FinishedPuzzleRow from "@/components/puzzle/FinishedPuzzleRow";
import { fetchJson } from "@/lib/data/fetchJson";
import { useLiveQuery } from "@/lib/data/hooks";
import type { HistoryItem } from "@/lib/puzzle/history";

interface Page { items: HistoryItem[]; nextCursor: string | null }

const timeOf = (item: HistoryItem) => Date.parse(item.finishedAt);
const rankOf = (item: HistoryItem) => (item.kind === "MATCH" ? 1 : 0);
/** Dezelfde volgorde als de server (history.ts): afrondtijd, dan soort, dan id; nieuwste eerst. */
const byNewest = (a: HistoryItem, b: HistoryItem) => timeOf(b) - timeOf(a) || rankOf(b) - rankOf(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

// Alle afgeronde gezamenlijke puzzels en wedstrijden, de nieuwste eerst, per pagina van de server. De eerste pagina komt uit de
// live-datalaag (een net afgeronde puzzel verschijnt zonder verversen); "Meer laden" haalt de volgende pagina met de cursor van de
// server. Wat al getoond werd blijft staan, zodat een verversing van de eerste pagina nooit een item laat verdwijnen of verspringen.
export default function PuzzleHistoryClient() {
  const t = useT();
  const first = useLiveQuery<Page>(["puzzle", "history"], () => fetchJson<Page>("/api/puzzle/history"), { scopes: ["games"], staleTime: 5000 });
  const [shown, setShown] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined); // undefined: nog niet verder geladen
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);

  const items = useMemo(() => {
    const map = new Map<string, HistoryItem>();
    for (const item of [...(first.data?.items ?? []), ...shown]) map.set(item.key, item);
    return [...map.values()].sort(byNewest);
  }, [first.data, shown]);
  const nextCursor = cursor === undefined ? first.data?.nextCursor ?? null : cursor;

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true); setMoreError(false);
    try {
      const page = await fetchJson<Page>(`/api/puzzle/history?cursor=${encodeURIComponent(nextCursor)}`);
      setShown(items.concat(page.items)); setCursor(page.nextCursor);
    } catch { setMoreError(true); } finally { setLoadingMore(false); }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 pb-8">
      <header><h1 className="text-2xl font-extrabold text-vs-fg">{t("puzzleTogether.overview.historyTitle")}</h1><p className="mt-1 text-vs-fg-2">{t("puzzleTogether.overview.historyIntro")}</p></header>
      <section aria-live="polite" aria-busy={first.isFetching || loadingMore}>
        {!first.data && first.error ? <p role="alert" className="text-sm text-red-600">{t("puzzleTogether.overview.historyError")} <button type="button" className="font-bold underline" onClick={() => void first.refetch()}>{t("puzzleTogether.overview.historyRetry")}</button></p>
          : !first.data ? <p className="text-vs-fg-2">{t("puzzleTogether.overview.historyLoading")}</p>
          : items.length === 0 ? <p className="rounded-2xl border border-vs-line bg-vs-surface p-4 text-vs-fg-2">{t("puzzleTogether.overview.historyEmpty")}</p>
          : <ul className="flex flex-col gap-2">{items.map((item) => <FinishedPuzzleRow key={item.key} item={item} />)}</ul>}
      </section>
      {moreError && <p role="alert" className="text-sm text-red-600">{t("puzzleTogether.overview.historyError")}</p>}
      {nextCursor && <button type="button" className="btn-secondary min-h-12 self-center" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? t("puzzleTogether.overview.historyLoading") : t("puzzleTogether.overview.historyLoadMore")}</button>}
    </div>
  );
}
