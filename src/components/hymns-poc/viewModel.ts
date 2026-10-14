import type { DisplayCursor } from "@/lib/hymns/follow/display";
import type { FollowSnapshot } from "@/lib/hymns/follow/session";
import type { LiveState } from "@/lib/hymns/live";
import type { HymnLine, HymnStanza, HymnText } from "@/lib/hymns/types";
import type { MicState } from "@/lib/hymns/audio/micListener";
import { RECOGNITION_TEXT, SYNC_TEXT } from "./copy";

// Pure afleidingen voor de Lofzangen-weergave (getest in tests/hymns-ui.test.ts): welke statustekst staat er,
// welke regels horen bij karaoke, en wanneer moet er gescrold worden. Geen React, geen DOM.

export type StatusTone = "neutral" | "ok" | "warn" | "danger" | "info";

export interface StatusView {
  label: string;
  tone: StatusTone;
  /** Korte uitleg onder de status (bijvoorbeeld: wachten op zangbegin). */
  hint: string | null;
}

export function describeStatus(mic: MicState, live: LiveState): StatusView | null {
  if (mic !== "listening" && live.stage !== "following") return null;
  if (live.stage === "recognizing") {
    const r = live.recognition;
    return { label: r ? RECOGNITION_TEXT[r.status] : RECOGNITION_TEXT.listening, tone: r?.status === "ambiguous" || r?.status === "unknown" ? "warn" : "neutral", hint: null };
  }
  if (live.stage !== "following") return null;
  const s = live.snapshot;
  if (!s || s.status === "idle" || s.status === "acquiring") return { label: SYNC_TEXT.acquiring, tone: "neutral", hint: null };
  if (s.phase.phase === "interlude") return { label: "Tussenspel", tone: "info", hint: "De tekst staat klaar voor het volgende couplet." };
  if (s.phase.phase === "prelude") {
    return { label: "Voorspel", tone: "info", hint: s.phase.waiting ? "Wachten op het zangbegin. Tik op Zang begint als de gemeente zingt." : "De tekst staat klaar." };
  }
  if (s.status === "uncertain") return { label: SYNC_TEXT.uncertain, tone: "warn", hint: null };
  if (s.status === "lost") return { label: SYNC_TEXT.lost, tone: "danger", hint: null };
  return { label: "Volgt muziek", tone: "ok", hint: s.lapUncertain ? "Controleer het couplet." : null };
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

export interface KaraokeWindow {
  previous: LyricLine | null;
  current: LyricLine | null;
  next: LyricLine | null;
  /** True zolang er nog niets actief is: de eerste regel staat klaar. */
  ready: boolean;
}

export function karaokeWindow(seq: LyricLine[], active: number): KaraokeWindow {
  const ready = active < 0;
  const i = ready ? 0 : active;
  return { previous: seq[i - 1] ?? null, current: seq[i] ?? null, next: seq[i + 1] ?? null, ready };
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

/**
 * Hoeveel pixels moet het venster scrollen om de actieve regel in beeld te houden? 0 als het hele couplet
 * past of de regel al rustig in beeld staat. Anders komt de regel op ongeveer 38% van het gebied te staan,
 * zodat de gebruiker kan vooruitlezen.
 */
export function scrollDelta(g: ScrollGeometry, margin = 24): number {
  const available = g.viewBottom - g.viewTop;
  if (available <= 0 || g.contentHeight <= available - margin) return 0;
  if (g.lineTop >= g.viewTop + margin * 0.5 && g.lineBottom <= g.viewBottom - margin) return 0;
  const target = g.viewTop + available * 0.38;
  return Math.round(g.lineTop - target);
}

export function formatPosition(s: FollowSnapshot | null): string {
  return s && s.bpm > 0 ? `maat ${s.measure + 1} · ${Math.round(s.bpm)}/min` : "—";
}
