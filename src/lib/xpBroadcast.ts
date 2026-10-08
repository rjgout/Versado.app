"use client";

// De XP/streak-badge in de header (zie NavUserBadges.tsx) is een client
// component die zijn beginwaarde server-gerenderd meekrijgt, maar daarna
// niet vanzelf meekrijgt dat een andere actie op dezelfde pagina (of een
// child-component) XP heeft toegekend of afgeschreven — Next ververst een
// layout niet vanzelf bij client-side navigatie. Elke plek die XP toekent
// of afschrijft (les/oefening/hoofdstukraadspel/woordspel/podcast/
// kinderverhaal afgerond, hints/freezes gekocht) roept na een geslaagde
// aanroep announceXpChanged() aan; de badge luistert daarop en haalt de
// verse waarde zelf op (zie /api/user-badges).
//
// Dit is ook het centrale mutatiemoment voor de live-data-laag (src/lib/data):
// een afgeronde activiteit of aankoop maakt zo Vandaag, voortgang, XP, reeks,
// profiel en competitie ongeldig (DATA_EVENTS.xpChanged), zonder dat elke
// aanroeper dat zelf hoeft te weten.
import { invalidateData } from "@/lib/data/client";
import { getSocket } from "@/lib/socketClient";

const EVENT_NAME = "xp-changed";

export function announceXpChanged(): void {
  window.dispatchEvent(new Event(EVENT_NAME));
  invalidateData("xpChanged");
  // XP, divisies en nieuw behaalde prestaties kunnen deel uitmaken van een
  // expliciet gedeeld vriendenprofiel. De server bepaalt opnieuw wie vriend
  // is; dit signaal bevat zelf geen profiel- of beloningsgegevens.
  getSocket().emit("friend_profile_changed");
}

export function onXpChanged(callback: () => void): () => void {
  window.addEventListener(EVENT_NAME, callback);
  return () => window.removeEventListener(EVENT_NAME, callback);
}
