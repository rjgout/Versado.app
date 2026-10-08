"use client";

import { useEffect } from "react";
import Link from "next/link";
import SystemIcon from "@/components/versado/SystemIcon";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { getLanguage } from "@/lib/languages";
import DivisionEmblem from "@/components/versado/DivisionEmblem";
import type { LeagueTier } from "@/generated/prisma/client";
import type { MessageKey } from "@/lib/i18n/core";
import { useStreakContinuation } from "@/components/StreakContinuation";

// Beloningsstatus in de header: reeks, XP en divisie. Bewust prominent (dit
// zijn de belangrijkste motivatoren) en elk een directe ingang naar de
// eigen pagina. Kleuren komen uit de Versado-tokens (streak, xp, league),
// zodat ze in licht en donker dezelfde nadruk houden.
interface BadgeValues {
  streak: number;
  xp: number;
  studiedToday: boolean;
}

export default function NavUserBadges({
  streak,
  xp,
  studiedToday,
  tier,
}: {
  streak: number;
  xp: number;
  studiedToday: boolean;
  tier: LeagueTier | null;
}) {
  // De props zijn de server-gerenderde waarde bij laden van de pagina. Daarna houdt de
  // live-data-laag ze actueel: bij een XP-wijziging (announceXpChanged), een signaal
  // van de server (ook van een ander apparaat) en bij focus/terugkeer, en gedeeld met
  // alles op de pagina dat dezelfde gegevens nodig heeft.
  const t = useT();
  const continuation = useStreakContinuation();
  const locale = getLanguage(useUiLanguage()).intlLocale;
  const badges = useLiveQuery<BadgeValues>(
    ["userBadges"],
    async () => {
      const data = await fetchJson<{ currentStreak: number; xpTotal: number; studiedToday: boolean }>("/api/user-badges");
      return { streak: data.currentStreak, xp: data.xpTotal, studiedToday: data.studiedToday };
    },
    { scopes: ["xp", "streak"], initialData: { streak, xp, studiedToday }, staleTime: 60_000 }
  );
  // Een verse server-render (router.refresh, navigatie) is net zo actueel als een ophaalactie.
  const { setData } = badges;
  useEffect(() => {
    setData({ streak, xp, studiedToday });
  }, [streak, xp, studiedToday, setData]);
  const base = badges.data ?? { streak, xp, studiedToday };
  const values = continuation ? { ...base, streak: continuation.currentStreak, studiedToday: continuation.studiedToday } : base;

  const number = (n: number) => new Intl.NumberFormat(locale, n >= 10000 ? { notation: "compact", maximumFractionDigits: 1 } : {}).format(n);
  const chip = "vs-motion flex h-10 items-center gap-1.5 rounded-full px-2.5 text-sm font-extrabold tabular-nums transition-colors";

  return (
    <div className="flex flex-wrap items-center justify-end gap-0.5 sm:gap-1">
      <Link
        href="/streak"
        title={t("header.streak")}
        aria-label={t("header.streakAria", { n: values.streak })}
        className={`${chip} ${values.studiedToday ? "text-vs-streak hover:bg-vs-streak-soft" : "text-vs-fg-3 hover:bg-vs-subtle"}`}
      >
        <SystemIcon kind="streak" className="h-[18px] w-[18px]" fill={values.studiedToday ? "currentColor" : "none"} aria-hidden />
        {number(values.streak)}
      </Link>
      <Link href="/xp" title={t("header.xp")} aria-label={t("header.xpAria", { n: values.xp })} className={`${chip} text-vs-xp hover:bg-vs-xp-soft`}>
        <SystemIcon kind="xp" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden />
        {number(values.xp)}
      </Link>
      {tier && (
        <Link
          href="/competition"
          title={t(`tiers.${tier}` as MessageKey)}
          aria-label={t("header.divisionAria", { name: t(`tiers.${tier}` as MessageKey) })}
          // Op de kleinste schermen alleen het embleem: de naam past er niet naast.
          className={`${chip} hidden min-[380px]:flex text-vs-league hover:bg-vs-league-soft`}
        >
          <DivisionEmblem tier={tier} className="h-6 w-6" />
          <span className="hidden sm:inline">{t(`tiers.${tier}` as MessageKey)}</span>
        </Link>
      )}
    </div>
  );
}
