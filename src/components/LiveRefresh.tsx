"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { liveData } from "@/lib/data/client";
import type { PageHandle } from "@/lib/data/store";
import type { DataScope } from "@/lib/data/scopes";

/**
 * Houdt een server-gerenderde pagina actueel (bv. Vandaag): ververst via
 * router.refresh() bij een gerelateerde mutation of realtime-signaal, bij
 * focus/terugkeer als hij verouderd is, en bij terugnavigeren uit de
 * routercache als er sindsdien iets veranderd is.
 *
 * `token` moet bij elke server-render anders zijn (bv. String(Date.now())):
 * zo herkent de laag een pagina die uit de cache terugkomt. Een client-page
 * die zelf ophaalt gebruikt useLiveQuery in plaats van dit onderdeel.
 */
export default function LiveRefresh({
  scopes,
  token,
  staleTime,
  expiresAt,
  serverNow,
}: {
  scopes: readonly DataScope[];
  token: string;
  staleTime?: number;
  /**
   * Tijdstip (ISO, servertijd) waarop deze render niet meer klopt, bv. het volgende woord van de
   * dag. De client rekent met de verstreken tijd sinds `serverNow`, niet met de absolute
   * toestelklok, zodat een verzette klok niets vervroegt.
   */
  expiresAt?: string | null;
  serverNow?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const handle = useRef<PageHandle | null>(null);
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  useEffect(() => {
    handle.current = liveData.observePage(pathname, { scopes, staleTime, refresh: () => routerRef.current.refresh() });
    return () => {
      handle.current?.release();
      handle.current = null;
    };
    // scopes en staleTime zijn constant per pagina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Verse render ontvangen, of de pagina komt uit de routercache terug.
  useEffect(() => {
    handle.current?.markFresh();
    handle.current?.setExpiry(expiresAt && serverNow !== undefined ? Date.now() + (Date.parse(expiresAt) - serverNow) : null);
    if (liveData.noteServerRender(pathname, token, scopes, staleTime)) liveData.refreshPageNow(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, token]);

  return null;
}
