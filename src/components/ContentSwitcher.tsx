"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { rememberContentDeparture } from "@/lib/navigationHistory";
import { useContentView } from "@/lib/data/hooks";
import type { ContentCollectionView } from "@/lib/contentCollections";
import ContentSwitcherView from "./content/ContentSwitcherView";

/** Webadapter: dezelfde presentatie, bestaande contentcache en vertrekgeschiedenis. */
export default function ContentSwitcher({ enabled, active: initialActive, showLanguage, sessionKey }: { enabled: boolean; active: ContentCollectionView; showLanguage: boolean; sessionKey: string }) {
  const context = useContentView(), pathname = usePathname(), search = useSearchParams();
  return <ContentSwitcherView enabled={enabled} active={context?.active ?? initialActive} showLanguage={showLanguage}
    onNavigate={() => rememberContentDeparture(sessionKey, { pathname, search: search.toString() })} />;
}
