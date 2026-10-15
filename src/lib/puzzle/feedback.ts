// Subtiele spelfeedback (geluid en haptiek) voor Legpuzzel 2.0. Uitsluitend presentatie: deze module kent
// geen spelregels, doet geen netwerkverzoeken en wordt alleen aangeroepen na een door de server bevestigde
// gebeurtenis (of, voor "pickup", een lokale aanraking). Beide voorkeuren staan standaard uit en worden alleen
// op dit apparaat bewaard. Zie docs/puzzle-v2/PHASE-5E-FEEDBACK-REPORT.md.

import { isNativeApp, lightHaptic } from "@/lib/platform";

export type PuzzleFeedbackEvent = "pickup" | "place" | "connect" | "complete" | "record";
export type FeedbackKind = "sound" | "haptics";

export const FEEDBACK_STORAGE_KEYS: Record<FeedbackKind, string> = { sound: "versado:feedback-sound", haptics: "versado:feedback-haptics" };
/** Browser-event waarmee de instellingen en een geopend spel elkaars wijziging zien (zonder polling). */
export const FEEDBACK_CHANGE_EVENT = "versado:feedback-change";

interface Tone { /** Frequentie in Hz. */ f: number; /** Start in seconden na het begin. */ at: number; /** Duur in seconden. */ dur: number; /** Piekvolume (0..1) vóór het hoofdvolume. */ peak: number }

/**
 * Per gebeurtenis wat zinvol is. `place` (loslaten zonder verbinding) heeft bewust géén effect: een stuk dat
 * bijna goed ligt mag nooit als succes klinken. `pickup` is alleen een zachte tik, zonder haptiek.
 * Zachte sinustonen met korte fade-in/-out; geen bestanden, geen netwerk.
 */
const PLAN: Record<PuzzleFeedbackEvent, { tones: Tone[]; pulses: number[] }> = {
  pickup: { tones: [{ f: 520, at: 0, dur: 0.05, peak: 0.35 }], pulses: [] },
  place: { tones: [], pulses: [] },
  connect: { tones: [{ f: 660, at: 0, dur: 0.09, peak: 0.55 }, { f: 880, at: 0.045, dur: 0.12, peak: 0.45 }], pulses: [14] },
  complete: { tones: [{ f: 523, at: 0, dur: 0.16, peak: 0.5 }, { f: 659, at: 0.13, dur: 0.16, peak: 0.5 }, { f: 784, at: 0.26, dur: 0.28, peak: 0.5 }], pulses: [14, 60, 14] },
  record: { tones: [{ f: 523, at: 0, dur: 0.14, peak: 0.5 }, { f: 659, at: 0.11, dur: 0.14, peak: 0.5 }, { f: 784, at: 0.22, dur: 0.14, peak: 0.5 }, { f: 1047, at: 0.33, dur: 0.34, peak: 0.55 }], pulses: [14, 60, 14, 60, 22] },
};
/** Korte rust tussen twee dezelfde effecten (ms): voorkomt een opeenstapeling bij snel achter elkaar plaatsen of ketens van verbindingen. */
const COOLDOWN_MS: Record<PuzzleFeedbackEvent, number> = { pickup: 90, place: 0, connect: 140, complete: 1500, record: 1500 };
/** Zeer laag hoofdvolume; de tonen zelf zijn zacht. */
const MASTER_GAIN = 0.12;
const FADE_IN = 0.008;
/**
 * Na deze stilte (ms, sinds het laatste gebaar of geluid) wordt de AudioContext gesloten: er blijft niets permanent
 * actief. Bewust niet na elk geluid: een iPhone laat audio alleen binnen een gebaar starten, dus een context die tijdens
 * het spelen blijft staan, laat ook de voltooiing (die na een serverantwoord komt) horen.
 */
const IDLE_CLOSE_MS = 15000;

export interface AudioParamLike { setValueAtTime(value: number, time: number): unknown; linearRampToValueAtTime(value: number, time: number): unknown; exponentialRampToValueAtTime(value: number, time: number): unknown }
export interface AudioNodeLike { connect(target: unknown): unknown; disconnect?(): unknown }
export interface OscillatorLike extends AudioNodeLike { type: string; frequency: { value: number }; onended: (() => void) | null; start(time?: number): void; stop(time?: number): void }
export interface GainLike extends AudioNodeLike { gain: AudioParamLike & { value: number } }
export interface AudioContextLike { readonly currentTime: number; readonly state: string; readonly destination: unknown; createOscillator(): OscillatorLike; createGain(): GainLike; resume(): Promise<void>; close(): Promise<void> }

export interface FeedbackEnvironment {
  storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  createAudioContext(): AudioContextLike | null;
  /** Bestaat Web Audio hier (zonder iets aan te maken)? */
  canAudio(): boolean;
  /** Bestaat web-trilling hier (zonder te trillen)? */
  canVibrate(): boolean;
  /** Web-trilling (navigator.vibrate); null zonder ondersteuning. */
  vibrate(pattern: number[]): boolean;
  /** Natief: de bestaande lichte haptiek van platform.ts. */
  nativeHaptic(): Promise<void>;
  isNative(): boolean;
  reducedMotion(): boolean;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  emitChange(): void;
}

export interface PuzzleFeedback {
  isEnabled(kind: FeedbackKind): boolean;
  setEnabled(kind: FeedbackKind, value: boolean): boolean;
  /** Ondersteunt dit apparaat/deze browser de haptiek? (Alleen informatief voor de instellingen.) */
  hapticsSupported(): boolean;
  soundSupported(): boolean;
  /** Een echt gebruikersgebaar (aanraking of toets): ontgrendelt zo nodig de audio; alleen als geluid aan staat. */
  noteGesture(): void;
  /** Speel een effect. `key` maakt het idempotent (bijv. één voltooiing per sessie). Retourneert of er iets is geactiveerd. */
  play(event: PuzzleFeedbackEvent, key?: string): boolean;
  /** Sluit de audio en timers (unmount). Voorkeuren blijven bewaard. */
  dispose(): void;
  /** Aantal geopende AudioContext-instanties tot nu toe en het aantal afgespeelde effecten (voor metingen/tests). */
  stats(): { contexts: number; played: number; openContext: boolean };
}

export function createPuzzleFeedback(env: FeedbackEnvironment): PuzzleFeedback {
  let context: AudioContextLike | null = null; let idle: unknown = null; let gestured = false;
  let contexts = 0; let played = 0; const last = new Map<PuzzleFeedbackEvent, number>(); const once = new Set<string>();

  function read(kind: FeedbackKind) { try { return env.storage()?.getItem(FEEDBACK_STORAGE_KEYS[kind]) === "1"; } catch { return false; } }
  function closeContext() {
    if (idle !== null) { env.clearTimer(idle); idle = null; }
    const old = context; context = null;
    if (old) { try { void old.close().catch(() => undefined); } catch { /* al gesloten */ } }
  }
  function ensureContext(): AudioContextLike | null {
    if (context) return context;
    if (!gestured) return null;
    try { context = env.createAudioContext(); if (context) contexts++; } catch { context = null; }
    return context;
  }
  function armIdle() {
    if (idle !== null) env.clearTimer(idle);
    idle = env.setTimer(() => { idle = null; closeContext(); }, IDLE_CLOSE_MS);
  }
  function sound(event: PuzzleFeedbackEvent): boolean {
    const tones = PLAN[event].tones; if (tones.length === 0) return false;
    const ctx = ensureContext(); if (!ctx) return false;
    try {
      // Een geblokkeerde context (autoplaybeleid) is geen fout: dan blijft het stil.
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      const start = ctx.currentTime + 0.005; let end = start;
      for (const tone of tones) {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = "sine"; osc.frequency.value = tone.f;
        const from = start + tone.at; const to = from + tone.dur; end = Math.max(end, to);
        // Korte fade-in en exponentiële uitloop: geen hoorbare klik of scherpe piek.
        gain.gain.setValueAtTime(0.0001, from); gain.gain.linearRampToValueAtTime(tone.peak * MASTER_GAIN, from + FADE_IN); gain.gain.exponentialRampToValueAtTime(0.0001, to);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.onended = () => { try { osc.disconnect?.(); gain.disconnect?.(); } catch { /* al losgekoppeld */ } };
        osc.start(from); osc.stop(to + 0.02);
      }
      armIdle(); return true;
    } catch { return false; }
  }
  function haptic(event: PuzzleFeedbackEvent): boolean {
    const pulses = PLAN[event].pulses; if (pulses.length === 0) return false;
    // Reduced motion: één korte puls in plaats van een patroon.
    const pattern = env.reducedMotion() ? [pulses[0]] : pulses;
    try {
      if (env.isNative()) {
        // Natief via de bestaande lichte haptiek: de oneven elementen zijn pulsen, de even rustpauzes.
        const beats = pattern.filter((_, index) => index % 2 === 0).length;
        const run = async () => { for (let i = 0; i < beats; i++) { await env.nativeHaptic(); if (i < beats - 1) await new Promise<void>((resolve) => env.setTimer(resolve, 90)); } };
        void run().catch(() => undefined); return true;
      }
      return env.vibrate(pattern);
    } catch { return false; }
  }

  return {
    isEnabled: read,
    setEnabled(kind, value) {
      try { const storage = env.storage(); if (!storage) return false; if (value) storage.setItem(FEEDBACK_STORAGE_KEYS[kind], "1"); else storage.removeItem(FEEDBACK_STORAGE_KEYS[kind]); } catch { return false; }
      if (kind === "sound" && !value) closeContext();
      env.emitChange(); return true;
    },
    hapticsSupported: () => env.isNative() || env.canVibrate(),
    soundSupported: () => env.canAudio(),
    noteGesture() {
      gestured = true;
      if (!read("sound")) return;
      const ctx = ensureContext();
      if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      if (ctx) armIdle();
    },
    play(event, key) {
      const wantsSound = read("sound"); const wantsHaptics = read("haptics");
      if (!wantsSound && !wantsHaptics) return false;
      if (key !== undefined) { if (once.has(`${event}:${key}`)) return false; }
      const now = env.now(); const before = last.get(event);
      if (before !== undefined && now - before < COOLDOWN_MS[event]) return false;
      let did = false;
      if (wantsSound && sound(event)) did = true;
      if (wantsHaptics && haptic(event)) did = true;
      // Een poging zonder effect (nog geen gebaar) houdt de cooldown niet bezet; een sleutel telt wel: één viering per gebeurtenis.
      if (did) last.set(event, now); if (key !== undefined && did) once.add(`${event}:${key}`);
      if (did) played++; return did;
    },
    dispose() { closeContext(); },
    stats: () => ({ contexts, played, openContext: context !== null }),
  };
}

type AudioConstructor = new () => AudioContextLike;
function audioConstructor(): AudioConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioConstructor; webkitAudioContext?: AudioConstructor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** De echte omgeving; browser-API's worden pas bij gebruik aangeraakt en elk onderdeel mag ontbreken. */
export function browserFeedbackEnvironment(): FeedbackEnvironment {
  return {
    storage: () => { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } },
    createAudioContext: () => { const Ctor = audioConstructor(); return Ctor ? new Ctor() : null; },
    canAudio: () => audioConstructor() !== null,
    canVibrate: () => typeof navigator !== "undefined" && typeof navigator.vibrate === "function",
    vibrate: (pattern) => { try { return typeof navigator !== "undefined" && typeof navigator.vibrate === "function" ? navigator.vibrate(pattern) : false; } catch { return false; } },
    nativeHaptic: () => lightHaptic(),
    isNative: () => { try { return typeof window !== "undefined" && isNativeApp(); } catch { return false; } },
    reducedMotion: () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    emitChange: () => { try { if (typeof window !== "undefined") window.dispatchEvent(new Event(FEEDBACK_CHANGE_EVENT)); } catch { /* geen event */ } },
  };
}

let shared: PuzzleFeedback | null = null;
/** Eén gedeelde instantie per pagina (één AudioContext tegelijk, gedeelde cooldowns). */
export function puzzleFeedback(): PuzzleFeedback { return shared ??= createPuzzleFeedback(browserFeedbackEnvironment()); }
