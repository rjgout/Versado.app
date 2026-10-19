import { ChromaExtractor, type FeatureFrame } from "../audio/features";
import { buildReference, type Reference } from "../score/reference";
import type { ResolvedHymn } from "../types";
import { type TrackerConfig, type TrackerOutput } from "./tracker";
import { HybridScoreTracker, type TrackSource } from "./hybrid";
import type { FeatureLayout } from "../audio/features";
import { melodyComposition, type MelodyResult } from "../score/melody";
import { StanzaPlan } from "./stanzas";
import { StableCursor, sectionAt, type DisplayCursor } from "./display";
import { SingingPhase, type PhaseConfig, type PhaseEvent, type PhaseState } from "./phase";
import { PositionGate } from "./gate";
import { PositionCoaster, type CoastConfig, type PositionSource } from "./coast";

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
  /** Hoe snel de vergrendelteller bij een dip terugloopt als de melodie de positie levert (1 = zoals bij instrumenten: meteen naar nul). */
  melodyLockDecay: number;
  /** Vertrouwen bij de melodiereferentie: kwaliteit (log-bewijs per frame) en concentratie van de positie waarbij het vertrouwen 0 resp. 1 is. */
  melodyQualityFloor: number;
  melodyQualityScale: number;
  melodyConcFloor: number;
  melodyConcScale: number;
  /** Aandeel frames met betrouwbare toonhoogte waarboven de zang als "één heldere stem" geldt (van .. tot ..), en de strengere kwaliteitseis daarvoor. */
  melodyCleanFrom: number;
  melodyCleanTo: number;
  melodyCleanQualityFloor: number;
  melodyCleanQualityScale: number;
  uncertainSeconds: number;
  /** Onder deze betrouwbaarheid (langer dan `lostSeconds`) is de synchronisatie "verloren". */
  lostConfidence: number;
  lostSeconds: number;
  /** Zo lang blijft "hersteld" zichtbaar. */
  recoveredSeconds: number;
  /** Na zo lang stilte wordt de status onzeker (de positie blijft wel vastgehouden). */
  pauseUncertainSeconds: number;
  /** Volg ook alleen de melodie (solozang, a capella) als de lofzang een gecontroleerde melodie heeft. */
  melodyTracking: boolean;
  /** Regels voor de voorspel- en zangfase (zie phase.ts). */
  phase: Partial<PhaseConfig>;
  /** Doorlopen op het laatst betrouwbare tempo bij tijdelijk syncverlies (zie coast.ts). */
  coast: Partial<CoastConfig>;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  // Het voorspel kan overal in de melodie beginnen (de laatste vier maten), dus geen voorkeur voor het begin.
  tracker: { start: "uniform" },
  lockConfidence: 0.55,
  lockSeconds: 1.5,
  uncertainConfidence: 0.35,
  melodyLockDecay: 0.5,
  melodyQualityFloor: 0.01,
  melodyQualityScale: 0.05,
  melodyConcFloor: 0.8,
  melodyConcScale: 0.1,
  melodyCleanFrom: 0.6,
  melodyCleanTo: 0.85,
  melodyCleanQualityFloor: 0.08,
  melodyCleanQualityScale: 0.12,
  uncertainSeconds: 1.5,
  lostConfidence: 0.2,
  lostSeconds: 5,
  recoveredSeconds: 4,
  pauseUncertainSeconds: 25,
  melodyTracking: true,
  phase: {},
  coast: {},
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
  /**
   * Positie waarop de woordmarkering en de maatmarkering steunen: gemeten (`position`), of tijdens tijdelijk syncverlies geschat op het laatst
   * betrouwbare tempo. null zolang er geen markering is (voorspel, tussenspel). `positionSource` zegt welke van de twee het is.
   */
  displayPosition: number | null;
  positionSource: PositionSource;
  /** Hoe lang (seconden) de positie nu al geschat wordt. */
  estimatedSeconds: number;
  /** Welke partituurreferentie de positie levert: de volledige begeleiding of alleen de zangmelodie (hybride volger). */
  trackSource?: TrackSource;
}

export class HymnFollowSession {
  readonly hymn: ResolvedHymn;
  readonly reference: Reference;
  readonly stanzas: StanzaPlan;
  readonly config: SessionConfig;
  readonly events: SessionEvent[] = [];
  private tracker: HybridScoreTracker;
  private phaseLayer: SingingPhase;
  private readonly cursor = new StableCursor();
  private readonly coast: PositionCoaster;
  private gate: PositionGate;
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
  private wasConfident = false;
  private lowSince: number | null = null;
  private lastSnapshot: FollowSnapshot;

  constructor(hymn: ResolvedHymn, config: Partial<SessionConfig> = {}, reference?: Reference) {
    this.hymn = hymn;
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config };
    this.reference = reference ?? buildReference(hymn.composition);
    // Met een gecontroleerde melodie volgt de sessie ook solozang (zie follow/hybrid.ts); zonder melodie alleen de volledige partituur.
    const melody = this.config.melodyTracking && hymn.melody && hymn.melody.length >= 12 ? { ref: buildReference(asMelodyComposition(hymn, hymn.melody), { layout: FOLDED_LAYOUT }), notes: hymn.melody } : null;
    this.tracker = new HybridScoreTracker(this.reference, melody, this.config.tracker);
    this.phaseLayer = new SingingPhase(this.reference.cycleBeats, this.config.phase);
    this.gate = new PositionGate(this.reference.cycleBeats);
    this.stanzas = new StanzaPlan(hymn.text.stanzas.map((s) => s.n));
    this.coast = new PositionCoaster({ cycleBeats: this.reference.cycleBeats, fermatas: this.reference.fermatas, nominalBeatsPerSecond: this.reference.nominalBeatsPerSecond }, this.config.coast);
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
      this.phaseLayer.observe({ time: frame.time, position: out.position, concentration: out.concentration, bpm: out.bpm, held: out.held, silent: frame.silent, rmsDb: frame.rmsDb, voice: this.tracker.voice }),
    );
    // De markering volgt alleen een positie waar de volger op dat moment ook echt vertrouwen in heeft: een kort verkeerd slot (bij zang
    // zonder begeleiding is het begin van een melodie vaak dubbelzinnig) zou de markering anders ver vooruit zetten, en daarna mag de
    // markering binnen een ronde niet meer terug. Herstelt het vertrouwen na een slechte periode, dan mag de markering wel springen.
    const confident = this.confidence >= (this.wasConfident ? this.config.uncertainConfidence : this.config.lockConfidence);
    if (!confident) this.lowSince ??= frame.time;
    else {
      if (!this.wasConfident && this.lowSince !== null && frame.time - this.lowSince >= 1 && this.phaseLayer.isSinging && this.tracker.source === "melody") this.cursor.permitJump();
      this.lowSince = null;
    }
    this.wasConfident = confident;
    const reliable = (this.status === "locked" || this.status === "recovered") && (confident || this.tracker.source !== "melody");
    const stanza = this.stanzas.current;
    const singing = this.phaseLayer.isSinging;
    // Tijdelijk syncverlies: de woorden lopen een beperkte tijd door op het laatst betrouwbare tempo (coast.ts); stilte bevriest ze.
    // Zang met alleen de melodie: losse verkeerde frames (herhaalde frasen) mogen de woordmarkering niet blijvend verzetten (follow/gate.ts).
    const markPosition = this.gate.filter(frame.time, out.position, out.bpm / 60);
    const shown = this.tracker.source === "melody" ? markPosition : out.position;
    const place = this.coast.update({ time: frame.time, reliable: reliable && !out.held, held: out.held, singing, position: shown, bpm: out.bpm });
    // Voor het zangbegin (voorspel) en tijdens een tussenspel staat de tekst klaar zonder markering.
    const cursor = singing ? this.updateCursor(stanza, place.position ?? shown, place.position === null ? reliable && !out.held : place.source === "measured" || place.source === "catching-up" || (place.source === "estimated" && !out.held), (place.source === "estimated" || place.source === "catching-up") && !out.held) : null;
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
    this.gate.reset();
    this.status = "idle";
    this.statusSince = this.lastTime;
    this.quality = 0;
    this.concEma = 0;
    this.confidence = 0;
    this.lapUncertain = false;
    this.lastOut = null;
    this.cursor.reset();
    this.coast.reset();
    this.refreshSnapshot();
  }

  private updateCursor(stanza: number, position: number, reliable: boolean, estimated: boolean): DisplayCursor {
    return this.cursor.update(this.hymn.text, this.reference.sections, stanza, position, reliable, estimated);
  }

  private refreshSnapshot(): void {
    const place = this.coast.value;
    const cursor = this.phaseLayer.isSinging
      ? this.updateCursor(this.stanzas.current, place.position ?? this.lastSnapshot.position, this.lastSnapshot.status === "locked" || this.lastSnapshot.status === "recovered", false)
      : null;
    this.lastSnapshot = this.snapshot(this.lastTime, cursor);
  }

  private applyPhaseEvents(events: PhaseEvent[]): void {
    for (const e of events) {
      this.events.push({ time: e.time, type: "phase", phaseEvent: e.type, reason: e.type === "start" ? `${e.reason}: ${e.evidence.join("; ")}` : undefined });
      if (e.type === "start") {
        this.lapUncertain = false;
        this.cursor.reset();
        this.coast.reset();
      } else if (e.type === "lap") {
        this.lapUncertain = false;
        this.events.push({ time: e.time, type: "lap", lap: e.lap });
        this.coast.noteLap(this.lastOut ? this.lastOut.position : 0);
        const change = this.stanzas.onNewLap(e.lap);
        if (change) this.events.push({ time: e.time, type: "stanza", stanza: change.stanza, reason: change.reason });
        this.cursor.permitJump();
      } else if (e.type === "resume") {
        this.cursor.permitJump();
      } else if (e.type === "back-to-prelude") {
        this.cursor.reset();
        this.coast.reset();
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
    // Bij de melodiereferentie zit het bewijs per frame lager (de zang is de enige bron, bij een koor zijn de stemmen verspreid), maar een
    // ONJUISTE lofzang kan met toonhoogteklassen bijna even goed passen. Daarom is de ondergrens voor de kwaliteit lager en de eis aan de
    // concentratie van de positie juist strenger: alleen als de positie echt op één plek samenkomt telt het als vertrouwen.
    const melody = this.tracker.source === "melody";
    const cfg = this.config;
    // Eén heldere stem (veel frames met een betrouwbare toonhoogte) verklaart de juiste melodie sterk; een onjuiste lofzang haalt dan
    // maar een deel van dat bewijs. Bij een koor (toonhoogte vaak onbetrouwbaar) is het bewijs per frame juist laag, ook bij de juiste.
    const clean = melody ? clamp01(((this.tracker.voice?.voicedShare ?? 0) - cfg.melodyCleanFrom) / (cfg.melodyCleanTo - cfg.melodyCleanFrom)) : 0;
    const qFloor = cfg.melodyQualityFloor + clean * (cfg.melodyCleanQualityFloor - cfg.melodyQualityFloor);
    const qScale = cfg.melodyQualityScale + clean * (cfg.melodyCleanQualityScale - cfg.melodyQualityScale);
    const q = melody ? clamp01((this.quality - qFloor) / qScale) : clamp01((this.quality - 0.03) / 0.12);
    const c = melody ? clamp01((this.concEma - cfg.melodyConcFloor) / cfg.melodyConcScale) : clamp01((this.concEma - 0.5) / 0.35);
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

  /**
   * Hoe lang het vertrouwen boven de vergrendelgrens zit. Bij zang volgens alleen de melodie (koor, meerdere stemmen met kleine
   * tijds- en toonverschillen) schommelt het vertrouwen per frame sterk terwijl de positie wel klopt; elke dip zou de teller dan
   * op nul zetten en de markering tientallen seconden vasthouden. Daar loopt de teller bij een dip maar half terug: wie meer dan
   * een derde van de tijd boven de grens zit, vergrendelt. Bij instrumenten blijft het gedrag ongewijzigd (volledig terug naar 0).
   */
  private lockProgress(conf: number, dt: number): number {
    if (conf >= this.config.lockConfidence) return this.aboveLock + dt;
    return this.tracker.source === "melody" ? Math.max(0, this.aboveLock - dt * this.config.melodyLockDecay) : 0;
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
        this.aboveLock = this.lockProgress(conf, dt);
        if (this.aboveLock >= cfg.lockSeconds) this.setStatus(time, "locked");
        break;
      case "locked":
        this.belowUncertain = conf < cfg.uncertainConfidence ? this.belowUncertain + dt : 0;
        if (this.belowUncertain >= cfg.uncertainSeconds) this.setStatus(time, "uncertain");
        break;
      case "uncertain":
        this.aboveLock = this.lockProgress(conf, dt);
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
      displayPosition: this.phaseLayer.isSinging ? this.coast.value.position : null,
      positionSource: this.phaseLayer.isSinging ? this.coast.value.source : "none",
      estimatedSeconds: this.coast.value.estimatedSeconds,
      trackSource: this.tracker.source,
    };
  }

  get sectionNow() {
    return sectionAt(this.reference.sections, this.lastSnapshot.position);
  }

  /** Alles weer op nul (nieuwe sessie met dezelfde lofzang), zonder het gekozen couplet te verliezen. */
  restart(): void {
    this.tracker.reset(this.config.tracker.start ?? "uniform");
    this.gate.reset();
    this.extractor?.reset();
    this.phaseLayer = new SingingPhase(this.reference.cycleBeats, this.config.phase);
    this.cursor.reset();
    this.coast.reset();
    this.status = "idle";
    this.statusSince = 0;
    this.quality = 0;
    this.concEma = 0;
    this.confidence = 0;
    this.lapUncertain = false;
    this.lastTime = 0;
    this.silentSince = null;
    this.lastOut = null;
    this.wasConfident = false;
    this.lowSince = null;
  }
}

/** Eén band (octaafonafhankelijk) voor de melodiereferentie; de frames worden daarvoor samengevouwen (follow/transpose.ts). */
const FOLDED_LAYOUT: FeatureLayout = { splitsHz: [], power: 0.5 };

const IDLE_CURSOR: DisplayCursor = { section: "verse", line: -1, word: null, frozen: false, estimated: false };

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Een compositie met alleen de gecontroleerde melodie (dezelfde beat-as) voor de melodiereferentie. */
function asMelodyComposition(hymn: ResolvedHymn, melody: [number, number, number][]) {
  const result: MelodyResult = { compositionId: hymn.composition.id, status: "ok", reasons: [], notes: melody, topAgreement: 1, syllableAnchors: null, coverage: 1 };
  return melodyComposition(hymn.composition, result)!;
}
