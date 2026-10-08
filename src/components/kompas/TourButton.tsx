"use client";

import { useT } from "@/components/I18nProvider";
import { useKompas } from "@/components/kompas/KompasProvider";
import { KompasIcon } from "@/components/kompas/KompasIcon";
import { primaryButton, secondaryButton } from "@/components/versado/styles";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import type { KompasRow } from "@/lib/kompas/state";

/**
 * Start een rondleiding. Altijd een bewuste keuze; ook na afronden opnieuw te
 * starten. `done` is de status bij het laden van de pagina; daarna volgt de knop
 * de live status, zodat hij meteen "opnieuw bekijken" zegt als je klaar bent.
 */
export default function TourButton({ tourId, topicId, done = false, variant = "secondary" }: { tourId: string; topicId: string; done?: boolean; variant?: "primary" | "secondary" }) {
  const t = useT();
  const { startTour } = useKompas();
  const state = useLiveQuery<{ rows: KompasRow[] }>(["kompas", "state"], () => fetchJson<{ rows: KompasRow[] }>("/api/kompas/state"), { scopes: ["kompas"], staleTime: 60_000 });
  const finished = state.data ? state.data.rows.some((row) => row.topicId === topicId && row.kind === "TOUR" && row.status === "COMPLETED") : done;
  return (
    <button type="button" onClick={() => startTour(tourId)} className={`${variant === "primary" ? primaryButton : secondaryButton} !h-11 !px-5`}>
      <KompasIcon className="h-4 w-4" />
      {finished ? t("kompas.topic.tourAgain") : t("kompas.topic.tourStart")}
    </button>
  );
}
