// Teksten van de Lofzangen-proef. Bewust nog geen i18n: de proefpagina is niet publiek (zie
// docs/hymns/02-ARCHITECTURE.md). Bij een productie-implementatie gaan alle teksten via
// src/lib/i18n/messages (nl als bron, alle uiReady-talen) en komt de pagina in het register van Kompas.

import type { SyncStatus } from "@/lib/hymns/follow/session";
import type { MicState } from "@/lib/hymns/audio/micListener";
import type { RecognitionStatus } from "@/lib/hymns/recognize/recognizer";

export const COPY = {
  title: "Lofzangen, technische proef",
  intro:
    "Proefversie voor ontwikkelaars. De telefoon luistert naar het orgel of de piano en volgt de muziek om de juiste tekstregel te tonen.",
  privacy:
    "Het geluid wordt alleen op dit toestel geanalyseerd. Er wordt niets verzonden of opgeslagen. De microfoon stopt zodra je op Stop tikt, deze pagina verlaat of de app naar de achtergrond gaat.",
  start: "Start luisteren",
  stop: "Stop",
  micOff: "Microfoon is uit",
  micOn: "Microfoon is actief",
  micRequesting: "Toestemming vragen…",
  hymnLabel: "Lofzang",
  recognize: "Herken lofzang",
  recognizeHelp: "Laat de telefoon luisteren en raden welke van de drie proeflofzangen wordt gespeeld.",
  followThis: "Volg deze lofzang",
  stanzaLabel: "Couplet",
  orderToggle: "Volgorde kiezen",
  orderDone: "Klaar",
  orderAll: "Alle coupletten",
  orderPrefix: "Volgorde",
  chorus: "Refrein",
  lineFallbackNote: "Voor dit couplet is alleen de regel te volgen, geen woord.",
  testTitle: "Testbestand (blijft op dit toestel)",
  testHelp: "Kies een audiobestand met orgel- of pianospel; het wordt lokaal door dezelfde engine verwerkt.",
  testRunning: "Bestand wordt verwerkt…",
} as const;

export const SYNC_TEXT: Record<SyncStatus, string> = {
  idle: "Nog niet gestart",
  acquiring: "Muziek zoeken…",
  locked: "Gesynchroniseerd",
  uncertain: "Even onzeker, lees gewoon mee",
  lost: "Synchronisatie verloren, lees zelf verder",
  recovered: "Synchronisatie hersteld",
};

export const MIC_TEXT: Record<MicState, string> = {
  idle: COPY.micOff,
  requesting: COPY.micRequesting,
  listening: COPY.micOn,
  denied: "Geen toestemming voor de microfoon. Geef toestemming in de browserinstellingen.",
  unsupported: "Deze browser ondersteunt lokale audioverwerking niet.",
  error: "De microfoon kon niet worden gestart.",
};

export const RECOGNITION_TEXT: Record<RecognitionStatus, string> = {
  listening: "Luisteren…",
  candidates: "Mogelijke lofzangen",
  identified: "Dit lijkt de lofzang",
  ambiguous: "Meerdere lofzangen passen even goed",
  unknown: "Geen van de proeflofzangen herkend",
};
