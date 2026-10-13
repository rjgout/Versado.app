"use client";

import Link from "next/link";
import NextImage from "next/image";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import UserAvatar from "@/components/UserAvatar";
import { fetchJson } from "@/lib/data/fetchJson";
import { useLiveQuery } from "@/lib/data/hooks";
import { formatPuzzleTime } from "@/lib/puzzle/recordFormat";
import type { LeaderboardView, RecordMode, HintCategory } from "@/lib/puzzle/records";

const levelKeys = { DISCOVERER: "jigsaw.discoverer", ADVENTURER: "jigsaw.adventurer", EXPERT: "jigsaw.expert", MASTER: "jigsaw.master" } as const;

// Vriendenranglijst voor één exacte puzzelvariant. Twee categorieën (zonder/met hints) en twee modi (Solo/Tegen elkaar),
// nooit gemengd. De server bepaalt wie erin mag staan; dit scherm toont alleen wat de API teruggeeft.
export default function LeaderboardClient({ variantId, initialMode, initialCategory }: { variantId: string; initialMode: RecordMode; initialCategory: HintCategory }) {
  const t = useT();
  const [mode, setMode] = useState<RecordMode>(initialMode); const [category, setCategory] = useState<HintCategory>(initialCategory);
  const query = useLiveQuery<{ leaderboard: LeaderboardView | null }>(["puzzle", "leaderboard", variantId, mode, category], () => fetchJson(`/api/puzzle/leaderboard?variantId=${encodeURIComponent(variantId)}&mode=${mode}&hintCategory=${category}`), { scopes: ["games", "friends"], staleTime: 2000 });
  const board = query.data?.leaderboard;
  const tab = (active: boolean) => `btn-secondary min-h-11 ${active ? "!border-vs-xp !bg-vs-xp/15" : ""}`;
  const mine = board?.rows.some((row) => row.isMe) ?? false;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-8">
      <header className="flex flex-wrap items-center gap-3">
        {board && <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-vs-subtle"><NextImage src={board.variant.image} alt="" fill unoptimized sizes="96px" className="object-cover" /></div>}
        <div className="min-w-0 flex-1 basis-40">
          <h1 className="text-2xl font-extrabold text-vs-fg">{t("puzzleRecords.lbTitle")}</h1>
          {board && <p className="break-words text-sm text-vs-fg-2">{t("puzzleRecords.image", { n: board.variant.imageNumber })} · {t("puzzleRecords.pieces", { n: board.variant.pieceCount })} · {t(levelKeys[board.variant.difficulty as keyof typeof levelKeys] ?? "jigsaw.adventurer")}</p>}
          <p className="text-sm text-vs-fg-2">{t("puzzleRecords.lbSubtitle")}</p>
        </div>
      </header>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("puzzleRecords.filterMode")}>
        {(["SOLO", "MATCH"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} className={tab(mode === value)} onClick={() => setMode(value)}>{t(`puzzleRecords.mode${value}`)}</button>)}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("puzzleRecords.filterHints")}>
        {(["NO_HINTS", "WITH_HINTS"] as const).map((value) => <button key={value} type="button" aria-pressed={category === value} className={tab(category === value)} onClick={() => setCategory(value)}>{t(`puzzleRecords.cat${value}`)}</button>)}
      </div>
      <p className="text-xs text-vs-fg-2">{t("puzzleRecords.lbHintsRule")}{mode === "MATCH" ? ` ${t("puzzleRecords.lbLegacy")}` : ""}</p>
      <section aria-live="polite" aria-busy={query.isFetching}>
        {!query.data && query.error ? <p role="alert" className="text-sm text-red-600">{t("puzzleRecords.error")} <button type="button" className="font-bold underline" onClick={() => void query.refetch()}>{t("puzzleRecords.retry")}</button></p>
          : !query.data ? <p className="text-vs-fg-2">{t("puzzleRecords.loading")}</p>
          : !board || board.rows.length === 0 ? <p className="rounded-2xl border border-vs-line bg-vs-surface p-4 text-vs-fg-2">{t("puzzleRecords.lbEmpty")}</p>
          : (
            <ol className="flex flex-col gap-2">
              {board.rows.map((row) => (
                <li key={row.user.id} className={`flex min-h-14 min-w-0 items-center gap-3 rounded-2xl border p-3 ${row.isMe ? "border-vs-xp bg-vs-xp/10" : "border-vs-line bg-vs-surface"}`}>
                  <span className="w-12 shrink-0 text-sm font-extrabold tabular-nums text-vs-fg-2" aria-label={t("puzzleRecords.rank", { n: row.rank })}>{row.rank}.</span>
                  <UserAvatar id={row.user.id} handle={row.user.handle} size="sm" />
                  <span className="min-w-0 flex-1 break-words font-bold text-vs-fg">{row.user.handle}{row.isMe ? <span className="ml-1 text-sm font-semibold text-vs-fg-2">({t("puzzleRecords.you")})</span> : null}</span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-lg font-extrabold tabular-nums text-vs-fg">{formatPuzzleTime(row.elapsedMs)}</span>
                    {category === "WITH_HINTS" && <span className="block text-xs text-vs-fg-2">{row.hintsUsed === 1 ? t("puzzleRecords.hintOne") : t("puzzleRecords.hintMany", { n: row.hintsUsed })}{row.extraHintsUsed > 0 ? ` (${t("puzzleRecords.hintStock", { n: row.extraHintsUsed })})` : ""}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
      </section>
      {board && !mine && <p className="text-sm text-vs-fg-2">{t("puzzleRecords.lbEmptyMine")}</p>}
      {board && !board.viewerShares && (
        <p className="rounded-2xl border border-vs-line bg-vs-surface p-3 text-sm text-vs-fg-2">{t("puzzleRecords.lbPrivate")} <Link href="/profile?view=privacy" className="font-bold text-vs-accent underline">{t("puzzleRecords.lbPrivacyLink")}</Link></p>
      )}
      <Link href="/jigsaw/records" className="btn-secondary min-h-12 self-start">{t("puzzleRecords.lbBack")}</Link>
    </div>
  );
}
