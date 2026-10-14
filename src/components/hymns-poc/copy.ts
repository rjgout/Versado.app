// Teksten van Lofzangen. Bewust nog geen i18n: de pagina is alleen voor beheerders (zie
// docs/hymns/02-ARCHITECTURE.md). Bij openstelling voor gewone gebruikers gaan alle teksten via
// src/lib/i18n/messages (nl als bron, alle uiReady-talen) en komt de pagina in het register van Kompas.

import type { SyncStatus } from "@/lib/hymns/follow/session";
import type { MicState } from "@/lib/hymns/audio/micListener";
import type { RecognitionStatus } from "@/lib/hymns/recognize/recognizer";

export const COPY = {
  title: "Lofzangen",
  intro:
    "Alleen voor beheerders, in ontwikkeling: de herkenning is nog niet getest met echte uitvoeringen in een kerk. De telefoon luistert naar het orgel of de piano, zet de tekst klaar en loopt mee zodra er wordt gezongen.",
  privacy:
    "Het geluid wordt alleen op dit toestel geanalyseerd. Er wordt niets verzonden of opgeslagen. De microfoon stopt zodra je op Stop tikt, deze pagina verlaat of de app naar de achtergrond gaat.",
  start: "Start luisteren",
  close: "Sluiten",
  choose: "Kies een lofzang",
  chooseShort: "Alleen voor beheerders, in ontwikkeling.",
  otherHymn: "Andere lofzang",
  listening: "Luistert…",
  infoTitle: "Privacy en microfoon",
  info: "Privacy",
  privacyShort: "Het geluid blijft op dit toestel.",
  stanzaMore: "Meer opties voor coupletten",
  orderTitle: "Coupletvolgorde",
  orderHelp: "Tik de coupletten in de volgorde waarin ze worden gezongen. Zonder keuze volgen alle coupletten.",
  lyricsRegion: "Lofzangtekst",
  technicalOpen: "Technische gegevens openen",
  viewToggleToKaraoke: "Wissel naar karaoke per regel",
  viewToggleToStanza: "Wissel naar volledig couplet",
  stop: "Stop",
  micOff: "Microfoon is uit",
  micOn: "Microfoon is actief",
  micRequesting: "Toestemming vragen…",
  hymnLabel: "Lofzang",
  recognize: "Herken lofzang",
  recognizing: "Lofzang herkennen…",
  chooseHint: "Kies hieronder een lofzang, of laat de telefoon luisteren en de lofzang herkennen.",
  candidatesTitle: "Mogelijke lofzangen",
  candidatesHelp: "Tik op de lofzang die wordt gespeeld.",
  singingStarts: "Zang begint",
  singingStartsHelp: "Tik als de gemeente begint te zingen.",
  resync: "Opnieuw synchroniseren",
  resumeFollow: "Volgen hervatten",
  stanzaLabel: "Couplet",
  orderToggle: "Volgorde kiezen",
  orderDone: "Klaar",
  orderAll: "Alle coupletten",
  orderPrefix: "Volgorde",
  chorus: "Refrein",
  lineFallbackNote: "Voor dit couplet is alleen de regel te volgen, geen woord.",
  settings: "Instellingen",
  settingsClose: "Instellingen sluiten",
  viewTitle: "Tekstweergave",
  viewStanza: "Volledig couplet",
  viewKaraoke: "Karaoke per regel",
  sizeTitle: "Tekstgrootte",
  sizeNormal: "Normaal",
  sizeLarge: "Groot",
  sizeXLarge: "Extra groot",
  displayTitle: "Weergave",
  autoScroll: "Automatisch meescrollen",
  calm: "Rustige kerkweergave",
  technical: "Technische gegevens",
  testTitle: "Testbestand (blijft op dit toestel)",
  testHelp: "Kies een audiobestand met orgel- of pianospel; het wordt lokaal door dezelfde engine verwerkt.",
  testRunning: "Bestand wordt verwerkt…",
  testAs: "Verwerken als",
  testAsRecognize: "Herkennen",
  testAsFollow: "Volgen (gekozen lofzang)",
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
  unknown: "Geen van de beschikbare lofzangen herkend",
};
