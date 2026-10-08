"use client";

import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { jsonMutation } from "@/lib/data/mutation";
import { primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";

/**
 * Eenmalige, rustige vraag voor wie uitnodigingen nog uit heeft (bestaande
 * accounts): mag Versado soms uitleg aanbieden? Staat alleen op de eerste keer
 * dat Ontdek Versado geopend wordt; het antwoord is altijd later te wijzigen in het profiel.
 */
export default function OffersOptIn() {
  const t = useT();
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  async function yes() {
    setAnswer("yes");
    try {
      await jsonMutation("/api/account", { method: "PATCH", json: { kompasOffersEnabled: true } }, { invalidates: "settingsChanged" });
    } catch {
      setAnswer(null);
    }
  }
  if (answer === "no") return null;
  return (
    <section aria-labelledby="kompas-offers" className={`${surfaceCard} flex flex-col gap-3 p-4 sm:p-5`}>
      <h2 id="kompas-offers" className="text-base font-extrabold text-vs-fg">{t("kompas.hub.offersTitle")}</h2>
      {answer === "yes" ? (
        <p role="status" className="text-base text-vs-fg-2">{t("kompas.hub.offersOn")}</p>
      ) : (
        <>
          <p className="text-base text-vs-fg-2">{t("kompas.hub.offersText")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${primaryButton} !h-11 !px-5`} onClick={yes}>{t("kompas.hub.offersYes")}</button>
            <button type="button" className={`${secondaryButton} !h-11 !px-5`} onClick={() => setAnswer("no")}>{t("kompas.hub.offersNo")}</button>
          </div>
        </>
      )}
    </section>
  );
}
