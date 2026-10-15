import type { DisplayCursor } from "@/lib/hymns/follow/display";
import type { FollowSnapshot } from "@/lib/hymns/follow/session";
import type { LiveState } from "@/lib/hymns/live";
import type { HymnLine, HymnStanza, HymnText } from "@/lib/hymns/types";
import type { MicState } from "@/lib/hymns/audio/micListener";

// Pure afleidingen voor de Lofzangen-weergave (getest in tests/hymns-ui.test.ts): welke statustekst staat er,
// welke regel actief is, en wanneer moet er gescrold worden. Geen React, geen DOM.

export type StatusTone = "neutral" | "ok" | "warn" | "danger" | "info";

export interface StatusView {
  label: string;
  tone: StatusTone;
  /** Korte uitleg onder de status (bijvoorbeeld: wachten op zangbegin). */
  hint: string | null;
}

export function describeStatus(mic: MicState, live: LiveState): StatusView | null {
  if (mic !== "listening" && live.stage !== "following") return null;
  // Tijdens het herkennen toont het herkenningsscherm zelf één rustige status; een tweede statusregel zou alleen herhalen.
  if (live.stage === "recognizing") return null;
  if (live.stage !== "following") return null;
  const s = live.snapshot;
  if (!s || s.status === "idle" || s.status === "acquiring") return { label: "Luisteren…", tone: "neutral", hint: null };
  if (s.phase.phase === "interlude") return { label: "Tussenspel", tone: "info", hint: null };
  if (s.phase.phase === "prelude") {
    // Alleen als de engine echt niet weet wanneer de zang begint is een uitleg nodig; anders blijft het scherm rustig.
    return { label: "Voorspel", tone: "info", hint: s.phase.waiting ? "Tik op Zang begint zodra de gemeente zingt." : null };
  }
  // Tijdelijk syncverlies: de woorden lopen rustig door op het laatst betrouwbare tempo (geschat); geen alarmerende melding.
  if (s.positionSource === "catching-up") return { label: "Tekst sluit aan", tone: "neutral", hint: null };
  if (s.positionSource === "estimated" && s.cursor.estimated) return { label: "Tekst loopt door", tone: "neutral", hint: null };
  if (s.status === "uncertain") return { label: "Even onzeker", tone: "warn", hint: "Lees gewoon mee." };
  if (s.status === "lost") return { label: "Synchronisatie verloren", tone: "danger", hint: "Lees zelf verder." };
  return { label: s.phase.startReason === "manual" ? "Handmatig volgen" : "Volgt muziek", tone: "ok", hint: s.lapUncertain ? "Controleer het couplet." : null };
}

export interface LyricLine {
  line: HymnLine;
  section: "verse" | "chorus";
  index: number;
  /** Positie in de doorlopende reeks (couplet, daarna refrein). */
  seq: number;
}

/** De regels van het getoonde couplet gevolgd door het refrein, als één doorlopende reeks. */
export function lyricSequence(text: HymnText, stanza: HymnStanza | undefined): LyricLine[] {
  const out: LyricLine[] = [];
  (stanza?.lines ?? []).forEach((line, index) => out.push({ line, section: "verse", index, seq: out.length }));
  (text.chorus?.lines ?? []).forEach((line, index) => out.push({ line, section: "chorus", index, seq: out.length }));
  return out;
}

/** Index in de reeks van de actieve regel, of -1 als er (nog) niets actief is. */
export function activeSeq(seq: LyricLine[], cursor: DisplayCursor | undefined): number {
  if (!cursor || cursor.line < 0) return -1;
  return seq.findIndex((l) => l.section === cursor.section && l.index === cursor.line);
}

/** Het woord dat de markering krijgt: alleen als de woordkoppeling van dit couplet betrouwbaar is. */
export function activeWordFor(
  entry: LyricLine,
  cursor: DisplayCursor | undefined,
  stanza: HymnStanza | undefined,
  text: HymnText,
): number | null {
  if (!cursor || cursor.line < 0 || cursor.section !== entry.section || cursor.line !== entry.index) return null;
  const linking = entry.section === "verse" ? stanza?.linking : text.chorus?.linking;
  return linking === "word" ? cursor.word : null;
}

export interface ScrollGeometry {
  /** Bovenkant (px) van de actieve regel en onderkant, in vensterpositie. */
  lineTop: number;
  lineBottom: number;
  /** Zichtbaar gebied voor tekst: onder de terugbalk en boven de onderste bediening. */
  viewTop: number;
  viewBottom: number;
  /** Past het hele couplet in dat gebied? Dan wordt er niet gescrold. */
  contentHeight: number;
}

/** De actieve regel hoort in het bovenste deel van het scherm te staan: daaronder staat wat eraan komt. */
export const READ_AHEAD_BAND = 0.52;
export const READ_AHEAD_TARGET = 0.3;

/**
 * Hoeveel pixels moet het venster scrollen om de actieve regel in het bovenste deel van het scherm te houden, zodat de gebruiker
 * ruim vooruit kan lezen? 0 als het hele couplet past of de regel al in de bovenste helft staat (dan geen onrustige beweging). Raakt de
 * regel de onderste helft of verdwijnt hij boven, dan komt hij op ongeveer 30% van het gebied te staan.
 */
export function scrollDelta(g: ScrollGeometry, margin = 24): number {
  const available = g.viewBottom - g.viewTop;
  if (available <= 0 || g.contentHeight <= available - margin) return 0;
  if (g.lineTop >= g.viewTop + margin * 0.5 && g.lineBottom <= g.viewTop + available * READ_AHEAD_BAND) return 0;
  const target = g.viewTop + available * READ_AHEAD_TARGET;
  return Math.round(g.lineTop - target);
}

/**
 * Het couplet dat hierna komt volgens de gekozen volgorde, gerekend vanaf het getoonde couplet (dezelfde regel als StanzaPlan.onNewLap).
 * null aan het einde van de volgorde. Dit is alleen een voorbeeld om vooruit te lezen: het getoonde couplet wisselt nooit hierdoor.
 */
export function nextStanzaInPlan(order: readonly number[], available: readonly number[], shown: number): number | null {
  const valid = Array.from(new Set(order)).filter((n) => available.includes(n));
  const selected = valid.length > 0 ? valid : [...available].sort((a, b) => a - b);
  const next = selected.find((n) => n > shown);
  return next === undefined ? null : next;
}

/** Aantal regels van het volgende couplet dat in karaoke alvast zichtbaar is. */
export const KARAOKE_PREVIEW_LINES = 3;

export function formatPosition(s: FollowSnapshot | null): string {
  return s && s.bpm > 0 ? `maat ${s.measure + 1} · ${Math.round(s.bpm)}/min` : "—";
}

/** Na zo lang zonder audiobuffer geldt de microfoon als "geen geluid ontvangen" (milliseconden). */
export const NO_AUDIO_AFTER_MS = 3000;

/**
 * Luistert de microfoon wel, maar komt er geen audio binnen? Dat gebeurt bij een onderbroken AudioContext, een stille of weggevallen
 * bron of een kapotte worklet. Het scherm moet dat tonen in plaats van stilzwijgend "luisteren" te blijven staan.
 */
export function audioMissing(diag: { state: string; buffers: number; msListening: number | null; msSinceLastBuffer: number | null } | null): boolean {
  if (!diag || diag.state !== "listening" || diag.msListening === null) return false;
  if (diag.buffers === 0) return diag.msListening > NO_AUDIO_AFTER_MS;
  return (diag.msSinceLastBuffer ?? 0) > NO_AUDIO_AFTER_MS;
}

export interface MeasureHold {
  key: string;
  value: number | null;
  /** Sinds wanneer (audiotijd, seconden) de gemeten maat onder de vastgehouden maat ligt; null als dat niet zo is. */
  behindSince: number | null;
}

/** Zo lang (seconden) mag de maatmarkering een kleine stap terug negeren voordat hij die als echt aanvaardt (een rondegrens of herstel). */
export const MEASURE_HOLD_SECONDS = 1.5;

/**
 * De maatmarkering gaat binnen een couplet niet terug: een jitterende meting rond een maatgrens of de paar tienden seconden tussen "de positie
 * begint opnieuw" en "het couplet is doorgeschakeld" mogen de markering niet heen en weer laten springen (dezelfde regel als bij de woordmarkering,
 * display.ts). Blijft de meting langer dan MEASURE_HOLD_SECONDS lager (nieuwe ronde in het laatste couplet, herstel), dan volgt de markering haar toch.
 * `key` verandert bij een ander couplet of een andere lofzang: dan begint de markering opnieuw.
 */
export function holdMeasure(prev: MeasureHold, key: string, measure: number | null, time: number): MeasureHold {
  if (prev.key !== key || measure === null || prev.value === null) return prev.key === key && prev.value === measure && prev.behindSince === null ? prev : { key, value: measure, behindSince: null };
  if (measure >= prev.value) return measure === prev.value && prev.behindSince === null ? prev : { key, value: measure, behindSince: null };
  const since = prev.behindSince ?? time;
  if (time - since >= MEASURE_HOLD_SECONDS) return { key, value: measure, behindSince: null };
  return prev.behindSince === since ? prev : { key, value: prev.value, behindSince: since };
}
