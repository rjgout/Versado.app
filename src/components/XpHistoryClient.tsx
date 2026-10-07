"use client";

import { useState, type ReactNode } from "react";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import Link from "next/link";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { getLanguage } from "@/lib/languages";
import { HeartPulse } from "lucide-react";
import SystemIcon from "@/components/versado/SystemIcon";


type XPReason =
  | "LESSON_COMPLETED"
  | "PERFECT_SCORE"
  | "LIVE_GAME_PLAYED"
  | "LIVE_GAME_WON"
  | "ACHIEVEMENT"
  | "QUICK_PRACTICE"
  | "PODCAST_LESSON_COMPLETED"
  | "KIDS_STORY_COMPLETED"
  | "HINT_PURCHASED"
  | "GENEES_PURCHASED"
  | "FREEZE_PURCHASED"
  | "CHAPTER_GUESS_COMPLETED"
  | "WORD_GAME_WON"
  | "INTRO_LESSON_COMPLETED"
  | "ALLESKENNER_SOLO"
  | "WORD_SEARCH_COMPLETED"
  | "STUDY_TOGETHER";

interface XpPage {
  xpTotal: number;
  xpThisWeek?: number;
  hasMore: boolean;
  transactions: XpTransaction[];
}

interface XpTransaction {
  id: string;
  amount: number;
  reason: XPReason;
  createdAt: string;
}

const REASON_ICONS: Record<XPReason, ReactNode> = {
  LESSON_COMPLETED: "📖",
  PERFECT_SCORE: "🎯",
  LIVE_GAME_PLAYED: "⚡",
  LIVE_GAME_WON: "🏆",
  ACHIEVEMENT: "🏅",
  QUICK_PRACTICE: "✍️",
  PODCAST_LESSON_COMPLETED: "🎙️",
  KIDS_STORY_COMPLETED: "🧒",
  HINT_PURCHASED: "💡",
  GENEES_PURCHASED: <HeartPulse className="h-4 w-4 text-vs-league" aria-hidden />,
  FREEZE_PURCHASED: <SystemIcon kind="freeze" className="h-4 w-4 text-ice-500" aria-hidden />,
  CHAPTER_GUESS_COMPLETED: "🔍",
  WORD_GAME_WON: "🔤",
  INTRO_LESSON_COMPLETED: "🧭",
  ALLESKENNER_SOLO: "🧠",
  WORD_SEARCH_COMPLETED: "🔎",
  STUDY_TOGETHER: "👥",
};

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function mondayOfWeek(d: Date): number {
  const x = new Date(d);
  const day = x.getDay(); // 0 = zondag
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  return startOfDay(x);
}

// Groepeert de (al chronologisch aflopend gesorteerde) transacties in
// vaste, herkenbare emmers — net als bij de reeks-kalender werkt dit
// bewust op de kalenderdag in de tijdzone van de browser, niet op de
// UTC-dagbucket die de server voor streaks gebruikt (hier gaat het puur om
// leesbaarheid, niet om een harde grens zoals bij de streak-logica).
type Bucket = "today" | "yesterday" | "thisWeek" | "earlier";

function groupTransactions(transactions: XpTransaction[]): { label: Bucket; items: XpTransaction[] }[] {
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = mondayOfWeek(now);

  function bucketFor(iso: string): Bucket {
    const time = new Date(iso).getTime();
    if (time >= todayStart) return "today";
    if (time >= yesterdayStart) return "yesterday";
    if (time >= weekStart) return "thisWeek";
    return "earlier";
  }

  const order: Bucket[] = ["today", "yesterday", "thisWeek", "earlier"];
  const byLabel = new Map<Bucket, XpTransaction[]>();
  for (const tx of transactions) {
    const label = bucketFor(tx.createdAt);
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label)!.push(tx);
  }
  return order.flatMap((label) => {
    const items = byLabel.get(label);
    return items && items.length > 0 ? [{ label, items }] : [];
  });
}

function formatRowTime(iso: string, bucket: Bucket, locale: string): string {
  const d = new Date(iso);
  if (bucket === "today" || bucket === "yesterday") {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
  }
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export default function XpHistoryClient() {
  const t = useT();
  const intlLocale = getLanguage(useUiLanguage()).intlLocale;
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  // De eerste pagina is live (nieuwe XP verschijnt vanzelf, ook van een ander apparaat); verder
  // terugbladeren haalt oudere pagina's op die bij de eerste pagina horen. Verandert de eerste
  // pagina, dan begint het bladeren opnieuw: oudere pagina's schuiven anders van plek.
  const first = useLiveQuery<XpPage>(["xp", "history", "first"], () => fetchJson<XpPage>("/api/xp-history?skip=0"), {
    scopes: ["xp"],
  });
  const [older, setOlder] = useState<{ base: XpPage; transactions: XpTransaction[]; hasMore: boolean } | null>(null);
  const page = first.data;
  const olderForPage = page && older && older.base === page ? older : null;
  const transactions = page ? [...page.transactions, ...(olderForPage?.transactions ?? [])] : [];
  const xpTotal = page?.xpTotal ?? null;
  const xpThisWeek = page?.xpThisWeek ?? 0;
  const hasMore = olderForPage ? olderForPage.hasMore : (page?.hasMore ?? false);
  const error = moreError ?? (!page && first.error ? (first.error instanceof Error && !first.error.message.startsWith("HTTP ") ? first.error.message : t("xpHistory.loadFailed")) : null);

  async function loadMore() {
    if (!page || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchJson<XpPage>(`/api/xp-history?skip=${transactions.length}`);
      setOlder({ base: page, transactions: [...(olderForPage?.transactions ?? []), ...next.transactions], hasMore: next.hasMore });
    } catch (e) {
      setMoreError(e instanceof Error && !e.message.startsWith("HTTP ") ? e.message : t("xpHistory.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto card text-center flex flex-col gap-3">
        <p className="text-red-600 dark:text-red-400 font-semibold">{error}</p>
        <Link href="/dashboard" className="btn-secondary self-center">
          {t("wordOfTheDay.back")}
        </Link>
      </div>
    );
  }

  if (xpTotal === null) {
    return <p className="text-center text-slate-400 dark:text-slate-500">{t("common.loading")}</p>;
  }

  const groups = groupTransactions(transactions);

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4 sm:gap-5">
      <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("xpHistory.title")}</h1>

      <div className="card bg-gradient-to-br from-brand-500 to-brand-700 dark:from-brand-600 dark:to-brand-900 text-white !border-brand-300/30 dark:!border-brand-400/20 !shadow-md dark:!shadow-none flex flex-col items-center gap-1 !py-8">
        <SystemIcon kind="xp" className="h-10 w-10 text-gold-400" fill="currentColor" aria-hidden />
        <div className="text-5xl font-extrabold leading-none">{xpTotal}</div>
        <div className="text-brand-100 font-bold text-sm mt-1">{t("xpHistory.collected")}</div>
        {xpThisWeek > 0 && (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-black/15 px-3.5 py-1.5 text-xs font-bold text-gold-400">
            <SystemIcon kind="xp" className="h-4 w-4" fill="currentColor" aria-hidden />
            {t("xpHistory.thisWeek", { xp: xpThisWeek })}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-extrabold text-lg dark:text-slate-100">{t("xpHistory.history")}</h2>
        {groups.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">{t("xpHistory.none")}</p>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="flex flex-col gap-1.5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 px-1">
                {t(`xpHistory.buckets.${group.label}`)}
              </p>
              <div className="card !p-0 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700">
                {group.items.map((tx) => (
                  <div key={tx.id} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg dark:bg-slate-700"
                        aria-hidden
                      >
                        {REASON_ICONS[tx.reason]}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate dark:text-slate-100">{t(`xpHistory.reasons.${tx.reason}`)}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">{formatRowTime(tx.createdAt, group.label, intlLocale)}</p>
                      </div>
                    </div>
                    <span
                      className={`font-extrabold shrink-0 ${tx.amount >= 0 ? "text-brand-600 dark:text-brand-300" : "text-red-500 dark:text-red-400"}`}
                    >
                      {tx.amount >= 0 ? "+" : ""}
                      {tx.amount}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}

        {hasMore && (
          <button className="btn-secondary self-center mt-1" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? t("courses.busy") : t("xpHistory.loadMore")}
          </button>
        )}
      </div>

      <Link
        href="/tools/xp-guide"
        className="card !bg-vs-subtle dark:!bg-vs-surface !border-vs-line flex items-center gap-3 !py-3 hover:ring-2 hover:ring-vs-accent-soft"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-vs-accent-soft text-xl" aria-hidden>
          💡
        </span>
        <div className="min-w-0">
          <p className="font-extrabold text-sm text-vs-fg">{t("xpHistory.whatEarns")}</p>
          <p className="text-xs font-semibold text-vs-accent">{t("xpHistory.overview")}</p>
        </div>
      </Link>
    </div>
  );
}
