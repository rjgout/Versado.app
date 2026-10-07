"use client";

import { useEffect, useState } from "react";
import UserAvatar from "@/components/UserAvatar";
import UserTag from "@/components/UserTag";
import { useT } from "@/components/I18nProvider";
import { useCompanion } from "@/components/versado/PersonalMascot";
import { quickMissionaryTitle } from "@/lib/gameCatalog";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import type { QuickMissionaryDuoEntry } from "@/lib/snelleZendeling/duoLeaderboard";
import { boardsFor, effectiveBoard, type LeaderboardBoard, type LeaderboardKind } from "@/lib/snelleZendeling/leaderboardQuery";

interface Entry { rank: number; userId: string; handle: string; discriminator: string; score: number }
type Board = LeaderboardBoard;
type Kind = LeaderboardKind;

export default function QuickMissionaryLeaderboard({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const { character } = useCompanion();
  const [board, setBoard] = useState<Board>("today");
  const [kind, setKind] = useState<Kind>("solo");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  // De Duo-ranking verandert ook buiten dit scherm (een gezamenlijke run eindigt): via de centrale live-data-laag.
  const duo = useLiveQuery<{ entries: QuickMissionaryDuoEntry[] }>(["quick-missionary-duo"], () => fetchJson("/api/snelle-zendeling/leaderboard?type=duo&board=all-time"), { scopes: ["games"], staleTime: 1_000 });
  useEffect(() => {
    if (kind !== "solo") return;
    fetch(`/api/snelle-zendeling/leaderboard?board=${board}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { entries: Entry[] }) => setEntries(data.entries))
      .catch(() => setEntries([]));
  }, [board, kind]);

  return (
    <section className="card flex flex-col gap-3" aria-labelledby="quick-missionary-leaderboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wide text-vs-fg-3">{quickMissionaryTitle(t, character)}</p>
          <h2 id="quick-missionary-leaderboard" className="text-lg font-extrabold text-vs-fg">{t("quickMissionary.leaderboard")}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-vs-subtle p-1" role="tablist" aria-label={t("quickMissionary.duo.kinds")}>
          {(["solo", "duo"] as Kind[]).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => setKind(value)} data-leaderboard-kind={value} className={`rounded-full px-3 py-1 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent ${kind === value ? "bg-vs-surface text-vs-accent shadow-sm" : "text-vs-fg-3"}`}>
              {t(value === "solo" ? "quickMissionary.duo.solo" : "quickMissionary.duo.tab")}
            </button>
          ))}
        </div>
        {boardsFor(kind).length > 1 && (
        <div className="flex rounded-full bg-vs-subtle p-1" role="tablist" aria-label={t("quickMissionary.leaderboardTabs")}>
          {boardsFor(kind).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={effectiveBoard(kind, board) === value} onClick={() => setBoard(value)} className={`rounded-full px-3 py-1 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent ${effectiveBoard(kind, board) === value ? "bg-vs-surface text-vs-accent shadow-sm" : "text-vs-fg-3"}`}>
              {t(value === "today" ? "quickMissionary.today" : "quickMissionary.allTime")}
            </button>
          ))}
        </div>
        )}
        </div>
      </div>
      {!compact && <p className="text-sm text-vs-fg-2">{kind === "duo" ? t("quickMissionary.duo.explain") : t(board === "today" ? "quickMissionary.dailyExplain" : "quickMissionary.allTimeExplain")}</p>}
      {kind === "duo" ? <DuoList entries={duo.data?.entries ?? null} /> : !entries ? <p className="text-sm text-vs-fg-3">{t("common.loading")}</p> : entries.length === 0 ? <p className="text-sm text-vs-fg-2">{t("quickMissionary.emptyLeaderboard")}</p> : (
        <ol className="flex flex-col divide-y divide-vs-line">
          {entries.map((entry) => (
            <li key={entry.userId} className={`flex items-center gap-3 py-2 ${entry.rank > 50 ? "rounded-xl bg-vs-accent-soft px-2" : ""}`}>
              <span className="w-7 text-center font-extrabold tabular-nums text-vs-fg-3">{entry.rank}</span>
              <UserAvatar id={entry.userId} handle={entry.handle} />
              <span className="min-w-0 flex-1 truncate font-semibold text-vs-fg"><UserTag handle={entry.handle} discriminator={entry.discriminator} /></span>
              <span className="font-extrabold tabular-nums text-vs-fg">{entry.score}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Een duo is één ranking-entry: twee avatars en namen samen, met één gezamenlijke Duo-score. */
function DuoList({ entries }: { entries: QuickMissionaryDuoEntry[] | null }) {
  const t = useT();
  if (!entries) return <p className="text-sm text-vs-fg-3">{t("common.loading")}</p>;
  if (entries.length === 0) return <p className="text-sm text-vs-fg-2">{t("quickMissionary.duo.empty")}</p>;
  return (
    <ol className="flex flex-col divide-y divide-vs-line" data-duo-leaderboard>
      {entries.map((entry) => (
        <li key={entry.key} data-duo-entry={entry.key} aria-label={t("quickMissionary.duo.entry", { a: entry.players[0].handle, b: entry.players[1].handle, score: entry.score })} className={`flex items-center gap-3 py-2 ${entry.rank > 50 || entry.mine ? "rounded-xl bg-vs-accent-soft px-2" : ""}`}>
          <span className="w-7 shrink-0 text-center font-extrabold tabular-nums text-vs-fg-3">{entry.rank}</span>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex shrink-0 -space-x-2">
              {entry.players.map((player) => <UserAvatar key={player.userId} id={player.userId} handle={player.handle} className="ring-2 ring-vs-surface" />)}
            </span>
            <span className="min-w-0 truncate font-semibold text-vs-fg">
              <UserTag handle={entry.players[0].handle} discriminator={entry.players[0].discriminator} />
              <span className="px-1 text-vs-fg-3" aria-hidden>+</span>
              <UserTag handle={entry.players[1].handle} discriminator={entry.players[1].discriminator} />
            </span>
          </span>
          <span className="font-extrabold tabular-nums text-vs-fg">{entry.score}</span>
        </li>
      ))}
    </ol>
  );
}
