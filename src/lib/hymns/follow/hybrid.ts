import type { FeatureFrame } from "../audio/features";
import type { Reference } from "../score/reference";
import { ScoreTracker, type TrackerConfig, type TrackerOutput } from "./tracker";
import { KeyEstimator, foldFrame } from "./transpose";

// Hybride muzikale positievolger: twee score-followers naast elkaar op dezelfde kenmerkframes, met dezelfde positie-as (beats).
//
//  - "full":   de volledige meerstemmige partituur (orgel, piano, gemeente met begeleiding);
//  - "melody": alleen de gecontroleerde zangmelodie (solist, a capella, groep die de melodie zingt).
//
// Een solist die alleen de melodie zingt klinkt niet als de volledige partituur: gemeten volgt de volledige referentie solozang bijna
// niet (binnen 1 beat in ~7% van de tijd) en de melodiereferentie wel (~100%). Omgekeerd volgt de melodiereferentie vierstemmige
// zang of een orgel slecht. Daarom draaien beide en bepaalt het bewijs welke de klank beter verklaart:
// per tracker een voortschrijdend gemiddelde van log(kans onder het model / kans onder het nulmodel), met hysterese zodat de
// bron niet heen en weer flipt. De gekozen output wordt doorgegeven; de positie wordt nooit gemengd tussen de twee.
// Zonder betrouwbare melodie bestaat alleen "full" (en kost dit niets extra).

// Een melodielijn is "dunner" bewijs dan een meerstemmige partituur: met 600 deeltjes hing het slagen bij langzaam zingen (55/min) van de
// willekeurige zaadwaarde af (meting in docs/hymns/v3); met 1200 slaagt elke geteste zaadwaarde.
const MELODY_PARTICLES = 1200;

export type TrackSource = "full" | "melody";

export interface HybridConfig {
  /** Tijdconstante (s) van het bewijsgemiddelde. */
  emaSeconds: number;
  /** Zo veel (nats per frame) moet de andere tracker beter zijn voor een wissel, en zo lang (s) achtereen. */
  switchMargin: number;
  switchSeconds: number;
  /** Lichte voorkeur voor melodie bij stabiele grondtonen (zang), voor de volledige partituur zonder grondtonen. */
  pitchPrior: number;
}

export const DEFAULT_HYBRID_CONFIG: HybridConfig = { emaSeconds: 3, switchMargin: 0.03, switchSeconds: 1.5, pitchPrior: 0.02 };

export class HybridScoreTracker {
  private readonly full: ScoreTracker;
  private readonly melody: ScoreTracker | null;
  private readonly cfg: HybridConfig;
  private active: TrackSource = "full";
  private emaFull = 0;
  private emaMelody = 0;
  private voiced = 0.5;
  private concMelody = 0;
  private better: TrackSource | null = null;
  private betterSince = 0;
  private lastTime: number | null = null;
  private heardTime = 0;

  private readonly key: KeyEstimator | null;

  /** `melody`: de melodiereferentie (één band, zie FOLDED_LAYOUT) en de noten waaruit ze is gebouwd (voor de toonsoortschatting). */
  constructor(fullRef: Reference, melody: { ref: Reference; notes: readonly (readonly [number, number, number])[] } | null, trackerConfig: Partial<TrackerConfig> = {}, config: Partial<HybridConfig> = {}) {
    this.cfg = { ...DEFAULT_HYBRID_CONFIG, ...config };
    this.full = new ScoreTracker(fullRef, trackerConfig);
    // Zang begint meestal bij het begin van het lied (geen voorspel); de helft van de deeltjes start daar, de rest overal (herstel).
    this.key = melody ? new KeyEstimator(melody.notes, fullRef.cycleBeats) : null;
    this.melody = melody ? new ScoreTracker(melody.ref, { ...trackerConfig, start: "mixed", particles: MELODY_PARTICLES, continuityRatio: 0.6, seed: (trackerConfig.seed ?? 1) + 101 }) : null;
  }

  get source(): TrackSource {
    return this.active;
  }

  /** Alleen bij een melodiereferentie is er een keuze. */
  /** Geschatte transpositie (halve tonen te hoog) en stemming (halve tonen) van de zang t.o.v. de partituur; 0 zonder melodie. */
  get transposition(): { shift: number; tuning: number } {
    return { shift: this.key?.shift ?? 0, tuning: this.key?.tuning ?? 0 };
  }

  get hasMelody(): boolean {
    return this.melody !== null;
  }

  /** Zangbewijs voor de fase-laag: levert de melodiereferentie de positie, en hoeveel van de recente frames had een stabiele grondtoon? */
  get voice(): { melodySource: boolean; voicedShare: number } | undefined {
    return this.melody ? { melodySource: this.active === "melody", voicedShare: this.voiced } : undefined;
  }

  update(frame: FeatureFrame): TrackerOutput {
    const a = this.full.update(frame);
    if (!this.melody) return a;
    this.key!.push(frame);
    // De melodievolger ziet octaaf-onafhankelijke, teruggeschoven toonklassen (zingen in een andere toonsoort of octaaf).
    const b = this.melody.update(foldFrame(frame, this.key!.shift, this.key!.tuning));
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(1, frame.time - this.lastTime));
    this.lastTime = frame.time;
    if (!frame.silent && !a.held) {
      // Eerst een gewoon gemiddelde (sneller bij het begin van een sessie), daarna het voortschrijdende gemiddelde.
      this.heardTime += dt;
      const k = Math.max(1 - Math.exp(-dt / this.cfg.emaSeconds), Math.min(1, dt / Math.max(this.heardTime, 0.2)));
      this.emaFull += k * (a.logEvidence - a.logNull - this.emaFull);
      this.emaMelody += k * (b.logEvidence - b.logNull - this.emaMelody);
      const v = frame.pitch && frame.pitch.hz > 0 ? 1 : 0;
      this.voiced += k * (v - this.voiced);
      this.concMelody += (1 - Math.exp(-dt / 1)) * (b.concentration - this.concMelody);
    }
    // voorkeur uit de grondtonen: veel gestemde frames = zang
    const prior = this.cfg.pitchPrior * (this.voiced > 0.6 ? 1 : this.voiced < 0.2 ? -1 : 0);
    const diff = this.emaMelody - this.emaFull + prior;
    // Stabiele grondtonen en een melodievolger die zijn positie duidelijk vasthoudt: dat is zang, ook als de volledige partituur
    // (bij een andere octaaf bijvoorbeeld) net zo goed lijkt te passen. Dan telt een kleine achterstand in bewijs niet.
    const voiceLike = this.voiced > 0.7 && this.concMelody > 0.75 && diff > -0.03;
    const want: TrackSource | null = voiceLike || diff > this.cfg.switchMargin ? "melody" : diff < -this.cfg.switchMargin ? "full" : null;
    const fast = want === "melody" && this.voiced > 0.7;
    if (want && want !== this.active) {
      if (this.better !== want) {
        this.better = want;
        this.betterSince = frame.time;
      } else if (frame.time - this.betterSince >= (fast ? this.cfg.switchSeconds * 0.4 : this.cfg.switchSeconds)) {
        this.active = want;
        this.better = null;
      }
    } else this.better = null;
    return this.active === "melody" ? b : a;
  }

  reset(start: TrackerConfig["start"]): void {
    this.full.reset(start);
    this.melody?.reset("mixed");
    this.key?.reset();
    this.emaFull = this.emaMelody = 0;
    this.voiced = 0.5;
    this.concMelody = 0;
    this.better = null;
    this.lastTime = null;
    this.heardTime = 0;
  }
}
