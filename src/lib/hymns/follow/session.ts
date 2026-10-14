import { ChromaExtractor, type FeatureFrame } from "../audio/features";
import { buildReference, type Reference } from "../score/reference";
import type { ResolvedHymn } from "../types";
import { ScoreTracker, type TrackerConfig, type TrackerOutput } from "./tracker";
import { StanzaPlan } from "./stanzas";
import { StableCursor, sectionAt, type DisplayCursor } from "./display";
import { SingingPhase, type PhaseConfig, type PhaseEvent, type PhaseState } from "./phase";

// Eén volg-sessie voor één lofzang: audio -> kenmerken -> tracker -> status/betrouwbaarheid -> rondes ->
// getoond couplet en markering. Alles lokaal en in het geheugen; de sessie bewaart geen audio.

export type SyncStatus = "idle" | "acquiring" | "locked" | "uncertain" | "lost" | "recovered";

export interface SessionConfig {
  tracker: Partial<TrackerConfig>;
  /** Betrouwbaarheid vanaf welke we "gesynchroniseerd" noemen, en hoe lang die moet standhouden. */
  lockConfidence: number;
  lockSeconds: number;
  /** Onder deze betrouwbaarheid (langer dan `uncertainSeconds`) wordt de status "onzeker". */
  uncertainConfidence: number;
  uncertainSeconds: number;
  /** Onder deze betrouwbaarheid (langer dan `lostSeconds`) is de synchronisatie "verloren". */
  lostConfidence: number;
  lostSeconds: number;
  /** Zo lang blijft "hersteld" zichtbaar. */
  recoveredSeconds: number;
  /** Na zo lang stilte wordt de status onzeker (de positie blijft wel vastgehouden). */
  pauseUncertainSeconds: number;
  /** Regels voor de voorspel- en zangfase (zie phase.ts). */
  phase: Partial<PhaseConfig>;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  // Het voorspel kan overal in de melodie beginnen (de laatste vier maten), dus geen voorkeur voor het begin.
  tracker: { start: "uniform" },
  lockConfidence: 0.55,
  lockSeconds: 1.5,
  uncertainConfidence: 0.35,
  uncertainSeconds: 1.5,
  lostConfidence: 0.2,
  lostSeconds: 5,
  recoveredSeconds: 4,
  pauseUncertainSeconds: 25,
  phase: {},
};

export interface SessionEvent {
  time: number;
  type: "status" | "lap" | "stanza" | "phase";
  from?: SyncStatus;
  to?: SyncStatus;
  lap?: number;
  stanza?: number;
  reason?: string;
  /** Alleen bij type "phase": welke gebeurtenis van de fase-laag (start, tussenspel, hervat, genegeerde ronde, ...). */
  phaseEvent?: PhaseEvent["type"];
}

export interface FollowSnapshot {
  time: number;
  status: SyncStatus;
  /** 0..1, alleen een maat voor "klopt de positie"; nooit een belofte. */
  confidence: number;
  /** Er klinkt (bijna) niets: de positie is vastgehouden. */
  paused: boolean;
  /** Positie in beats binnen de cyclus (couplet + refrein). */
  position: number;
  measure: number;
  bpm: number;
  /** Aantal voltooide gezongen rondes sinds het zangbegin (0 = het eerste couplet wordt nog gezongen). */
  lap: number;
  /** Voorspel of zang: de woordmarkering loopt alleen mee als de zang is begonnen. */
  phase: PhaseState;
  /** True als een ronde mogelijk gemist is (verlies tijdens de rondegrens): handmatig couplet kiezen. */
  lapUncertain: boolean;
  stanza: number;
  cursor: DisplayCursor;
}

export class HymnFollowSession {
  readonly hymn: ResolvedHymn;
  readonly reference: Reference;
  readonly stanzas: StanzaPlan;
  readonly config: SessionConfig;
  readonly events: SessionEvent[] = [];
  private tracker: ScoreTracker;
  private phaseLayer: SingingPhase;
  private readonly cursor = new StableCursor();
  private extractor: ChromaExtractor | null = null;

  private status: SyncStatus = "idle";
  private statusSince = 0;
  private quality = 0;
  private concEma = 0;
  private confidence = 0;
  private aboveLock = 0;
  private belowUncertain = 0;
  private belowLost = 0;
  private silentSince: number | null = null;
  private lastTime = 0;
  private lapUncertain = false;
  private lastOut: TrackerOutput | null = null;
  private lastSnapshot: FollowSnapshot;

  constructor(hymn: ResolvedHymn, config: Partial<SessionConfig> = {}, reference?: Reference) {
    this.hymn = hymn;
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config };
    this.reference = reference ?? buildReference(hymn.composition);
    this.tracker = new ScoreTracker(this.reference, this.config.tracker);
    this.phaseLayer = new SingingPhase(this.reference.cycleBeats, this.config.phase);
    this.stanzas = new StanzaPlan(hymn.text.stanzas.map((s) => s.n));
    this.lastSnapshot = this.snapshot(0, null);
  }

  /** Voer ruwe samples (mono) in. Geeft de toestand na het laatst afgeronde frame terug (of de vorige). */
  pushAudio(samples: Float32Array, sampleRate: number): FollowSnapshot {
    if (!this.extractor || this.extractor.config.sampleRate !== sampleRate) this.extractor = new ChromaExtractor({ sampleRate });
    let last = this.lastSnapshot;
    for (const frame of this.extractor.push(samples)) last = this.pushFrame(frame);
    return last;
  }

  /** Voer één kenmerkframe in (ook handig voor tests met vooraf berekende frames). */
  pushFrame(frame: FeatureFrame): FollowSnapshot {
    const out = this.tracker.update(frame);
    this.lastOut = out;
    const dt = this.lastTime > 0 ? Math.max(0, frame.time - this.lastTime) : 0;
    this.lastTime = frame.time;
    this.updateQuality(out, dt);
    this.updateStatus(frame.time, out, dt);
    this.applyPhaseEvents(
      this.phaseLayer.observe({ time: frame.time, position: out.position, concentration: out.concentration, bpm: out.bpm, held: out.held, silent: frame.silent, rmsDb: frame.rmsDb }),
    );
    const reliable = this.status === "locked" || this.status === "recovered";
    const stanza = this.stanzas.current;
    // Voor het zangbegin (voorspel) en tijdens een tussenspel staat de tekst klaar zonder markering.
    const cursor = this.phaseLayer.isSinging ? this.cursor.update(this.hymn.text, this.reference.sections, stanza, out.position, reliable && !out.held) : null;
    this.lastSnapshot = this.snapshot(frame.time, cursor);
    return this.lastSnapshot;
  }

  get snapshotNow(): FollowSnapshot {
    return this.lastSnapshot;
  }

  /**
   * De gebruiker bevestigt dat het zingen nu begint. De muziekvolging, de microfoon en de gevolgde positie
   * blijven ongemoeid; alleen de markering gaat van "klaarstaan" naar "meelopen".
   */
  confirmSingingStart(): void {
    const out = this.lastOut;
    this.applyPhaseEvents(this.phaseLayer.confirmStart(this.lastTime, out ? out.position : 0));
    this.refreshSnapshot();
  }

  /**
   * "Opnieuw synchroniseren": de markering stopt tot het zangbegin opnieuw is vastgesteld en de volger zoekt
   * zijn plek opnieuw in de muziek die nu klinkt. De audiopijplijn (microfoon, extractor) blijft gewoon doorlopen.
   */
  resync(): void {
    this.applyPhaseEvents(this.phaseLayer.backToPrelude(this.lastTime));
    this.tracker.reset("uniform");
    this.status = "idle";
    this.statusSince = this.lastTime;
    this.quality = 0;
    this.concEma = 0;
    this.confidence = 0;
    this.lapUncertain = false;
    this.lastOut = null;
    this.cursor.reset();
    this.refreshSnapshot();
  }

  private refreshSnapshot(): void {
    const cursor = this.phaseLayer.isSinging ? this.cursor.update(this.hymn.text, this.reference.sections, this.stanzas.current, this.lastSnapshot.position, this.lastSnapshot.status === "locked" || this.lastSnapshot.status === "recovered") : null;
    this.lastSnapshot = this.snapshot(this.lastTime, cursor);
  }

  private applyPhaseEvents(events: PhaseEvent[]): void {
    for (const e of events) {
      this.events.push({ time: e.time, type: "phase", phaseEvent: e.type, reason: e.type === "start" ? `${e.reason}: ${e.evidence.join("; ")}` : undefined });
      if (e.type === "start") {
        this.lapUncertain = false;
        this.cursor.reset();
      } else if (e.type === "lap") {
        this.lapUncertain = false;
        this.events.push({ time: e.time, type: "lap", lap: e.lap });
        const change = this.stanzas.onNewLap(e.lap);
        if (change) this.events.push({ time: e.time, type: "stanza", stanza: change.stanza, reason: change.reason });
        this.cursor.permitJump();
      } else if (e.type === "resume") {
        this.cursor.permitJump();
      } else if (e.type === "back-to-prelude") {
        this.cursor.reset();
      }
    }
  }

  /** De gebruiker tikt op een coupletnummer. De muziekherkenning wordt niet aangeraakt. */
  selectStanza(stanza: number): void {
    const change = this.stanzas.selectManual(stanza, this.phaseLayer.state.sungLaps);
    if (change) {
      this.cursor.permitJump();
      this.events.push({ time: this.lastTime, type: "stanza", stanza, reason: "manual" });
      this.refreshSnapshot();
    }
  }

  setStanzaOrder(order: number[]): void {
    this.stanzas.setOrder(order);
  }

  private updateQuality(out: TrackerOutput, dt: number): void {
    if (out.held) return;
    // Kwaliteit = hoeveel beter de gevolgde positie de klank verklaart dan "ergens willekeurig" (log-
    // waarschijnlijkheidsverhouding per frame). Dat past zich vanzelf aan ruis en nagalm aan, in
    // tegenstelling tot een vaste drempel op de absolute overeenkomst.
    const a = 1 - Math.exp(-dt / 1.0);
    this.quality += a * (out.logEvidence - out.logNull - this.quality);
    const b = 1 - Math.exp(-dt / 0.5);
    this.concEma += b * (out.concentration - this.concEma);
    const q = clamp01((this.quality - 0.03) / 0.12);
    const c = clamp01((this.concEma - 0.5) / 0.35);
    const target = q * c;
    const k = 1 - Math.exp(-dt / 0.4);
    this.confidence += k * (target - this.confidence);
  }

  private setStatus(time: number, to: SyncStatus, reason?: string): void {
    if (to === this.status) return;
    this.events.push({ time, type: "status", from: this.status, to, reason });
    this.status = to;
    this.statusSince = time;
    this.aboveLock = 0;
    this.belowUncertain = 0;
    this.belowLost = 0;
  }

  private updateStatus(time: number, out: TrackerOutput, dt: number): void {
    const cfg = this.config;
    if (out.held) {
      if (this.silentSince === null) this.silentSince = time;
      // Een lange stilte maakt de positie onzeker (we weten niet of de speler nog verder gaat).
      if (this.status === "locked" && time - this.silentSince > cfg.pauseUncertainSeconds) this.setStatus(time, "uncertain", "lange stilte");
      return;
    }
    this.silentSince = null;
    const conf = this.confidence;
    if (this.status === "idle") this.setStatus(time, "acquiring");

    switch (this.status) {
      case "acquiring":
        this.aboveLock = conf >= cfg.lockConfidence ? this.aboveLock + dt : 0;
        if (this.aboveLock >= cfg.lockSeconds) this.setStatus(time, "locked");
        break;
      case "locked":
        this.belowUncertain = conf < cfg.uncertainConfidence ? this.belowUncertain + dt : 0;
        if (this.belowUncertain >= cfg.uncertainSeconds) this.setStatus(time, "uncertain");
        break;
      case "uncertain":
        this.aboveLock = conf >= cfg.lockConfidence ? this.aboveLock + dt : 0;
        this.belowLost = conf < cfg.lostConfidence ? this.belowLost + dt : 0;
        if (this.aboveLock >= cfg.lockSeconds) {
          // kort onzeker geweest en positie klopt weer: gewoon weer gesynchroniseerd
          this.setStatus(time, this.statusSince > 0 && time - this.statusSince < 6 ? "locked" : "recovered");
        } else if (this.belowLost >= cfg.lostSeconds) this.setStatus(time, "lost");
        break;
      case "lost":
        this.aboveLock = conf >= cfg.lockConfidence ? this.aboveLock + dt : 0;
        if (this.aboveLock >= cfg.lockSeconds + 0.5) {
          this.setStatus(time, "recovered");
          this.lapUncertain = true; // tijdens het verlies kan een ronde zijn gemist
          this.cursor.permitJump();
        }
        break;
      case "recovered":
        if (time - this.statusSince >= cfg.recoveredSeconds) this.setStatus(time, "locked");
        else {
          this.belowUncertain = conf < cfg.uncertainConfidence ? this.belowUncertain + dt : 0;
          if (this.belowUncertain >= cfg.uncertainSeconds) this.setStatus(time, "uncertain");
        }
        break;
      default:
        break;
    }
  }

  private snapshot(time: number, cursor: DisplayCursor | null): FollowSnapshot {
    const out = this.lastOut;
    const position = out ? out.position : 0;
    const starts = this.hymn.composition.measureStarts;
    let measure = 0;
    for (let i = 0; i < starts.length; i += 1) if (starts[i] <= position + 1e-6) measure = i;
    return {
      time,
      status: this.status,
      confidence: this.confidence,
      paused: out?.held ?? false,
      position,
      measure,
      bpm: out ? out.bpm : 0,
      lap: this.phaseLayer.state.sungLaps,
      phase: this.phaseLayer.state,
      lapUncertain: this.lapUncertain,
      stanza: this.stanzas.current,
      cursor: cursor ?? IDLE_CURSOR,
    };
  }

  get sectionNow() {
    return sectionAt(this.reference.sections, this.lastSnapshot.position);
  }

  /** Alles weer op nul (nieuwe sessie met dezelfde lofzang), zonder het gekozen couplet te verliezen. */
  restart(): void {
    this.tracker.reset(this.config.tracker.start ?? "uniform");
    this.extractor?.reset();
    this.phaseLayer = new SingingPhase(this.reference.cycleBeats, this.config.phase);
    this.cursor.reset();
    this.status = "idle";
    this.statusSince = 0;
    this.quality = 0;
    this.concEma = 0;
    this.confidence = 0;
    this.lapUncertain = false;
    this.lastTime = 0;
    this.silentSince = null;
    this.lastOut = null;
  }
}

const IDLE_CURSOR: DisplayCursor = { section: "verse", line: -1, word: null, frozen: false };

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
