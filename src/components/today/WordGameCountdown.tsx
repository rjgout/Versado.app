"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { splitMinutes } from "@/lib/generalConference";

// Aftelling op de Woord-van-de-dag-tegel zodra het woord geraden of niet meer
// te raden is: wanneer het volgende woord vrijkomt (nextReleaseAt, het
// absolute moment dat de server uit de eigen tijdzone berekent).
// Net als de conferentie-countdown: het verschil met de toestelklok wordt één
// keer bepaald (serverNow), zodat een verkeerd ingestelde klok niets
// verschuift, en bijwerken gebeurt precies op de minuutgrens. Het verversen
// van de tegel zelf om 18:00 doet LiveRefresh.
export default function WordGameCountdown({ serverNow, nextReleaseAt }: { serverNow: number; nextReleaseAt: string }) {
  const t = useT();
  const [offset] = useState(() => serverNow - Date.now());
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      clearTimeout(timer);
      const current = Date.now() + offset;
      setNow(current);
      timer = setTimeout(tick, 60_000 - (current % 60_000) + 50);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [offset]);

  const total = Math.max(1, Math.ceil((Date.parse(nextReleaseAt) - now) / 60_000));
  const { hours, minutes } = splitMinutes(total);
  const duration = hours === 0
    ? t("today.conference.durationM", { m: minutes })
    : minutes === 0
      ? t("today.conference.durationH", { h: hours })
      : t("today.conference.durationHM", { h: hours, m: minutes });
  return <span>{t("today.wordGame.nextIn", { duration })}</span>;
}
