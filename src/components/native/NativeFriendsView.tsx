"use client";
import { useMemo } from "react";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import { useT } from "@/components/I18nProvider";
import FriendsClient from "@/components/FriendsClient";
import FriendProfileClient from "@/components/FriendProfileClient";
import { ContentScopeContext } from "@/lib/data/queryHooks";
import type { NativeContentState } from "@/lib/native/contract";
import { resolveAppName } from "@/lib/brand";

/** Vrienden is de bestaande gedeelde interface; deze schil levert alleen de native
 * context. Alle gegevens lopen via dezelfde toegestane spelbrug (`applicationFetch`)
 * en de bestaande servicehandlers, dus privacy en rechten blijven server-side. */
export default function NativeFriendsView({ userId, pathname, content, language, enabled }: { userId: string; pathname: string; content?: NativeContentState; language: string; enabled: boolean }) {
  const t = useT();
  const collectionId = content?.picker.activeCollectionId ?? "", sourceLanguage = content?.picker.selection.contentLanguage ?? language;
  const scope = useMemo(() => ({ collectionId, language: sourceLanguage }), [collectionId, sourceLanguage]);
  const profileId = /^\/friends\/([A-Za-z0-9_-]{1,128})$/.exec(pathname)?.[1] ?? null;
  if (!enabled) return <p role="status">{t("nativeToday.unavailable")}</p>;
  return <ContentScopeContext.Provider value={scope}><ConfirmProvider nativeDialogs>
    {profileId ? <FriendProfileClient key={`${userId}:${profileId}`} userId={profileId} viewerId={userId} /> : <FriendsClient key={userId} appName={resolveAppName(null)} />}
  </ConfirmProvider></ContentScopeContext.Provider>;
}
