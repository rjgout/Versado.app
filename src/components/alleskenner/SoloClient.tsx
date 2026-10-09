"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SoloLeaderboardEntry, SoloOverview } from "@/lib/alleskenner/solo";
import UserTag from "@/components/UserTag";
import UserAvatar from "@/components/UserAvatar";
import { useT } from "@/components/I18nProvider";
import RankMedal from "@/components/versado/RankMedal";

type Board = "today" | "week" | "friends";

const BOARDS: Board[] = ["today", "week", "friends"];

/**
 * Alleen spelen: De Slimste Heilige van de dag (één poging, klassement) en vrij
 * oefenen. Het potje zelf draait in AlleskennerRoom, met dezelfde rondes als
 * een quizavond behalve de finale.
 */
export default function SoloClient({ myUserId }: { myUserId: string }) {
  const t = useT();
  const router = useRouter();
  const [overview, setOverview] = useState<SoloOverview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [board, setBoard] = useState<Board>("today");
  const [busy, setBusy] = useState<"DAILY" | "PRACTICE" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/alleskenner/solo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setOverview)
      .catch(() => setLoadError(true));
  }, []);

  async function start(mode: "DAILY" | "PRACTICE") {
    setBusy(mode);
    setError(null);
    const res = await fetch("/api/alleskenner/solo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(null);
      setError(data.error ?? t("gamesHub.createFailed"));
      return;
    }
    router.push(`/alleskenner/alleen/${data.runId}`);
  }

  const today = overview?.today;
  const entries = overview?.leaderboards[board] ?? [];

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card !bg-gradient-to-br from-brand-600 to-brand-800 text-white !border-0 flex flex-col gap-3">
          <p className="text-4xl" aria-hidden>
            🧠
          </p>
          <h1 className="text-2xl font-extrabold">{t("alleskenner.dailyTitle")}</h1>
          <p className="text-brand-100 text-sm">
            {t("alleskenner.dailyText")}
          </p>
          {!overview ? (
            <p className="text-sm text-brand-100">{loadError ? t("alleskenner.standingFailed") : t("common.loading")}</p>
          ) : today!.status === "FINISHED" ? (
            <div className="rounded-2xl bg-white/15 px-4 py-3 flex items-center justify-between gap-3">
              <span>
                <span className="block text-xs font-bold uppercase tracking-wider text-brand-100">{t("alleskenner.playedToday")}</span>
                <span className="text-2xl font-extrabold tabular-nums">{t("alleskenner.secondsN", { n: today!.seconds })}</span>
              </span>
              <span className="text-right text-sm font-bold">
                {today!.rank !== null && <span className="block">{t("alleskenner.place", { n: today!.rank })}</span>}
                <span className="text-gold-400">+{today!.xpEarned} XP</span>
              </span>
            </div>
          ) : today!.status === "ABANDONED" ? (
            <p className="rounded-2xl bg-white/15 px-4 py-3 text-sm font-semibold">
              {t("alleskenner.abandonedToday")}
            </p>
          ) : (
            <button
              className="btn-primary !bg-gold-500 !text-brand-900 self-start"
              onClick={() => start("DAILY")}
              disabled={busy !== null}
            >
              {busy === "DAILY"
                ? t("courses.busy")
                : today!.status === "IN_PROGRESS"
                  ? t("alleskenner.continuePlaying")
                  : t("alleskenner.playToday")}
            </button>
          )}
        </div>

        <div className="card flex flex-col gap-3">
          <p className="text-4xl" aria-hidden>
            🎯
          </p>
          <h2 className="text-2xl font-extrabold dark:text-slate-100">{t("alleskenner.practiceTitle")}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("alleskenner.practiceText")}
          </p>
          <button className="btn-secondary self-start mt-auto" onClick={() => start("PRACTICE")} disabled={busy !== null}>
            {busy === "PRACTICE" ? t("courses.busy") : overview?.practiceRunId ? t("alleskenner.newPractice") : t("alleskenner.startPractice")}
          </button>
          {overview?.practiceRunId && (
            <button
              className="text-sm font-semibold text-brand-700 dark:text-brand-300 hover:underline self-start"
              onClick={() => router.push(`/alleskenner/alleen/${overview.practiceRunId}`)}
            >
              {t("alleskenner.continuePractice")}
            </button>
          )}
        </div>
      </div>

      {error && <p className="card !py-3 text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>}

      <div className="card flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-extrabold text-lg dark:text-slate-100">{t("alleskenner.leaderboard")}</h2>
          <div className="flex rounded-full bg-slate-100 dark:bg-slate-700 p-1">
            {BOARDS.map((b) => (
              <button
                key={b}
                onClick={() => setBoard(b)}
                className={`rounded-full px-3 py-1 text-sm font-bold transition ${
                  board === b
                    ? "bg-white dark:bg-slate-900 text-brand-700 dark:text-brand-300 shadow-sm"
                    : "text-slate-500 dark:text-slate-300"
                }`}
              >
                {t(`alleskenner.boards.${b}.label`)}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {board === "week"
            ? t("alleskenner.weekExplain")
            : overview
              ? overview.playersToday === 1
                ? t("alleskenner.todayExplainOne", { n: overview.playersToday })
                : t("alleskenner.todayExplainMany", { n: overview.playersToday })
              : t("alleskenner.todayExplain")}
        </p>
        {!overview ? (
          <p className="text-sm text-slate-400">{loadError ? t("alleskenner.leaderboardFailed") : t("common.loading")}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t(`alleskenner.boards.${board}.empty`)}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
            {entries.map((e) => (
              <LeaderboardRow key={e.userId} entry={e} mine={e.userId === myUserId} board={board} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function LeaderboardRow({ entry, mine, board }: { entry: SoloLeaderboardEntry; mine: boolean; board: Board }) {
  const t = useT();
  return (
    <li className={`flex items-center gap-3 py-2 ${mine ? "rounded-xl bg-brand-50 dark:bg-slate-700/60 px-2 -mx-2" : ""}`}>
      {entry.rank <= 3 ? (
        <RankMedal
          rank={entry.rank as 1 | 2 | 3}
          label={entry.rank === 1 ? t("profile.medalGold") : entry.rank === 2 ? t("profile.medalSilver") : t("profile.medalBronze")}
        />
      ) : <span className="w-7 text-center font-extrabold text-slate-400">{entry.rank}</span>}
      <UserAvatar id={entry.userId} handle={entry.handle} />
      <span className="flex-1 min-w-0 truncate font-semibold dark:text-slate-100">
        <UserTag handle={entry.handle} discriminator={entry.discriminator} />
        {mine && <span className="ml-1.5 text-xs font-bold text-brand-600 dark:text-brand-300">{t("lobby.you")}</span>}
      </span>
      {board === "week" && entry.days !== undefined && (
        <span className="text-xs text-slate-400">
          {entry.days === 1 ? t("alleskenner.daysOne", { n: entry.days }) : t("alleskenner.daysMany", { n: entry.days })}
        </span>
      )}
      <span className="font-extrabold tabular-nums dark:text-slate-100">{entry.seconds} s</span>
    </li>
  );
}
