import type { FeatureFrame } from "../audio/features";
import { buildReference, type Reference } from "../score/reference";
import { ScoreTracker, type TrackerConfig } from "../follow/tracker";
import type { HymnComposition } from "../types";

// "Herken lofzang": dezelfde score-follower, maar dan parallel voor elke kandidaat-lofzang, zonder dat de
// gebruiker eerst een nummer kiest. Er is bewust GEEN opname-fingerprint (die zou vastzitten aan één tempo
// en één uitvoering): elke kandidaat probeert de gehoorde klank te volgen met zijn eigen partituur, en
// het bewijs is hoeveel beter dat lukt dan met een nulmodel zonder muzikale continuïteit.
//
// Het bewijs per kandidaat is de som (met langzaam vergeten) van log(kans onder kandidaat / kans onder
// nulmodel), per frame. Pas bij genoeg bewijs en een duidelijke voorsprong op de tweede wordt een lofzang
// voorgesteld; twee kandidaten met vrijwel gelijk bewijs (dezelfde melodie) heten "ambigu"; en zonder
// voldoende bewijs na een redelijke luistertijd is het "onbekend". Er is geen pad waarop altijd één van
// de kandidaten wordt gekozen.

export interface RecognitionCandidate {
  id: string;
  number: number;
  title: string;
  composition: HymnComposition;
}

export type RecognitionStatus = "listening" | "candidates" | "identified" | "ambiguous" | "unknown";

export interface CandidateScore {
  id: string;
  number: number;
  title: string;
  /** Opgetelde bewijs in nats (0 = net zo goed als geen kennis). */
  evidence: number;
  /** Kans uit het bewijs, voorzichtig gedempt (de frames zijn onderling sterk gecorreleerd). Alleen ter indicatie. */
  probability: number;
  /** Waar in de partituur deze kandidaat de muziek nu denkt te horen (beats in de cyclus). */
  position: number;
}

export interface RecognitionState {
  status: RecognitionStatus;
  /** Seconden muziek (geen stilte) waarop de uitspraak is gebaseerd. */
  heardSeconds: number;
  ranking: CandidateScore[];
  /** Alleen gevuld bij "identified": de voorgestelde lofzang. */
  suggestion: CandidateScore | null;
}

export interface RecognizerConfig {
  tracker: Partial<TrackerConfig>;
  /** Halfwaardetijd van het bewijs (s): oud bewijs telt minder, zodat een nieuwe lofzang herkend kan worden. */
  halfLifeSeconds: number;
  /** Minimaal bewijs (nats) voor een voorstel. */
  minEvidence: number;
  /** Minimale voorsprong (nats) op de tweede kandidaat. */
  minMargin: number;
  /** Dempingsfactor voor de kansberekening. */
  temperature: number;
  /** Minimale muziektijd voor een uitspraak. */
  minHeardSeconds: number;
  /** Na zo lange muziektijd zonder bewijs: "onbekend". */
  unknownAfterSeconds: number;
}

export const DEFAULT_RECOGNIZER_CONFIG: RecognizerConfig = {
  // Geen "rescue"-deeltjes: die laten een kandidaat losse stukken muziek aan elkaar rijgen, waardoor ook een
  // verkeerde lofzang bewijs verzamelt (gemeten: zie docs/hymns/04-RECOGNITION-POC.md).
  tracker: { start: "uniform", particles: 500, rescueFraction: 0, rateSigma: 0.08 },
  halfLifeSeconds: 40,
  minEvidence: 70,
  minMargin: 20,
  temperature: 0.1,
  minHeardSeconds: 6,
  unknownAfterSeconds: 25,
};

interface Entry {
  candidate: RecognitionCandidate;
  reference: Reference;
  tracker: ScoreTracker;
  evidence: number;
  position: number;
}

export class HymnRecognizer {
  readonly config: RecognizerConfig;
  private readonly entries: Entry[];
  private heard = 0;
  private lastTime: number | null = null;

  constructor(candidates: RecognitionCandidate[], config: Partial<RecognizerConfig> = {}) {
    this.config = { ...DEFAULT_RECOGNIZER_CONFIG, ...config, tracker: { ...DEFAULT_RECOGNIZER_CONFIG.tracker, ...config.tracker } };
    this.entries = candidates.map((candidate, i) => {
      const reference = buildReference(candidate.composition);
      return { candidate, reference, tracker: new ScoreTracker(reference, { ...this.config.tracker, seed: 11 + i }), evidence: 0, position: 0 };
    });
  }

  update(frame: FeatureFrame): RecognitionState {
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(1, frame.time - this.lastTime));
    this.lastTime = frame.time;
    const decay = Math.exp((-Math.LN2 * dt) / this.config.halfLifeSeconds);
    for (const e of this.entries) {
      const out = e.tracker.update(frame);
      if (frame.silent) continue; // stilte zegt niets over welke lofzang het is
      e.evidence = e.evidence * decay + (out.logEvidence - out.logNull);
      e.position = out.position;
    }
    if (!frame.silent) this.heard += dt;
    return this.state();
  }

  state(): RecognitionState {
    const cfg = this.config;
    const maxE = Math.max(0, ...this.entries.map((e) => e.evidence));
    let z = 0;
    const weights = this.entries.map((e) => {
      const w = Math.exp(cfg.temperature * (e.evidence - maxE));
      z += w;
      return w;
    });
    // het nulmodel ("geen van deze") doet altijd mee met bewijs 0
    z += Math.exp(cfg.temperature * (0 - maxE));
    const ranking: CandidateScore[] = this.entries
      .map((e, i) => ({
        id: e.candidate.id,
        number: e.candidate.number,
        title: e.candidate.title,
        evidence: e.evidence,
        probability: weights[i] / z,
        position: e.position,
      }))
      .sort((a, b) => b.evidence - a.evidence);

    let status: RecognitionStatus = "listening";
    let suggestion: CandidateScore | null = null;
    if (this.heard >= cfg.minHeardSeconds) {
      const top = ranking[0];
      const second = ranking[1];
      const margin = top && second ? top.evidence - second.evidence : top?.evidence ?? 0;
      if (top && top.evidence >= cfg.minEvidence) {
        if (!second || margin >= cfg.minMargin) {
          status = "identified";
          suggestion = top;
        } else {
          status = "ambiguous";
        }
      } else if (this.heard >= cfg.unknownAfterSeconds) {
        status = "unknown";
      } else if (top && top.evidence > cfg.minEvidence * 0.3) {
        status = "candidates";
      }
    }
    return { status, heardSeconds: this.heard, ranking, suggestion };
  }

  reset(): void {
    this.heard = 0;
    this.lastTime = null;
    for (const e of this.entries) {
      e.tracker.reset("uniform");
      e.evidence = 0;
      e.position = 0;
    }
  }
}
