import type { FeatureFrame } from "../audio/features";
import type { Reference } from "../score/reference";
import { stepIndex } from "../score/reference";

// Score-follower: een deeltjesfilter over (positie in de partituur, tempo).
//
// Waarom een deeltjesfilter en geen klassieke online-DTW?
//  - Positie en tempo zijn expliciet, dus een tempoverandering (rubato, ritardando, versnellen) is gewoon
//    een verandering van de toestand en geen bijwerking van het pad.
//  - De posterior geeft vanzelf een betrouwbaarheid (hoeveel gewicht zit er rond één positie?) en laat
//    ambiguïteit tussen herhaalde frases zien in plaats van die te verbergen.
//  - Stilte is een expliciete toestand (houd positie vast), geen gat in een kostenmatrix.
//  - Herstel na verlies is een kleine kans op "springen" (een paar procent verse deeltjes), geen
//    heropbouw van een matrix.
//  - Kost: ~300 deeltjes x 1 opzoeking per frame; geen geheugen dat groeit met de speelduur.
//
// De positie komt nooit uit verstreken seconden: een frame verschuift deeltjes alleen op basis van hun
// eigen tempo, en het gewicht komt uitsluitend van de overeenkomst tussen gehoorde en geschreven
// toonklassen.

export interface TrackerConfig {
  particles: number;
  /** Scherpte van de overeenkomst: groter = strenger. */
  kappa: number;
  /** Kans dat een frame onbruikbaar is (verkeerde noot, zang, plof); begrenst de straf. */
  outlier: number;
  /** Standaardafwijking van de log-tempoverandering per wortel-seconde. */
  rateSigma: number;
  /** Idem binnen een fermate. */
  fermataRateSigma: number;
  /** Positieruis in beats per wortel-(0,05 s). */
  positionSigma: number;
  /** Aandeel nieuwe, willekeurig geplaatste deeltjes per frame (herstel na verlies). */
  rescueFraction: number;
  /** Tempo-grenzen als factor op het nominale tempo. */
  minRateFactor: number;
  maxRateFactor: number;
  /** Spreiding van de beginverdeling van het tempo (log). */
  initialRateSigma: number;
  /** "start": deeltjes rond het begin; "uniform": overal (voor herkenning en herstel); "mixed": de helft elk. */
  start: "start" | "uniform" | "mixed";
  /** "cosine": absolute overeenkomst; "zscore": overeenkomst t.o.v. alle posities van dit frame (past zich aan ruis aan). */
  likelihood: "cosine" | "zscore";
  /** Scherpte van de z-score-kans. */
  zBeta: number;
  /** Frames waarvan de beste z-score lager is dan dit, zeggen niets over de positie en worden overgeslagen. */
  zMin: number;
  /** Gewicht van de onset-term (0 = uit). */
  onsetWeight: number;
  seed: number;
}

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  particles: 600,
  kappa: 16,
  outlier: 0.25,
  rateSigma: 0.14,
  fermataRateSigma: 1.2,
  positionSigma: 0.03,
  rescueFraction: 0.01,
  minRateFactor: 0.45,
  maxRateFactor: 2.2,
  initialRateSigma: 0.25,
  start: "mixed",
  likelihood: "cosine",
  zBeta: 1.5,
  zMin: 2,
  onsetWeight: 0,
  seed: 1,
};

export interface TrackerOutput {
  time: number;
  /** Geschatte positie in beats binnen de cyclus (0..cycleBeats). */
  position: number;
  /** Geschat tempo in kwartnoten per minuut. */
  bpm: number;
  /** Aandeel van het gewicht binnen ±1 beat van de schatting (0..1). */
  concentration: number;
  /** Gemiddelde overeenkomst (cosinus) van de beste deeltjes met de partituur, 0..1. */
  fit: number;
  /** Logaritme van de marginale waarschijnlijkheid van dit frame onder het model. */
  logEvidence: number;
  /** Idem onder het nulmodel "elke positie is even waarschijnlijk" (geen muzikale continuïteit). */
  logNull: number;
  /** z-score van de overeenkomst op de geschatte positie ten opzichte van alle posities (hoger = specifieker). */
  z: number;
  /** Beste z-score van dit frame over alle posities (geeft aan of het frame bruikbaar was). */
  zMax: number;
  /** Frame was stil: positie is vastgehouden. */
  held: boolean;
  /** Effectieve steekproefgrootte als fractie van het aantal deeltjes. */
  ess: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ScoreTracker {
  readonly ref: Reference;
  readonly config: TrackerConfig;
  private readonly pos: Float64Array;
  private readonly rate: Float64Array;
  private w: Float64Array;
  private readonly tmpPos: Float64Array;
  private readonly tmpRate: Float64Array;
  private readonly rand: () => number;
  private lastTime: number | null = null;
  private lastEstimate = 0;
  private framesSeen = 0;
  private sumLogEvidence = 0;
  private readonly simAll: Float32Array;
  private prevFlux = 0;
  private fluxMean = 0.05;

  constructor(ref: Reference, config: Partial<TrackerConfig> = {}) {
    this.ref = ref;
    this.config = { ...DEFAULT_TRACKER_CONFIG, ...config };
    const n = this.config.particles;
    this.pos = new Float64Array(n);
    this.rate = new Float64Array(n);
    this.w = new Float64Array(n).fill(1 / n);
    this.tmpPos = new Float64Array(n);
    this.tmpRate = new Float64Array(n);
    this.simAll = new Float32Array(ref.steps);
    this.rand = mulberry32(this.config.seed);
    this.initParticles();
  }

  private gauss(): number {
    // Box-Muller
    const u = Math.max(this.rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
  }

  private initParticles(): void {
    const { particles: n, start, initialRateSigma } = this.config;
    const nominal = this.ref.nominalBeatsPerSecond;
    for (let i = 0; i < n; i += 1) {
      const uniform = start === "uniform" || (start === "mixed" && i % 2 === 1);
      this.pos[i] = uniform ? this.rand() * this.ref.cycleBeats : this.rand() * Math.min(2, this.ref.cycleBeats);
      this.rate[i] = this.clampRate(nominal * Math.exp(initialRateSigma * this.gauss()));
      this.w[i] = 1 / n;
    }
  }

  private clampRate(r: number): number {
    const nominal = this.ref.nominalBeatsPerSecond;
    return Math.min(nominal * this.config.maxRateFactor, Math.max(nominal * this.config.minRateFactor, r));
  }

  private inFermata(p: number): boolean {
    for (const [a, b] of this.ref.fermataWindows) if (p >= a && p < b) return true;
    return false;
  }

  /** Eén kenmerkframe verwerken. */
  update(frame: FeatureFrame): TrackerOutput {
    const { particles: n, kappa, outlier } = this.config;
    const ref = this.ref;
    const T = ref.cycleBeats;
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(1, frame.time - this.lastTime));
    this.lastTime = frame.time;
    this.framesSeen += 1;

    if (frame.silent) {
      // Pauze: niet verplaatsen en niet beoordelen. Daarna mag de positie iets meer schuiven omdat we niet
      // weten waar de speler hervat; dat gebeurt via de rescue- en positieruis bij het eerstvolgende geluid.
      this.silentRun += 1;
      return this.output(frame.time, true, 0, 0, 1, 0, 0, 0);
    }
    const resumedAfter = this.silentRun * dt;
    this.silentRun = 0;

    // --- voorspellen
    const sqrtDt = Math.sqrt(dt);
    const posSigma = this.config.positionSigma * Math.sqrt(dt / 0.05 || 0) * (resumedAfter > 1 ? 6 : 1);
    for (let i = 0; i < n; i += 1) {
      const fermata = this.inFermata(this.pos[i]);
      const sigma = fermata ? this.config.fermataRateSigma : this.config.rateSigma;
      let r = this.rate[i] * Math.exp(sigma * sqrtDt * this.gauss());
      const minF = fermata ? 0.03 : this.config.minRateFactor;
      const nominal = ref.nominalBeatsPerSecond;
      r = Math.min(nominal * this.config.maxRateFactor, Math.max(nominal * minF, r));
      this.rate[i] = r;
      let p = this.pos[i] + r * dt + posSigma * this.gauss();
      p %= T;
      if (p < 0) p += T;
      this.pos[i] = p;
    }

    // --- beoordelen
    const c = frame.chroma;
    // overeenkomst met elke stap van de partituur (goedkoop: steps x 24 vermenigvuldigingen)
    const sims = this.simAll;
    let sumSim = 0;
    let sumSq = 0;
    for (let st = 0; st < ref.steps; st += 1) {
      const base = st * ref.dim;
      let sim = 0;
      for (let k = 0; k < ref.dim; k += 1) sim += c[k] * ref.chroma[base + k];
      sims[st] = sim;
      sumSim += sim;
      sumSq += sim * sim;
    }
    const meanSim = sumSim / ref.steps;
    const stdSim = Math.sqrt(Math.max(1e-9, sumSq / ref.steps - meanSim * meanSim));
    let maxSim = -1;
    for (let st = 0; st < ref.steps; st += 1) if (sims[st] > maxSim) maxSim = sims[st];
    const zMax = (maxSim - meanSim) / stdSim;
    const useZ = this.config.likelihood === "zscore";
    const informative = !useZ || zMax >= this.config.zMin;
    const beta = this.config.zBeta;
    // nulmodel: gemiddelde kans over alle posities, dus zonder enige kennis van waar we zijn
    let nullSum = 0;
    for (let st = 0; st < ref.steps; st += 1) nullSum += (1 - outlier) * Math.exp(kappa * (sims[st] - 1)) + outlier;
    const logNull = Math.log(nullSum / ref.steps);
    let marginal = 0;
    let fitAcc = 0;
    let zAcc = 0;
    let fitW = 0;
    const onsetOn = this.config.onsetWeight > 0;
    const isOnset = onsetOn && frame.flux > this.fluxMean * 2.2 && frame.flux > this.prevFlux * 1.05;
    for (let i = 0; i < n; i += 1) {
      const sim = sims[stepIndex(ref, this.pos[i])];
      let like: number;
      if (useZ) {
        like = informative ? (1 - outlier) * Math.exp(-beta * (maxSim - sim) / stdSim) + outlier : 1;
      } else {
        like = (1 - outlier) * Math.exp(kappa * (sim - 1)) + outlier;
      }
      if (onsetOn) {
        const near = this.nearOnset(this.pos[i], this.rate[i] * 0.12);
        like *= isOnset ? (near ? 1 + this.config.onsetWeight : 1 / (1 + this.config.onsetWeight)) : 1;
      }
      const wi = this.w[i];
      marginal += wi * like;
      this.w[i] = wi * like;
      fitAcc += wi * sim;
      zAcc += wi * ((sim - meanSim) / stdSim);
      fitW += wi;
    }
    this.prevFlux = frame.flux;
    this.fluxMean = 0.98 * this.fluxMean + 0.02 * frame.flux;
    const logEvidence = Math.log(Math.max(marginal, 1e-300));
    this.sumLogEvidence += logEvidence;
    let total = 0;
    for (let i = 0; i < n; i += 1) total += this.w[i];
    if (total <= 0 || !Number.isFinite(total)) {
      this.w.fill(1 / n);
      total = 1;
    } else {
      for (let i = 0; i < n; i += 1) this.w[i] /= total;
    }

    // --- herbemonsteren (systematisch) als de effectieve steekproef klein wordt
    let sq = 0;
    for (let i = 0; i < n; i += 1) sq += this.w[i] * this.w[i];
    const ess = 1 / sq / n;
    if (ess < 0.5) this.resample();
    return this.output(frame.time, false, logEvidence, fitW > 0 ? fitAcc / fitW : 0, ess, fitW > 0 ? zAcc / fitW : 0, zMax, logNull);
  }

  private silentRun = 0;

  private nearOnset(p: number, tol: number): boolean {
    const on = this.ref.onsets;
    // binair zoeken
    let lo = 0;
    let hi = on.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (on[mid] < p - tol) lo = mid + 1;
      else hi = mid;
    }
    return Math.abs(on[lo] - p) <= tol + 0.1;
  }

  private resample(): void {
    const n = this.config.particles;
    const rescue = Math.round(n * this.config.rescueFraction);
    const keep = n - rescue;
    const cdf = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i += 1) {
      acc += this.w[i];
      cdf[i] = acc;
    }
    const u0 = this.rand() / keep;
    let j = 0;
    for (let i = 0; i < keep; i += 1) {
      const u = u0 + i / keep;
      while (j < n - 1 && cdf[j] < u) j += 1;
      this.tmpPos[i] = this.pos[j];
      this.tmpRate[i] = this.rate[j];
    }
    const nominal = this.ref.nominalBeatsPerSecond;
    for (let i = keep; i < n; i += 1) {
      this.tmpPos[i] = this.rand() * this.ref.cycleBeats;
      this.tmpRate[i] = this.clampRate(nominal * Math.exp(this.config.initialRateSigma * this.gauss()));
    }
    this.pos.set(this.tmpPos);
    this.rate.set(this.tmpRate);
    this.w.fill(1 / n);
  }

  /** Beste schatting uit de huidige deeltjes (modus, niet gemiddelde: een gemiddelde over twee kandidaten klopt nergens). */
  private output(time: number, held: boolean, logEvidence: number, fit: number, ess: number, z: number, zMax: number, logNull: number): TrackerOutput {
    const T = this.ref.cycleBeats;
    const n = this.config.particles;
    const bin = 0.5;
    const bins = Math.max(1, Math.ceil(T / bin));
    const hist = new Float64Array(bins);
    for (let i = 0; i < n; i += 1) hist[Math.min(bins - 1, Math.floor(this.pos[i] / bin))] += this.w[i];
    let best = 0;
    let bestMass = -1;
    for (let b = 0; b < bins; b += 1) {
      const mass = hist[b] + 0.5 * (hist[(b + 1) % bins] + hist[(b - 1 + bins) % bins]);
      if (mass > bestMass) {
        bestMass = mass;
        best = b;
      }
    }
    const centre = (best + 0.5) * bin;
    let sw = 0;
    let sp = 0;
    let sr = 0;
    let within = 0;
    for (let i = 0; i < n; i += 1) {
      let d = this.pos[i] - centre;
      d -= Math.round(d / T) * T;
      if (Math.abs(d) <= 1.5) {
        sw += this.w[i];
        sp += this.w[i] * d;
        sr += this.w[i] * this.rate[i];
      }
      let d1 = this.pos[i] - centre;
      d1 -= Math.round(d1 / T) * T;
      if (Math.abs(d1) <= 1) within += this.w[i];
    }
    let position = sw > 0 ? centre + sp / sw : centre;
    position = ((position % T) + T) % T;
    const rate = sw > 0 ? sr / sw : this.ref.nominalBeatsPerSecond;
    if (held) {
      position = this.lastEstimate;
    } else {
      this.lastEstimate = position;
    }
    return {
      time,
      position,
      bpm: rate * 60,
      concentration: within,
      fit,
      logEvidence,
      logNull,
      z,
      zMax,
      held,
      ess,
    };
  }

  get meanLogEvidence(): number {
    return this.framesSeen > 0 ? this.sumLogEvidence / this.framesSeen : 0;
  }

  get totalLogEvidence(): number {
    return this.sumLogEvidence;
  }

  /** Zet alle deeltjes weer uniform (bijvoorbeeld na handmatig herstarten). */
  reset(start: TrackerConfig["start"] = this.config.start): void {
    this.config.start = start;
    this.lastTime = null;
    this.silentRun = 0;
    this.sumLogEvidence = 0;
    this.framesSeen = 0;
    this.initParticles();
  }
}
