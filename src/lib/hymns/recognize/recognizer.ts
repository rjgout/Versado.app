import type { FeatureFrame } from "../audio/features";
import { buildReference, type Reference } from "../score/reference";
import { ScoreTracker, type TrackerConfig } from "../follow/tracker";
import type { HymnComposition } from "../types";
import { CandidatePrefilter, type PrefilterRanking } from "./prefilter";

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
  /** Andere lofzangen met precies dezelfde melodie (zelfde compositie, andere tekst/nummer): de gebruiker kiest dan de tekst. */
  sharedWith?: { number: number; title: string }[];
  /**
   * Wat deze compositie gemiddeld (en hoe wisselend) aan bewijs haalt op ANDERE muziek, op vaste luistermomenten
   * (scripts/hymns/calibrate-evidence.ts). Zonder dit geldt een vaste, voorzichtige aanname.
   */
  calibration?: EvidenceCalibration;
}

export interface EvidenceCalibration {
  t: number[];
  mean: number[];
  std: number[];
}

const DEFAULT_CALIBRATION: EvidenceCalibration = { t: [10, 60], mean: [8, 12], std: [10, 12] };

/** Bewijs als aantal standaardafwijkingen boven wat deze compositie op willekeurige andere muziek haalt. */
export function evidenceZ(evidence: number, heardSeconds: number, cal: EvidenceCalibration = DEFAULT_CALIBRATION): number {
  const { t, mean, std } = cal;
  let i = 0;
  while (i < t.length - 1 && heardSeconds > t[i + 1]) i += 1;
  const j = Math.min(t.length - 1, i + 1);
  const f = j === i ? 0 : Math.min(1, Math.max(0, (heardSeconds - t[i]) / (t[j] - t[i])));
  const m = mean[i] + (mean[j] - mean[i]) * f;
  const sd = Math.max(6, std[i] + (std[j] - std[i]) * f);
  return (evidence - m) / sd;
}

export type RecognitionStatus = "listening" | "candidates" | "identified" | "ambiguous" | "unknown";

export interface CandidateScore {
  id: string;
  number: number;
  title: string;
  /** Opgetelde bewijs in nats (0 = net zo goed als geen kennis). */
  evidence: number;
  /** Bewijs ten opzichte van wat deze lofzang op willekeurige andere muziek haalt (standaardafwijkingen). */
  z: number;
  /** Kans uit het bewijs, voorzichtig gedempt (de frames zijn onderling sterk gecorreleerd). Alleen ter indicatie. */
  probability: number;
  /** Waar in de partituur deze kandidaat de muziek nu denkt te horen (beats in de cyclus). */
  position: number;
  /** Andere lofzangen met dezelfde melodie; leeg als de melodie bij één lofzang hoort. */
  sharedWith: { number: number; title: string }[];
}

export interface RecognitionState {
  status: RecognitionStatus;
  /** Seconden muziek (geen stilte) waarop de uitspraak is gebaseerd. */
  heardSeconds: number;
  ranking: CandidateScore[];
  /** Alleen gevuld bij "identified": de voorgestelde lofzang. */
  suggestion: CandidateScore | null;
  /** Diagnose (grote bibliotheek): de kop van het voorfilter, hoe lang al, en de voorsprong op de tweede (kosten-eenheden). */
  lead: { id: string; streak: number; margin: number } | null;
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
  /**
   * Bij meer kandidaten dan dit kiest een goedkoop voorfilter (prefilter.ts) de beste `activeLimit`; alleen die worden met de
   * volledige score-follower gevolgd. Bij minder of evenveel kandidaten draait alles altijd (geen voorfilter).
   */
  activeLimit: number;
  /** Hoe vaak (s) het voorfilter de kandidatenlijst herziet. */
  prefilterEverySeconds: number;
  /** Zo lang (s) blijven recente kenmerkframes bewaard om een nieuwe kandidaat in te halen. */
  replaySeconds: number;
  /** Maximaal aantal frames dat per aanroep wordt ingehaald (verdeelt de rekenlast). */
  replayPerCall: number;
  /** Een kandidaat die zo lang (s) buiten het voorfilter-lijstje valt (en niet bij de beste drie is) stopt. */
  dropAfterSeconds: number;
  /**
   * Alleen bij een voorfilter (grote bibliotheek). Het voorfilter is op de officiële opnamen betrouwbaarder gebleken dan de
   * som van tracker-bewijs, dat bij 150+ kandidaten vaste "aantrekkers" (harmonisch algemene lofzangen) kent. Daarom bepaalt
   * de kop van het voorfilter wie het is, mits die `leaderStreak` rondes achter elkaar eerste staat met `leaderMargin` voorsprong
   * op de tweede, en de score-follower van die kandidaat de muziek aantoonbaar kan volgen (`verifyEvidence`).
   */
  leaderStreak: number;
  leaderMargin: number;
  verifyZ: number;
  /** De toegestane achterstand van de kop op de beste rivaal in tracker-bewijs (z), en de voorfilter-voorsprong die tegenspraak opweegt. */
  rivalSlackZ: number;
  strongMargin: number;
  /** Tweede weg: een kandidaat met z vanaf `trackerZ` en `trackerGapZ` boven de rest, die ook bovenaan het voorfilter staat. */
  trackerZ: number;
  trackerGapZ: number;
  /** Ook dan moet de voorfilter-kop even stabiel zijn (rondes) en een kleine voorsprong hebben: een kop die net wisselde is geen getuige. */
  trackerStreak: number;
  trackerMargin: number;
}

export const DEFAULT_RECOGNIZER_CONFIG: RecognizerConfig = {
  // Geen "rescue"-deeltjes: die laten een kandidaat losse stukken muziek aan elkaar rijgen, waardoor ook een
  // verkeerde lofzang bewijs verzamelt (gemeten: zie docs/hymns/04-RECOGNITION-POC.md).
  tracker: { start: "uniform", particles: 500, rescueFraction: 0, rateSigma: 0.08 },
  halfLifeSeconds: 40,
  minEvidence: 70,
  minMargin: 20,
  temperature: 0.1,
  minHeardSeconds: 8,
  unknownAfterSeconds: 25,
  activeLimit: 6,
  prefilterEverySeconds: 1,
  replaySeconds: 15,
  replayPerCall: 60,
  dropAfterSeconds: 8,
  leaderStreak: 5,
  leaderMargin: 0.04,
  verifyZ: 1.5,
  rivalSlackZ: 1,
  strongMargin: 0.1,
  trackerZ: 6,
  trackerGapZ: 3,
  trackerStreak: 3,
  trackerMargin: 0.02,
};

interface Entry {
  candidate: RecognitionCandidate;
  index: number;
  reference: Reference;
  tracker: ScoreTracker;
  evidence: number;
  position: number;
  lastTime: number | null;
  /** Frames die nog verwerkt moeten worden (bij het inhalen na activering meer dan één). */
  queue: FeatureFrame[];
  queueAt: number;
  outOfTopSince: number | null;
}

export class HymnRecognizer {
  readonly config: RecognizerConfig;
  private readonly candidates: RecognitionCandidate[];
  private readonly active = new Map<string, Entry>();
  private readonly prefilter: CandidatePrefilter | null;
  private readonly ring: FeatureFrame[] = [];
  private heard = 0;
  private lastTime: number | null = null;
  /** Kop van het voorfilter: wie de laatste rondes eerst stond en hoe lang al, met de voorsprong op de tweede. */
  private leader: { id: string; streak: number; margin: number; since: number } | null = null;
  private prefilterRank = new Map<string, number>();

  constructor(candidates: RecognitionCandidate[], config: Partial<RecognizerConfig> = {}) {
    this.config = { ...DEFAULT_RECOGNIZER_CONFIG, ...config, tracker: { ...DEFAULT_RECOGNIZER_CONFIG.tracker, ...config.tracker } };
    this.candidates = candidates;
    this.prefilter = candidates.length > this.config.activeLimit ? new CandidatePrefilter(candidates, { everySeconds: this.config.prefilterEverySeconds }) : null;
    if (!this.prefilter) candidates.forEach((_, i) => this.activate(i, []));
  }

  /** Aantal kandidaten waarvoor nu de volledige score-follower draait (diagnose). */
  get activeCount(): number {
    return this.active.size;
  }

  private activate(index: number, backlog: FeatureFrame[]): void {
    const candidate = this.candidates[index];
    if (this.active.has(candidate.id)) return;
    const reference = buildReference(candidate.composition);
    this.active.set(candidate.id, {
      candidate,
      index,
      reference,
      tracker: new ScoreTracker(reference, { ...this.config.tracker, seed: 11 + index }),
      evidence: 0,
      position: 0,
      lastTime: null,
      queue: [...backlog],
      queueAt: 0,
      outOfTopSince: null,
    });
  }

  private step(e: Entry, frame: FeatureFrame): void {
    const dt = e.lastTime === null ? 0 : Math.max(0, Math.min(1, frame.time - e.lastTime));
    e.lastTime = frame.time;
    const decay = Math.exp((-Math.LN2 * dt) / this.config.halfLifeSeconds);
    const out = e.tracker.update(frame);
    if (frame.silent) return; // stilte zegt niets over welke lofzang het is
    e.evidence = e.evidence * decay + (out.logEvidence - out.logNull);
    e.position = out.position;
  }

  private warming(e: Entry): boolean {
    return e.queue.length - e.queueAt > 1;
  }

  update(frame: FeatureFrame): RecognitionState {
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(1, frame.time - this.lastTime));
    this.lastTime = frame.time;
    if (!frame.silent) this.heard += dt;

    if (this.prefilter) {
      this.ring.push(frame);
      while (this.ring.length > 1 && frame.time - this.ring[0].time > this.config.replaySeconds) this.ring.shift();
      const ranking = this.prefilter.push(frame);
      if (ranking) this.revise(frame.time, ranking);
      // een zojuist geactiveerde kandidaat kreeg de ring (met dit frame al erin) als achterstand
      for (const e of this.active.values()) if (e.queueAt >= e.queue.length || e.queue[e.queue.length - 1] !== frame) e.queue.push(frame);
    } else {
      for (const e of this.active.values()) e.queue.push(frame);
    }

    // verwerk de wachtrijen binnen het frame-budget; achterstanden worden over meerdere aanroepen ingehaald
    let budget = this.config.replayPerCall;
    for (const e of this.active.values()) {
      while (e.queueAt < e.queue.length && (e.queue.length - e.queueAt === 1 || budget > 0)) {
        this.step(e, e.queue[e.queueAt]);
        e.queueAt += 1;
        budget -= 1;
      }
      if (e.queueAt >= e.queue.length) {
        e.queue = [];
        e.queueAt = 0;
      }
    }
    return this.state();
  }

  private revise(now: number, result: PrefilterRanking): void {
    const top = result.ranking[0];
    const second = result.ranking[1];
    const margin = top && second ? second.cost - top.cost : 0;
    if (top) {
      if (this.leader && this.leader.id === top.id) {
        this.leader.streak += 1;
        this.leader.margin = margin;
      } else this.leader = { id: top.id, streak: 1, margin, since: now };
    }
    this.prefilterRank = new Map(result.ranking.slice(0, 5).map((r, i) => [r.id, i + 1]));
    const wanted = new Set(result.ranking.slice(0, this.config.activeLimit).map((r) => r.id));
    for (const id of wanted) {
      if (this.active.has(id)) continue;
      const index = this.candidates.findIndex((c) => c.id === id);
      // het huidige frame zit al in de ring; de achterstand loopt dus tot en met nu
      this.activate(index, this.ring);
    }
    // wie niet meer in het lijstje staat, stopt na een tijdje; de beste drie op bewijs blijven altijd, en er is een harde bovengrens
    const byEvidence = [...this.active.values()].sort((a, b) => b.evidence - a.evidence);
    const keep = new Set(byEvidence.slice(0, 3).map((e) => e.candidate.id));
    for (const e of [...this.active.values()]) {
      if (wanted.has(e.candidate.id)) e.outOfTopSince = null;
      else {
        e.outOfTopSince ??= now;
        if (now - e.outOfTopSince > this.config.dropAfterSeconds && !keep.has(e.candidate.id)) this.active.delete(e.candidate.id);
      }
    }
    const cap = this.config.activeLimit + 3;
    if (this.active.size > cap) {
      const drop = [...this.active.values()]
        .filter((e) => !keep.has(e.candidate.id) && !wanted.has(e.candidate.id))
        .sort((a, b) => a.evidence - b.evidence);
      for (const e of drop) {
        if (this.active.size <= cap) break;
        this.active.delete(e.candidate.id);
      }
    }
  }

  state(): RecognitionState {
    const cfg = this.config;
    const entries = [...this.active.values()].filter((e) => !this.warming(e));
    const maxE = Math.max(0, ...entries.map((e) => e.evidence));
    let z = 0;
    const weights = entries.map((e) => {
      const w = Math.exp(cfg.temperature * (e.evidence - maxE));
      z += w;
      return w;
    });
    // het nulmodel ("geen van deze") doet altijd mee met bewijs 0
    z += Math.exp(cfg.temperature * (0 - maxE));
    const ranking: CandidateScore[] = entries
      .map((e, i) => ({
        id: e.candidate.id,
        number: e.candidate.number,
        title: e.candidate.title,
        evidence: e.evidence,
        probability: weights[i] / z,
        z: evidenceZ(e.evidence, this.heard, e.candidate.calibration),
        position: e.position,
        sharedWith: e.candidate.sharedWith ?? [],
      }))
      .sort((a, b) => b.evidence - a.evidence);

    let status: RecognitionStatus = "listening";
    let suggestion: CandidateScore | null = null;
    if (this.heard >= cfg.minHeardSeconds) {
      if (this.prefilter) {
        // Grote bibliotheek: de kop van het voorfilter beslist, de score-follower verifieert.
        const lead = this.leader;
        const leadScore = lead ? ranking.find((r) => r.id === lead.id) : undefined;
        const stable = lead !== null && lead.streak >= cfg.leaderStreak;
        // Het voorfilter en de score-follower zijn twee onafhankelijke getuigen. Spreken ze elkaar tegen (een andere kandidaat heeft
        // veel meer tracker-bewijs), dan telt het voorfilter alleen bij een duidelijk grotere voorsprong of genoeg eigen bewijs.
        const rival = Math.max(-99, ...ranking.filter((r) => r.id !== lead?.id).map((r) => r.z));
        const ev = leadScore?.z ?? -99;
        const supported = ev >= rival - cfg.rivalSlackZ || (lead?.margin ?? 0) >= cfg.strongMargin;
        // Tweede weg: de score-follower is zelf duidelijk (hoog z, ver boven de rest) én het voorfilter heeft die kandidaat bovenaan.
        const byZ = [...ranking].sort((a, b) => b.z - a.z);
        const zTop = byZ[0];
        const zNext = byZ[1];
        const trackerLed =
          zTop !== undefined &&
          zTop.z >= cfg.trackerZ &&
          (!zNext || zTop.z - zNext.z >= cfg.trackerGapZ) &&
          lead?.id === zTop.id &&
          lead.streak >= cfg.trackerStreak &&
          lead.margin >= cfg.trackerMargin;
        if (trackerLed) {
          status = "identified";
          suggestion = zTop;
        } else if (lead && stable && leadScore && lead.margin >= cfg.leaderMargin && ev >= cfg.verifyZ && supported) {
          status = "identified";
          suggestion = leadScore;
        } else if (lead && stable && lead.margin < cfg.leaderMargin) status = "ambiguous";
        else if (this.heard >= cfg.unknownAfterSeconds && !(leadScore && leadScore.z > cfg.verifyZ * 0.5)) status = "unknown";
        else if (leadScore && leadScore.z > cfg.verifyZ * 0.5) status = "candidates";
      } else {
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
    }
    return { status, heardSeconds: this.heard, ranking, suggestion, lead: this.leader ? { id: this.leader.id, streak: this.leader.streak, margin: this.leader.margin } : null };
  }

  reset(): void {
    this.heard = 0;
    this.lastTime = null;
    this.ring.length = 0;
    this.leader = null;
    this.prefilterRank = new Map();
    this.prefilter?.reset();
    if (this.prefilter) this.active.clear();
    for (const e of this.active.values()) {
      e.tracker.reset("uniform");
      e.evidence = 0;
      e.position = 0;
      e.lastTime = null;
      e.queue = [];
      e.queueAt = 0;
    }
  }
}
