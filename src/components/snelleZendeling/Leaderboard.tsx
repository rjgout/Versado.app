"use client";

import { useEffect, useState } from "react";
import UserAvatar from "@/components/UserAvatar";
import UserTag from "@/components/UserTag";
import { useT } from "@/components/I18nProvider";

interface Entry { rank: number; userId: string; handle: string; discriminator: string; score: number }
type Board = "today" | "all-time";

export default function QuickMissionaryLeaderboard({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [board, setBoard] = useState<Board>("today");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  useEffect(() => {
    fetch(`/api/snelle-zendeling/leaderboard?board=${board}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: { entries: Entry[] }) => setEntries(data.entries))
      .catch(() => setEntries([]));
  }, [board]);

  return (
    <section className="card flex flex-col gap-3" aria-labelledby="quick-missionary-leaderboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="quick-missionary-leaderboard" className="text-lg font-extrabold text-vs-fg">{t("quickMissionary.leaderboard")}</h2>
        <div className="flex rounded-full bg-vs-subtle p-1" role="tablist" aria-label={t("quickMissionary.leaderboardTabs")}>
          {(["today", "all-time"] as Board[]).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={board === value} onClick={() => setBoard(value)} className={`rounded-full px-3 py-1 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vs-accent ${board === value ? "bg-vs-surface text-vs-accent shadow-sm" : "text-vs-fg-3"}`}>
              {t(value === "today" ? "quickMissionary.today" : "quickMissionary.allTime")}
            </button>
          ))}
        </div>
      </div>
      {!compact && <p className="text-sm text-vs-fg-2">{t(board === "today" ? "quickMissionary.dailyExplain" : "quickMissionary.allTimeExplain")}</p>}
      {!entries ? <p className="text-sm text-vs-fg-3">{t("common.loading")}</p> : entries.length === 0 ? <p className="text-sm text-vs-fg-2">{t("quickMissionary.emptyLeaderboard")}</p> : (
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
