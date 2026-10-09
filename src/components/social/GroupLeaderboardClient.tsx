"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Award, Trophy } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { surfaceCard } from "@/components/versado/styles";
import { StreakBadge } from "@/components/social/shared";
import RankMedal from "@/components/versado/RankMedal";

interface Row {
  rank: number;
  id: string;
  name: string;
  memberCount: number;
  currentStreak: number;
  achievementCount: number;
  isMine: boolean;
}

/**
 * Openbare groepsranglijst: alleen groepen die er zelf voor kiezen, en
 * nooit leden (dus ook geen manier om via de ranglijst mensen te vinden).
 */
export default function GroupLeaderboardClient() {
  const t = useT();
  const [sort, setSort] = useState<"streak" | "size">("streak");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setRows(null);
    fetch(`/api/groups/leaderboard?sort=${sort}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => active && (setRows(data.groups), setFailed(false)))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [sort]);

  const tabs: { id: "streak" | "size"; label: string }[] = [
    { id: "streak", label: t("together.leaderboard.byStreak") },
    { id: "size", label: t("together.leaderboard.bySize") },
  ];
  const members = (n: number) => (n === 1 ? t("together.common.membersOne") : t("together.common.membersMany", { n }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-vs-fg">
        <Trophy className="h-6 w-6 text-vs-league" aria-hidden />
        {t("together.pages.groupLeaderboard")}
      </h1>
      <p className="text-sm text-vs-fg-2">{t("together.leaderboard.intro")}</p>
      <div role="tablist" className="flex w-full max-w-md rounded-full border border-vs-line bg-vs-surface p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={sort === tab.id}
            onClick={() => setSort(tab.id)}
            className={`flex h-10 flex-1 items-center justify-center rounded-full text-sm font-bold transition-colors ${sort === tab.id ? "bg-vs-accent text-vs-on-accent" : "text-vs-fg-2 hover:bg-vs-subtle"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {failed && <p className="text-sm text-vs-danger">{t("together.common.error")}</p>}
      {!rows && !failed && <p className="text-sm text-vs-fg-3">{t("common.loading")}</p>}
      {rows && rows.length === 0 && <p className={`${surfaceCard} p-4 text-sm text-vs-fg-2`}>{t("together.leaderboard.empty")}</p>}
      {rows && rows.length > 0 && (
        <ol className={`${surfaceCard} flex flex-col`}>
          {rows.map((row) => {
            const body = (
              <>
                {row.rank <= 3 ? (
                  <RankMedal
                    rank={row.rank as 1 | 2 | 3}
                    label={row.rank === 1 ? t("profile.medalGold") : row.rank === 2 ? t("profile.medalSilver") : t("profile.medalBronze")}
                  />
                ) : <span className="w-8 shrink-0 text-right text-sm font-extrabold tabular-nums text-vs-fg-3">{row.rank}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold text-vs-fg">{row.name}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-vs-fg-3">
                    {members(row.memberCount)}
                    {row.achievementCount > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <Award className="h-3.5 w-3.5" aria-hidden />
                        {row.achievementCount}
                      </span>
                    )}
                    {row.isMine && <span className="text-vs-accent">{t("together.leaderboard.yours")}</span>}
                  </span>
                </span>
                <StreakBadge days={row.currentStreak} />
              </>
            );
            return (
              <li key={row.id} className="border-b border-vs-line last:border-b-0">
                {row.isMine ? (
                  <Link href={`/groups/${row.id}`} className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-vs-subtle">
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-w-0 items-center gap-3 px-4 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
