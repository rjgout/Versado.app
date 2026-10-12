"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { liveData, startLiveDataListeners } from "@/lib/data/client";
import type { ContentContext } from "@/lib/contentCollections";
import { fetchJson } from "@/lib/data/fetchJson";
import { ContentScopeContext, ContentViewContext, useLiveQuery, type ContentScope } from "@/lib/data/hooks";

// Eén keer in de layout: start de globale luisteraars (focus, zichtbaarheid,
// netwerk, app hervat, Socket.io) en geeft de gekozen content en taal door
// aan useLiveQuery({ contentScoped }). Zie docs/DATA-REFRESH.md.
export default function LiveDataProvider({
  userId,
  collectionId,
  language,
  initialContentContext,
  sessionKey,
  children,
}: {
  userId?: string;
  collectionId?: string;
  language?: string;
  initialContentContext?: ContentContext;
  sessionKey?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!userId) return;
    const stop = startLiveDataListeners();
    return () => {
      stop();
      // Een volgende gebruiker op dit apparaat mag nooit gegevens van de vorige zien.
      liveData.reset();
    };
  }, [userId]);

  const query = useLiveQuery<ContentContext>(["content", "context", sessionKey ?? userId ?? "anonymous"],
    () => fetchJson("/api/content-context"), {
      scopes: ["content"], initialData: initialContentContext, enabled: Boolean(userId), staleTime: 30_000,
    });
  const context = query.data ?? initialContentContext;
  const currentCollection = context?.active.id ?? collectionId;
  const currentLanguage = context?.active.language ?? language;
  const scope = useMemo<ContentScope | null>(
    () => (currentCollection && currentLanguage ? { collectionId: currentCollection, language: currentLanguage } : null),
    [currentCollection, currentLanguage]
  );
  return <ContentViewContext.Provider value={context ?? null}><ContentScopeContext.Provider value={scope}>{children}</ContentScopeContext.Provider></ContentViewContext.Provider>;
}
