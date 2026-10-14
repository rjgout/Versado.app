// Voorspel- en zangfase, bovenop de muziekvolger.
//
// De score-follower weet WAAR in de melodie de muziek is, maar niet of de gemeente al zingt: een organist die
// het voorspel speelt (de laatste regels, een heel couplet) speelt dezelfde noten als bij de samenzang. Alleen
// uit toonhoogtes valt dat dus niet te halen. Deze laag gebruikt daarom STRUCTUUR in plaats van toonhoogte:
//
//  - de rondegrens: het voorspel eindigt waar de melodie eindigt, de zang begint waar de melodie begint;
//  - waar de muziek binnen de cyclus begon (een voorspel van "de laatste vier maten" begint midden in de
//    cyclus, een heel couplet begint bij het begin) en hoeveel muziek er tot de rondegrens is gespeeld;
//  - een stilte vlak voor de rondegrens;
//  - dekking: een ronde telt pas als er genoeg van de melodie doorlopen is, zodat een tussenspel van twee
//    regels geen extra couplet oplevert.
//
// Bij onvoldoende bewijs gokt deze laag niet: de fase blijft "voorspel" en de gebruiker bevestigt het
// zangbegin zelf. Een handmatige bevestiging heeft altijd voorrang. De verandering van het geluidsniveau
// wordt alleen als diagnose bijgehouden (zie `levelStepDb`); ze beslist niets, omdat ze nog niet met echte
// kerkopnamen is gemeten en pratende kinderen er ook door stijgen.

export type SingPhase = "prelude" | "singing" | "interlude";

/** Hoe de muziek begon, t.o.v. de cyclus van de melodie. */
export type EntryKind = "unknown" | "start" | "mid" | "joined";

export type StartReason = "wrap-tail" | "wrap-gap" | "manual";

export interface PhaseConfig {
  /** Alleen waarnemingen met zo veel concentratie van de positie tellen mee. */
  minConcentration: number;
  /** De "staart" van de cyclus (laatste deel) waarin de rondegrens wordt voorbereid. */
  tailFraction: number;
  /** Zo veel seconden achter elkaar moet de positie in de staart zijn gezien vóór de grens telt. */
  minTailSeconds: number;
  /** Rondegrens: van voorbij `wrapFrom` van de cyclus naar vóór `wrapTo`. */
  wrapFrom: number;
  wrapTo: number;
  /** Aantal frames waaruit de uitgangsruis wordt geschat; de muziek moet daarna duidelijk boven die ruis uitkomen. */
  baselineFrames: number;
  /** Zo veel dB boven de uitgangsruis begint de muziek (en stapten we dus niet halverwege in). */
  riseDb: number;
  /** Een frame is stil als het zo veel dB onder het recente maximum zit (kerkakoestiek maakt van stilte zelden digitale stilte). */
  gapDropDb: number;
  /** Beginpunt (als fractie van de cyclus) waarbinnen de muziek "bij het begin" begon. */
  startWindowLow: number;
  startWindowHigh: number;
  /** Zo veel gespeelde muziek (fractie van de cyclus) geldt als een heel couplet voorspel. */
  fullLapFraction: number;
  /** Een stilte vanaf zo veel seconden telt als pauze. */
  minGapSeconds: number;
  /** Een pauze telt mee als ze hoogstens zo veel seconden vóór de rondegrens is geëindigd. */
  gapWindowSeconds: number;
  /** Minimale dekking van de cyclus (fractie) voor een ronde die een couplet doorschakelt. */
  minLapCoverage: number;
  /** Een sprong van de positie vanaf zo veel van de cyclus is een onderbreking (tussenspel). */
  jumpFraction: number;
  /** De nieuwe plek moet zo lang stabiel zijn voor een sprong geldt. */
  jumpSeconds: number;
  /** Bewijs dat nodig is voor een automatisch zangbegin. */
  startThreshold: number;
  weightWrap: number;
  weightTail: number;
  weightGap: number;
}

export const DEFAULT_PHASE_CONFIG: PhaseConfig = {
  minConcentration: 0.5,
  tailFraction: 0.3,
  minTailSeconds: 0.8,
  wrapFrom: 0.8,
  wrapTo: 0.2,
  baselineFrames: 10,
  riseDb: 12,
  gapDropDb: 20,
  startWindowLow: -0.04,
  startWindowHigh: 0.1,
  fullLapFraction: 0.8,
  minGapSeconds: 0.5,
  gapWindowSeconds: 3,
  minLapCoverage: 0.6,
  jumpFraction: 0.15,
  jumpSeconds: 2,
  startThreshold: 0.8,
  weightWrap: 0.3,
  weightTail: 0.55,
  weightGap: 0.6,
};

export interface PhaseObservation {
  time: number;
  position: number;
  concentration: number;
  bpm: number;
  /** De tracker hield de positie vast (stilte). */
  held: boolean;
  silent: boolean;
  rmsDb: number;
}

export type PhaseEvent =
  | { time: number; type: "start"; reason: StartReason; evidence: string[] }
  | { time: number; type: "lap"; lap: number }
  | { time: number; type: "lap-ignored"; coverage: number }
  | { time: number; type: "interlude" }
  | { time: number; type: "resume" }
  | { time: number; type: "waiting"; evidence: string[] }
  | { time: number; type: "back-to-prelude" };

export interface PhaseState {
  phase: SingPhase;
  entry: EntryKind;
  /** Een grens zonder genoeg bewijs is gepasseerd (of we stapten halverwege in): de gebruiker moet bevestigen. */
  waiting: boolean;
  /** Aantal rondes dat sinds het zangbegin is voltooid (0 = het eerste couplet wordt nog gezongen). */
  sungLaps: number;
  /** Dekking (0..1) van de melodie sinds de laatste rondegrens. */
  coverage: number;
  startReason: StartReason | null;
  /** Bewijs waarop het zangbegin berust, voor het technische paneel. */
  startEvidence: string[];
  /** Verandering van het geluidsniveau (dB) laatste 2 s t.o.v. de 6 s ervoor. Alleen diagnose. */
  levelStepDb: number;
  /** Aantal bevestigde onderbrekingen van de positie sinds het zangbegin. */
  interludes: number;
}

const BINS = 40;

function signedDist(a: number, b: number, cycle: number): number {
  let d = (a - b) % cycle;
  if (d > cycle / 2) d -= cycle;
  if (d < -cycle / 2) d += cycle;
  return d;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export class SingingPhase {
  readonly config: PhaseConfig;
  private readonly cycle: number;

  private phase: SingPhase = "prelude";
  private entry: EntryKind = "unknown";
  private waiting = false;
  private sungLaps = 0;
  private startReason: StartReason | null = null;
  private startEvidence: string[] = [];
  private interludes = 0;
  /** De eerste rondegrens na een handmatig zangbegin telt altijd als einde van het gezongen couplet. */
  private firstWrapCounts = false;
  /** Handmatig zangbegin vlak voor een rondegrens: het zingen begint pas bij die grens. */
  private pendingManual = false;

  private firstTime: number | null = null;
  private musicStart: number | null = null;
  private fresh = false;
  private quietSince: number | null = null;
  private baseline: number[] = [];
  private baselineDb: number | null = null;
  private riseFrames = 0;
  private riseStart = 0;
  private lastGap: { start: number; end: number } | null = null;
  private heardBeats = 0;
  private lastFrameTime: number | null = null;

  private track: { pos: number; time: number } | null = null;
  private firstObsImplied: number | null = null;
  private candidate: { pos: number; time: number; since: number } | null = null;
  private tailSeconds = 0;
  private readonly visited = new Uint8Array(BINS);
  private readonly levels: { t: number; db: number }[] = [];
  private levelStepDb = 0;
  private frames = 0;

  constructor(cycleBeats: number, config: Partial<PhaseConfig> = {}) {
    this.cycle = cycleBeats;
    this.config = { ...DEFAULT_PHASE_CONFIG, ...config };
  }

  get state(): PhaseState {
    return {
      phase: this.phase,
      entry: this.phase === "prelude" ? this.classifyEntry() : this.entry,
      waiting: this.waiting || (this.phase === "prelude" && this.track !== null && !this.fresh),
      sungLaps: this.sungLaps,
      coverage: this.coverage(),
      startReason: this.startReason,
      startEvidence: this.startEvidence,
      levelStepDb: this.levelStepDb,
      interludes: this.interludes,
    };
  }

  get isSinging(): boolean {
    return this.phase === "singing";
  }

  private coverage(): number {
    let n = 0;
    for (let i = 0; i < BINS; i += 1) n += this.visited[i];
    return n / BINS;
  }

  private mark(pos: number): void {
    const f = ((pos % this.cycle) + this.cycle) % this.cycle;
    this.visited[Math.min(BINS - 1, Math.floor((f / this.cycle) * BINS))] = 1;
  }

  /** Eén frame. Geeft de gebeurtenissen van dit frame terug (meestal geen). */
  observe(o: PhaseObservation): PhaseEvent[] {
    const events: PhaseEvent[] = [];
    const cfg = this.config;
    const T = this.cycle;
    this.frames += 1;
    const dt = this.lastFrameTime === null ? 0 : Math.max(0, Math.min(1, o.time - this.lastFrameTime));
    this.lastFrameTime = o.time;
    if (this.firstTime === null) this.firstTime = o.time;

    // --- niveau, pauzes en het begin van de muziek
    const quiet = this.isQuiet(o);
    this.levels.push({ t: o.time, db: o.rmsDb });
    while (this.levels.length > 0 && o.time - this.levels[0].t > 8) this.levels.shift();
    this.detectMusicStart(o);
    if (quiet) {
      if (this.quietSince === null) this.quietSince = o.time;
    } else {
      if (this.quietSince !== null && o.time - this.quietSince >= cfg.minGapSeconds && this.musicStart !== null) this.lastGap = { start: this.quietSince, end: o.time };
      this.quietSince = null;
      if (this.musicStart !== null) this.heardBeats += (Math.max(0, o.bpm) / 60) * dt;
      this.updateLevelStep(o);
    }

    if (o.held || o.silent || quiet) {
      // De positie ligt vast tijdens een pauze: verwacht daarna dezelfde plek, niet een doorgelopen tijd.
      if (this.track) this.track.time = o.time;
      return events;
    }
    if (o.concentration < cfg.minConcentration) return events;

    // --- eerste bruikbare waarneming
    const bps = Math.max(0.3, o.bpm / 60);
    if (this.track === null) {
      this.track = { pos: o.position, time: o.time };
      if (this.musicStart === null) this.musicStart = this.firstTime; // we stapten halverwege in
      this.firstObsImplied = o.position - bps * (o.time - this.musicStart);
      this.acceptObservation(o, events, null, dt);
      return events;
    }

    // --- continuïteit: past deze plek bij de vorige plek en het tempo?
    const expected = this.track.pos + bps * (o.time - this.track.time);
    const d = signedDist(o.position, expected, T);
    if (Math.abs(d) <= cfg.jumpFraction * T) {
      this.candidate = null;
      const prev = this.track.pos;
      this.track = { pos: o.position, time: o.time };
      this.acceptObservation(o, events, prev, dt);
      return events;
    }
    // Een sprong: pas geldig als de nieuwe plek een tijd stabiel blijft (anders is het een misser van de volger).
    const c = this.candidate;
    if (!c || Math.abs(signedDist(o.position, c.pos + bps * (o.time - c.time), T)) > 0.06 * T) {
      this.candidate = { pos: o.position, time: o.time, since: o.time };
    } else {
      c.pos = o.position;
      c.time = o.time;
      if (o.time - c.since >= cfg.jumpSeconds) {
        this.candidate = null;
        this.track = { pos: o.position, time: o.time };
        this.tailSeconds = 0;
        this.mark(o.position);
        if (this.phase === "singing") {
          this.phase = "interlude";
          this.interludes += 1;
          events.push({ time: o.time, type: "interlude" });
        }
      }
    }
    return events;
  }

  private acceptObservation(o: PhaseObservation, events: PhaseEvent[], prev: number | null, dt: number): void {
    const cfg = this.config;
    const T = this.cycle;
    const pos = ((o.position % T) + T) % T;
    this.mark(pos);
    const inTail = pos >= (1 - cfg.tailFraction) * T;
    if (inTail) this.tailSeconds += dt;

    if (prev === null) return;
    const p = ((prev % T) + T) % T;
    const wrapped = p > cfg.wrapFrom * T && pos < cfg.wrapTo * T;
    if (!wrapped) {
      // verder dan de helft van de cyclus voorbij het begin zonder grens: de staart telt niet meer mee
      if (pos > 0.4 * T && pos < (1 - cfg.tailFraction) * T) this.tailSeconds = 0;
      return;
    }
    const ready = this.tailSeconds >= cfg.minTailSeconds;
    this.tailSeconds = 0;
    if (!ready) return;
    this.onBoundary(o.time, events);
  }

  private onBoundary(time: number, events: PhaseEvent[]): void {
    const cfg = this.config;
    const coverage = this.coverage();

    if (this.phase === "prelude") {
      const entry = this.classifyEntry();
      this.entry = entry;
      const evidence: string[] = ["rondegrens"];
      let score = cfg.weightWrap;
      if (entry === "mid") {
        score += cfg.weightTail;
        evidence.push("voorspel begon midden in het couplet");
      }
      const gap = this.lastGap && time - this.lastGap.end <= cfg.gapWindowSeconds && this.lastGap.end <= time + 0.01 ? this.lastGap : null;
      if (gap) {
        score += cfg.weightGap;
        evidence.push(`pauze van ${(gap.end - gap.start).toFixed(1)} s vlak voor de grens`);
      }
      if (this.pendingManual) {
        this.pendingManual = false;
        this.startSinging(time, "manual", ["handmatig bevestigd"], events, false);
        return;
      }
      if (score >= cfg.startThreshold) {
        this.startSinging(time, gap ? "wrap-gap" : "wrap-tail", evidence, events, false);
      } else {
        // geen bewijs dat het zingen begint: dit kan een voorspel van een heel couplet zijn. Niet gokken.
        this.waiting = true;
        events.push({ time, type: "waiting", evidence });
        this.resetCoverage();
      }
      return;
    }

    if (this.phase === "interlude") {
      this.phase = "singing";
      this.countLap(time, coverage, events);
      events.push({ time, type: "resume" });
      this.resetCoverage();
      return;
    }

    // singing
    this.countLap(time, coverage, events);
    this.resetCoverage();
  }

  /** Een ronde telt alleen als er genoeg van de melodie is doorlopen (geen tussenspel van twee regels). */
  private countLap(time: number, coverage: number, events: PhaseEvent[]): void {
    const enough = coverage >= this.config.minLapCoverage || this.firstWrapCounts;
    this.firstWrapCounts = false;
    if (!enough) {
      events.push({ time, type: "lap-ignored", coverage });
      return;
    }
    this.sungLaps += 1;
    events.push({ time, type: "lap", lap: this.sungLaps });
  }

  private classifyEntry(): EntryKind {
    if (!this.fresh) return "joined";
    const cfg = this.config;
    const T = this.cycle;
    // Heel couplet gespeeld sinds de eerste klank = begon bij het begin.
    if (this.heardBeats >= cfg.fullLapFraction * T) return "start";
    if (this.firstObsImplied === null) return "unknown";
    const f = (((this.firstObsImplied % T) + T) % T) / T;
    return f <= cfg.startWindowHigh || f >= 1 + cfg.startWindowLow ? "start" : "mid";
  }

  private startSinging(time: number, reason: StartReason, evidence: string[], events: PhaseEvent[], manualMidLap: boolean): void {
    this.phase = "singing";
    this.waiting = false;
    this.startReason = reason;
    this.startEvidence = evidence;
    this.sungLaps = 0;
    this.firstWrapCounts = manualMidLap;
    this.interludes = 0;
    this.resetCoverage();
    events.push({ time, type: "start", reason, evidence });
  }

  private resetCoverage(): void {
    this.visited.fill(0);
    if (this.track) this.mark(this.track.pos);
  }

  /**
   * De gebruiker bevestigt dat het zingen nu begint. Heeft altijd voorrang; de muziekvolging wordt niet
   * aangeraakt. Vlak voor een rondegrens (laatste deel van het voorspel) begint het zingen pas bij die grens.
   */
  confirmStart(time: number, position: number): PhaseEvent[] {
    const events: PhaseEvent[] = [];
    if (this.phase === "singing") return events;
    const T = this.cycle;
    const pos = ((position % T) + T) % T;
    if (pos >= this.config.wrapFrom * T && this.phase === "prelude") {
      this.pendingManual = true;
      this.waiting = false;
      return events;
    }
    this.pendingManual = false;
    // Bij een handmatig begin midden in het couplet eindigt het gezongen couplet bij de eerstvolgende grens.
    this.startSinging(time, "manual", ["handmatig bevestigd"], events, true);
    return events;
  }

  /** Terug naar "voorspel": de markering stopt tot het zangbegin opnieuw is vastgesteld. Microfoon blijft. */
  backToPrelude(time: number): PhaseEvent[] {
    this.phase = "prelude";
    this.entry = "joined";
    this.waiting = true;
    this.sungLaps = 0;
    this.startReason = null;
    this.startEvidence = [];
    this.pendingManual = false;
    this.firstWrapCounts = false;
    this.candidate = null;
    this.tailSeconds = 0;
    this.resetCoverage();
    return [{ time, type: "back-to-prelude" }];
  }

  private isQuiet(o: PhaseObservation): boolean {
    if (o.silent) return true;
    let peak = -Infinity;
    for (const l of this.levels) if (o.time - l.t >= 0.5 && l.db > peak) peak = l.db;
    return Number.isFinite(peak) && o.rmsDb < peak - this.config.gapDropDb;
  }

  /** Eerst een stukje uitgangsruis, dan het moment dat de muziek er duidelijk boven uitkomt. */
  private detectMusicStart(o: PhaseObservation): void {
    const cfg = this.config;
    if (this.musicStart !== null) return;
    if (this.baselineDb === null) {
      this.baseline.push(o.rmsDb);
      if (this.baseline.length >= cfg.baselineFrames) this.baselineDb = median(this.baseline);
      return;
    }
    if (o.rmsDb >= this.baselineDb + cfg.riseDb) {
      if (this.riseFrames === 0) this.riseStart = o.time;
      this.riseFrames += 1;
      if (this.riseFrames >= 2) {
        this.musicStart = this.riseStart;
        this.fresh = true;
      }
    } else this.riseFrames = 0;
  }

  private updateLevelStep(o: PhaseObservation): void {
    if (this.frames % 10 !== 0) return;
    const recent = this.levels.filter((l) => o.time - l.t <= 2).map((l) => l.db);
    const before = this.levels.filter((l) => o.time - l.t > 2).map((l) => l.db);
    if (recent.length >= 20 && before.length >= 40) this.levelStepDb = median(recent) - median(before);
  }
}
