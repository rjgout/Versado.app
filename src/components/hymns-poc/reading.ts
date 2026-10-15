import type { FollowSnapshot } from "@/lib/hymns/follow/session";

// Lezen heeft altijd voorrang. Er zijn twee onafhankelijke posities:
//  - MusicalPosition: waar de muziekengine is (snapshot.cursor); alleen de engine zet die;
//  - ReadingPosition: welk couplet en welke regel de gebruiker leest (dit bestand).
// In de stand "auto" volgt de leesplek de muziek. Zodra de gebruiker zelf scrolt, een regel aantikt, een regel
// vooruit of terug gaat of tijdens het zingen een couplet kiest, staat de stand op "manual": alleen het automatische
// bladeren (couplet tonen en scrollen) pauzeert. De microfoon, de engine en de muzikale positie merken er niets van.
// Pure logica zonder React of DOM, getest in tests/hymns-reading.test.ts.

export type ReadingMode = "auto" | "manual";
export type ResumeReason = "unsure" | "lost" | "waiting";

export interface ReadingState {
  mode: ReadingMode;
  /** Het couplet dat de gebruiker leest; alleen in de stand "manual" bepalend. */
  stanza: number | null;
  /** Index (in de doorlopende reeks couplet + refrein) van de regel die de gebruiker leest. */
  line: number | null;
  /** Waarom "Automatisch volgen hervatten" nog niet kon; verdwijnt vanzelf. */
  note: ResumeReason | null;
}

export const INITIAL_READING: ReadingState = { mode: "auto", stanza: null, line: null, note: null };

export type ResumeVerdict = { ok: true } | { ok: false; reason: ResumeReason };

export type ReadingAction =
  /** Eigen scrollgebaar van de gebruiker in de leesruimte. `stanza` is het couplet dat nu getoond wordt. */
  | { type: "scroll"; following: boolean; stanza: number }
  /** De gebruiker tikt een regel aan. */
  | { type: "line"; line: number; following: boolean; stanza: number }
  /** Een regel vooruit (1) of terug (-1), vanaf `from` (de regel waar de gebruiker nu is). */
  | { type: "step"; dir: 1 | -1; from: number; count: number; following: boolean; stanza: number }
  /** De gebruiker kiest een couplet. */
  | { type: "stanza"; stanza: number; following: boolean }
  | { type: "resume"; verdict: ResumeVerdict }
  | { type: "clearNote" }
  | { type: "reset" };

export function readingReducer(s: ReadingState, a: ReadingAction): ReadingState {
  switch (a.type) {
    case "scroll":
      // Zonder meeluisterende engine valt er niets te pauzeren: gewoon lezen.
      if (!a.following || s.mode === "manual") return s;
      return { mode: "manual", stanza: a.stanza, line: s.line, note: null };
    case "line":
      if (!a.following) return { ...s, line: a.line };
      return { mode: "manual", stanza: s.mode === "manual" && s.stanza !== null ? s.stanza : a.stanza, line: a.line, note: null };
    case "step": {
      const max = Math.max(0, a.count - 1);
      const base = a.from < 0 ? (a.dir === 1 ? -1 : 1) : a.from;
      const line = Math.min(max, Math.max(0, base + a.dir));
      if (!a.following) return { ...s, line };
      return { mode: "manual", stanza: s.mode === "manual" && s.stanza !== null ? s.stanza : a.stanza, line, note: null };
    }
    case "stanza":
      // Tijdens handmatig lezen verandert alleen de leesplek; de engine houdt zijn eigen couplet.
      if (a.following && s.mode === "manual") return { mode: "manual", stanza: a.stanza, line: null, note: null };
      return { ...INITIAL_READING };
    case "resume":
      return a.verdict.ok ? { ...INITIAL_READING } : { ...s, note: a.verdict.reason };
    case "clearNote":
      return s.note === null ? s : { ...s, note: null };
    case "reset":
      return s === INITIAL_READING ? s : { ...INITIAL_READING };
    default:
      return s;
  }
}

/**
 * Mag de tekst weer de muziek volgen? Alleen bij een betrouwbare synchronisatie; anders blijft de gebruiker waar
 * hij leest en wordt er niets gesprongen. Een mogelijk gemiste ronde telt als onzeker zolang de gebruiker in een
 * ander couplet leest dan de engine denkt.
 */
export function resumeVerdict(snap: FollowSnapshot | null, readingStanza: number | null): ResumeVerdict {
  if (!snap || snap.status === "idle" || snap.status === "acquiring") return { ok: false, reason: "waiting" };
  if (snap.status === "lost") return { ok: false, reason: "lost" };
  if (snap.status === "uncertain") return { ok: false, reason: "unsure" };
  if (snap.phase.phase === "singing" && (snap.cursor.line < 0 || snap.cursor.frozen)) return { ok: false, reason: "unsure" };
  if (snap.lapUncertain && readingStanza !== null && readingStanza !== snap.stanza) return { ok: false, reason: "unsure" };
  return { ok: true };
}

/** Het couplet dat getoond wordt: tijdens handmatig lezen dat van de gebruiker, anders dat van de muziek (of de keuze vooraf). */
export function displayedStanza(s: ReadingState, engineStanza: number, following: boolean): number {
  return following && s.mode === "manual" && s.stanza !== null ? s.stanza : engineStanza;
}

/**
 * De regel die in karaoke groot en gecentreerd staat. Tijdens handmatig lezen is dat de leesregel; anders de
 * actieve regel van de muziek. Verliest de engine tijdelijk zijn regel (onzeker, tussenspel), dan blijft de
 * laatst bekende regel staan (`sticky`), zodat de tekst niet terugspringt naar het begin.
 */
export function focusLine(s: ReadingState, active: number, sticky: number, count: number): number {
  const raw = s.line ?? (s.mode === "manual" ? 0 : active >= 0 ? active : sticky >= 0 ? sticky : 0);
  return count <= 0 ? -1 : Math.min(count - 1, Math.max(0, raw));
}

/** Naar welke regel scrollt een bewuste navigatie (aantikken, vorige/volgende, hervatten)? -1 = geen. */
export function navigationTarget(s: ReadingState, active: number, sticky: number, count: number, view: "stanza" | "karaoke"): number {
  if (count <= 0) return -1;
  if (view === "karaoke") return focusLine(s, active, sticky, count);
  const raw = s.line ?? (active >= 0 ? active : -1);
  return raw < 0 ? -1 : Math.min(count - 1, raw);
}

/** Het scherm voor de muziek-markering: alleen als de engine in het getoonde couplet zit. */
export function musicalCursorVisible(engineStanza: number | null, shownStanza: number): boolean {
  return engineStanza !== null && engineStanza === shownStanza;
}

export interface StickyLine {
  key: string;
  value: number;
}

/**
 * Onthoudt de laatste actieve regel van de muziek binnen hetzelfde couplet en dezelfde fase. Verliest de engine
 * tijdelijk zijn regel (onzeker, tussenspel, opnieuw synchroniseren), dan blijft de focus daar staan in plaats van
 * terug te springen naar het begin. Een ander couplet of het voorspel begint opnieuw.
 */
export function nextSticky(held: StickyLine, key: string, active: number): StickyLine {
  if (held.key !== key) return { key, value: active };
  if (active >= 0 && active !== held.value) return { key, value: active };
  return held;
}
