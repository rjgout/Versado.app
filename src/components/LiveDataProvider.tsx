"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { liveData, startLiveDataListeners } from "@/lib/data/client";
import { ContentScopeContext, type ContentScope } from "@/lib/data/hooks";

// Eén keer in de layout: start de globale luisteraars (focus, zichtbaarheid,
// netwerk, app hervat, Socket.io) en geeft de gekozen content en taal door
// aan useLiveQuery({ contentScoped }). Zie docs/DATA-REFRESH.md.
export default function LiveDataProvider({
  userId,
  collectionId,
  language,
  children,
}: {
  userId?: string;
  collectionId?: string;
  language?: string;
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

  const scope = useMemo<ContentScope | null>(
    () => (collectionId && language ? { collectionId, language } : null),
    [collectionId, language]
  );
  return <ContentScopeContext.Provider value={scope}>{children}</ContentScopeContext.Provider>;
}
