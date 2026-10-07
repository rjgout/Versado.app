"use client";

import { Fragment, useEffect, useState } from "react";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { ArrowDown, ArrowUp, Clock } from "lucide-react";
import type { LeagueTier } from "@/generated/prisma/client";
import DivisionEmblem from "@/components/versado/DivisionEmblem";
import { useT } from "@/components/I18nProvider";
import type { TFunction } from "@/lib/i18n/core";
import UserAvatar from "@/components/UserAvatar";
import DivisionScroller from "@/components/DivisionScroller";
import SystemIcon from "@/components/versado/SystemIcon";
import RankMedal from "@/components/versado/RankMedal";

type Zone = "PROMOTION" | "SAFE" | "RELEGATION" | null;

interface LeagueEntry {
  rank: number;
  userId: string;
  handle: string;
  xp: number;
  tier: LeagueTier;
  isMe: boolean;
  zone: Zone;
}

interface XpGap {
  toward: "PROMOTION" | "SAFETY" | "FIRST_PLACE";
  xp: number;
}

interface LeagueData {
  scope: "league" | "friends";
  myTier: LeagueTier;
  highestTier: LeagueTier;
  weekEndsAt: string;
  promoteCount: number;
  demoteCount: number;
  promotePercent: number;
  demotePercent: number;
  hasActivityThisWeek: boolean;
  xpGap: XpGap | null;
  entries: LeagueEntry[];
}

interface NationalEntry {
  rank: number;
  userId: string;
  handle: string;
  xpTotal: number;
  currentStreak: number;
  tier: LeagueTier | null;
  isMe: boolean;
}

interface NationalData {
  scope: "national";
  entries: NationalEntry[];
  me: NationalEntry | null;
}

const MEDAL_LABELS = ["profile.medalGold", "profile.medalSilver", "profile.medalBronze"] as const;

/** Plek 1-3 als medaille, daarna het cijfer. */
function RankCell({ rank, t, prefix = "" }: { rank: number; t: TFunction; prefix?: string }) {
  return (
    <span className="flex w-8 shrink-0 justify-center text-center font-extrabold text-vs-fg-2">
      {rank <= 3 ? <RankMedal rank={rank as 1 | 2 | 3} label={t(MEDAL_LABELS[rank - 1])} /> : `${prefix}${rank}`}
    </span>
  );
}

/**
 * Hoe lang de week nog loopt, zoals "Nog 3 dagen", "Nog 5 uur". Het
 * eindtijdstip komt van de server (maandag 00:00 UTC); de klok van het
 * toestel bepaalt alleen hoeveel tijd er nog over is om te tonen, nooit een
 * uitslag. Ververst elke minuut.
 */
function WeekCountdown({ endsAt, t }: { endsAt: string; t: TFunction }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const left = new Date(endsAt).getTime() - now;
  if (!(left > 0)) return null;
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.max(1, Math.ceil(left / 60_000));
  const text =
    days >= 1
      ? days === 1 ? t("leaderboard.timeLeftDay") : t("leaderboard.timeLeftDays", { n: days })
      : hours >= 1
        ? hours === 1 ? t("leaderboard.timeLeftHour") : t("leaderboard.timeLeftHours", { n: hours })
        : minutes === 1 ? t("leaderboard.timeLeftMinute") : t("leaderboard.timeLeftMinutes", { n: minutes });
  return (
    <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-extrabold" title={t("leaderboard.weekEnds")}>
      <Clock className="h-4 w-4" aria-hidden strokeWidth={2.5} />
      <span className="sr-only">{t("leaderboard.weekEnds")}: </span>
      {text}
    </p>
  );
}

/** Lijn in het klassement waar de promotie- of degradatiezone begint. */
function ZoneDivider({ zone, t }: { zone: "PROMOTION" | "RELEGATION"; t: TFunction }) {
  const up = zone === "PROMOTION";
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 text-xs font-extrabold uppercase tracking-wide ${
        up ? "text-vs-success" : "text-red-600 dark:text-red-400"
      }`}
    >
      <span className={`h-0.5 flex-1 rounded-full ${up ? "bg-vs-success" : "bg-red-500"}`} aria-hidden />
      <Icon className="h-4 w-4" aria-hidden strokeWidth={2.75} />
      {up ? t("leaderboard.zonePromotion") : t("leaderboard.zoneRelegation")}
      <Icon className="h-4 w-4" aria-hidden strokeWidth={2.75} />
      <span className={`h-0.5 flex-1 rounded-full ${up ? "bg-vs-success" : "bg-red-500"}`} aria-hidden />
    </div>
  );
}

/**
 * Uitleg van promotie/degradatie voor de huidige stand. De aantallen komen
 * van de server en hangen af van hoeveel spelers er deze week meedoen.
 */
function movementText(data: LeagueData, t: TFunction): string {
  if (data.entries.length === 0) {
    return t("leaderboard.movementEmpty", { percent: data.promotePercent, demote: data.demotePercent });
  }
  const up =
    data.promoteCount === 0
      ? t("leaderboard.upNone")
      : data.promoteCount === 1
        ? t("leaderboard.upOne")
        : t("leaderboard.upMany", { n: data.promoteCount });
  const down =
    data.demoteCount === 0
      ? t("leaderboard.downNone")
      : data.demoteCount === 1
        ? t("leaderboard.downOne")
        : t("leaderboard.downMany", { n: data.demoteCount });
  return t("leaderboard.movement", { up, down });
}

export default function LeaderboardClient() {
  const t = useT();
  const [scope, setScope] = useState<"league" | "friends" | "national">("league");
  // Blijft staan bij het wisselen van tabblad, zodat de divisiebalk niet
  // leeg wordt terwijl de nieuwe lijst laadt.
  const [tiers, setTiers] = useState<{ current: LeagueTier; highest: LeagueTier; weekEndsAt: string } | null>(null);

  // De stand verandert door afgeronde activiteiten (XP) van jou en anderen: ophalen bij openen,
  // bij terugkeer en na eigen XP; geen polling (de weekstand is geen seconde-nauwkeurig live-onderdeel).
  const query = useLiveQuery<LeagueData | NationalData>(
    ["competition", "leaderboard", scope],
    () => fetchJson<LeagueData | NationalData>(`/api/leaderboard?scope=${scope}`),
    { scopes: ["competition"], staleTime: 30_000 }
  );
  const data = query.data ?? null;
  if (data && data.scope !== "national") {
    const next = { current: data.myTier, highest: data.highestTier, weekEndsAt: data.weekEndsAt };
    if (!tiers || tiers.current !== next.current || tiers.highest !== next.highest || tiers.weekEndsAt !== next.weekEndsAt) setTiers(next);
  }

  const leagueData = data && data.scope !== "national" ? (data as LeagueData) : null;
  const nationalData = data && data.scope === "national" ? (data as NationalData) : null;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4 sm:gap-5">
      {scope === "league" ? (
        <div className="card bg-gradient-to-br from-brand-500 to-brand-700 dark:from-brand-600 dark:to-brand-900 text-white !border-0 !px-0 !py-4 min-h-48 sm:min-h-52 flex flex-col items-center justify-center gap-1 overflow-hidden">
          <h1 className="sr-only">
            {t("nav.competition")} — {tiers ? t(`tiers.${tiers.current}`) : t("leaderboard.divisionLower")}
          </h1>
          {tiers && <DivisionScroller current={tiers.current} highest={tiers.highest} />}
          {tiers && <WeekCountdown endsAt={tiers.weekEndsAt} t={t} />}
        </div>
      ) : (
        <header className="flex flex-col gap-0.5 px-1">
          <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">
            {scope === "friends" ? t("nav.friends") : t("leaderboard.national")}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
            {scope === "friends" ? t("leaderboard.friendsSub") : t("leaderboard.nationalSub")}
          </p>
        </header>
      )}

      <div className="mx-auto flex w-full max-w-md gap-1 border-b border-vs-line px-1">
        <button
          onClick={() => setScope("league")}
          className={`min-w-0 flex-1 rounded-t-lg border-b-2 px-1 py-1.5 text-xs font-bold transition sm:px-2 sm:text-sm ${
            scope === "league" ? "border-vs-accent text-vs-accent" : "border-transparent text-vs-fg-3 hover:bg-vs-subtle"
          }`}
        >
          {t("leaderboard.division")}
        </button>
        <button
          onClick={() => setScope("friends")}
          className={`min-w-0 flex-1 rounded-t-lg border-b-2 px-1 py-1.5 text-xs font-bold transition sm:px-2 sm:text-sm ${
            scope === "friends" ? "border-vs-accent text-vs-accent" : "border-transparent text-vs-fg-3 hover:bg-vs-subtle"
          }`}
        >
          {t("nav.friends")}
        </button>
        <button
          onClick={() => setScope("national")}
          className={`min-w-0 flex-1 rounded-t-lg border-b-2 px-1 py-1.5 text-xs font-bold transition sm:px-2 sm:text-sm ${
            scope === "national" ? "border-vs-accent text-vs-accent" : "border-transparent text-vs-fg-3 hover:bg-vs-subtle"
          }`}
        >
          {t("leaderboard.national")}
        </button>
      </div>

      {scope === "league" && leagueData && (
        <p className="text-sm text-slate-400 dark:text-slate-500 text-center">{movementText(leagueData, t)}</p>
      )}

      {scope === "league" && leagueData?.xpGap && (
        <div className="card !py-2.5 !bg-gold-50 dark:!bg-slate-700 !border-gold-400/30 dark:!border-slate-600 text-center">
          <p className="font-extrabold text-gold-700 dark:text-gold-400">
            {leagueData.xpGap.toward === "SAFETY" && t("leaderboard.gapSafety", { xp: leagueData.xpGap.xp })}
            {leagueData.xpGap.toward === "PROMOTION" && t("leaderboard.gapPromotion", { xp: leagueData.xpGap.xp })}
            {leagueData.xpGap.toward === "FIRST_PLACE" && t("leaderboard.gapFirst", { xp: leagueData.xpGap.xp })}
          </p>
        </div>
      )}

      {!data && <p className="text-slate-400">{t("common.loading")}</p>}

      {leagueData && leagueData.entries.length === 0 && (
        <p className="text-slate-400">{t("leaderboard.noXp")}</p>
      )}

      {leagueData && leagueData.entries.length > 0 && (
        <div className="card flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
          {leagueData.entries.map((e, i) => {
            const prev = leagueData.entries[i - 1];
            // Zoals bij een klassement met zones: een lijn ónder de laatste
            // promotieplek en bóven de eerste degradatieplek.
            const relegationStarts = e.zone === "RELEGATION" && prev?.zone !== "RELEGATION";
            const promotionEnds = e.zone === "PROMOTION" && leagueData.entries[i + 1]?.zone !== "PROMOTION" && i < leagueData.entries.length - 1;
            return (
              <Fragment key={e.userId}>
                {relegationStarts && <ZoneDivider zone="RELEGATION" t={t} />}
                <div
                  className={`flex items-center gap-2.5 px-2 py-2.5 rounded-xl min-w-0 ${
                    e.isMe ? "bg-brand-50 dark:bg-slate-700 font-extrabold" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <RankCell rank={e.rank} t={t} />
                    <UserAvatar id={e.userId} handle={e.handle} />
                    <span className="min-w-0 truncate dark:text-slate-100" title={e.handle}>
                      {e.handle} {e.isMe && <span className="text-brand-500 dark:text-brand-300">{t("lobby.you")}</span>}
                    </span>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-gold-600 dark:text-gold-400 font-extrabold">
                    {e.xp} XP
                  </span>
                </div>
                {promotionEnds && <ZoneDivider zone="PROMOTION" t={t} />}
              </Fragment>
            );
          })}
        </div>
      )}

      {nationalData && (
        <div className="flex flex-col gap-3">
          <div className="card flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
            {nationalData.entries.map((e) => (
              <NationalRow key={e.userId} e={e} />
            ))}
          </div>
          {nationalData.me && (
            <div className="card !py-3 !bg-gold-50 dark:!bg-slate-700 !border-gold-400/30 dark:!border-slate-600">
              <NationalRow e={nationalData.me} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NationalRow({ e }: { e: NationalEntry }) {
  const t = useT();
  return (
    <div className={`flex items-center gap-2.5 px-2 py-2.5 rounded-xl min-w-0 ${
      e.isMe ? "font-extrabold" : ""
    }`}>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <RankCell rank={e.rank} t={t} prefix="#" />
        <UserAvatar id={e.userId} handle={e.handle} />
        <span className="min-w-0 truncate dark:text-slate-100" title={e.handle}>
          {e.handle} {e.isMe && <span className="text-brand-500 dark:text-brand-300">{t("lobby.you")}</span>}
        </span>
        {e.tier && (
          <span className="shrink-0" title={t(`tiers.${e.tier}`)}>
            <DivisionEmblem tier={e.tier} label={t(`tiers.${e.tier}`)} className="h-7 w-7" />
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap sm:gap-2 sm:text-sm">
        <span className="inline-flex items-center gap-0.5 text-orange-500 font-bold"><SystemIcon kind="streak" className="h-4 w-4" fill="currentColor" aria-hidden />{e.currentStreak}</span>
        <span className="inline-flex items-center gap-0.5 text-gold-600 dark:text-gold-400 font-extrabold"><SystemIcon kind="xp" className="h-4 w-4" fill="currentColor" aria-hidden />{e.xpTotal}</span>
      </div>
    </div>
  );
}
