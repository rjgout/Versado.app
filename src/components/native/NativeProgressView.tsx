"use client";
import { useMemo } from "react";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { useT } from "@/components/I18nProvider";
import LeaderboardClient from "@/components/LeaderboardClient";
import StreakClient from "@/components/StreakClient";
import XpHistoryClient from "@/components/XpHistoryClient";
import { ContentScopeContext } from "@/lib/data/queryHooks";
import type { NativeContentState } from "@/lib/native/contract";

export type NativeProgressRoute = "/streak" | "/xp" | "/competition";
export function nativeProgressRoute(pathname: string): NativeProgressRoute | null {
  return pathname === "/streak" || pathname === "/xp" || pathname === "/competition" ? pathname : null;
}
/** Reeks, XP-geschiedenis en competitie zijn de bestaande gedeelde clients; deze schil levert
 * alleen de native context. Gegevens lopen via dezelfde toegestane brug (`applicationFetch`),
 * dus XP-, reeks- en competitieregels blijven uitsluitend server-side. */
export default function NativeProgressView({ userId, route, content, language, enabled }: { userId: string; route: NativeProgressRoute; content?: NativeContentState; language: string; enabled: boolean }) {
  const t = useT();
  const collectionId = content?.picker.activeCollectionId ?? "", sourceLanguage = content?.picker.selection.contentLanguage ?? language;
  const scope = useMemo(() => ({ collectionId, language: sourceLanguage }), [collectionId, sourceLanguage]);
  if (!enabled) return <p role="status">{t("nativeToday.unavailable")}</p>;
  return <ContentScopeContext.Provider value={scope}><ConfirmProvider nativeDialogs>
    {route === "/streak" ? <StreakClient key={userId} /> : route === "/xp" ? <XpHistoryClient key={userId} showGuide={false} /> : <LeaderboardClient key={userId} />}
  </ConfirmProvider></ContentScopeContext.Provider>;
}
