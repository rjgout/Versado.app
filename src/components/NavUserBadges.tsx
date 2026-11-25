"use client";

import { useEffect } from "react";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import UserBadgesView from "@/components/shell/UserBadgesView";
import type { LeagueTier } from "@/generated/prisma/client";
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
  const continuation = useStreakContinuation();
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

  return <UserBadgesView {...values} tier={tier} />;
}
