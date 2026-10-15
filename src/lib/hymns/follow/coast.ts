// Doorlopen op het laatst betrouwbare tempo bij tijdelijk syncverlies ("coasten").
//
// Probleem: de muziekengine verliest soms even de synchronisatie (galm, een verkeerd klinkende noot, een zachte passage). De woordmarkering
// bevroor dan meteen, terwijl de gemeente gewoon doorzingt: de gebruiker verliest zijn plek in de tekst. Rustig meelezen heeft voorrang op perfecte
// synchronisatie, dus lopen de woorden een beperkte tijd voorspelbaar door.
//
// Dit is GEEN nieuw herkenningsalgoritme: er wordt niets uit audio afgeleid. Het is een rekensom op wat de volger al betrouwbaar mat:
// de laatste betrouwbare positie en het laatst betrouwbaar gemeten tempo, waarmee de beat-naar-woordkoppeling (display.ts) gewoon blijft werken.
//
// Regels (veiligheid, nooit ongecontroleerd doorlopen):
//  - alleen tijdens de zang, en alleen als er een betrouwbare meting voorafging (minstens `minReliableSeconds`);
//  - hooguit `maxCoastSeconds` achtereen; daarna bevriest de markering weer (langdurig verlies: lees zelf verder);
//  - stilte (pauze, fermate) telt niet mee: de muziek staat dan stil, dus de schatting ook;
//  - nooit voorbij het einde van de ronde: de volgende ronde (couplet) begint pas op een gemeten rondegrens, nooit op een gok;
//  - een fermate houdt de schatting vast (hoe lang er gehouden wordt is niet te voorspellen);
//  - bij herstel sluit de weergave aan zonder sprong: achterlopen wordt met beperkte snelheid ingehaald, vooruitlopen wacht tot de meting aansluit
//    (de weergave gaat binnen een ronde nooit terug); alleen een rondegrens of een afwijking groter dan `glideMaxBeats` is een echte sprong;
//  - zolang de weergave nog afwijkt van de meting is de bron "catching-up", niet "measured": de woorden zijn dan nog niet op de meting.

export type PositionSource = "measured" | "catching-up" | "estimated" | "frozen" | "none";

export interface CoastConfig {
  /** Zo lang mag de positie achtereen worden geschat. */
  maxCoastSeconds: number;
  /** Zo lang moet er eerst betrouwbaar gemeten zijn voordat het tempo vertrouwd wordt. */
  minReliableSeconds: number;
  /** Inhaalsnelheid bij herstel, als veelvoud van het tempo. */
  catchUpFactor: number;
  /** Grotere afstanden (in beats) tussen schatting en meting worden niet "ingehaald" maar als echte sprong genomen. */
  glideMaxBeats: number;
  /** Ligt de meting ver (meer dan `glideMaxBeats`) achter de weergave, dan wacht de weergave zo lang (seconden) voordat hij als echte herpositionering de meting volgt. */
  aheadHoldSeconds: number;
  /** Tempo's buiten dit bereik (veelvoud van het nominale tempo) worden niet gebruikt om door te lopen. */
  tempoRange: [number, number];
}

export const DEFAULT_COAST_CONFIG: CoastConfig = {
  maxCoastSeconds: 7,
  minReliableSeconds: 3,
  catchUpFactor: 2.5,
  glideMaxBeats: 8,
  aheadHoldSeconds: 3,
  tempoRange: [0.5, 1.8],
};

export interface CoastInput {
  time: number;
  /** Een gemeten, betrouwbare positie (status locked of recovered, er klinkt iets). */
  reliable: boolean;
  /** Er klinkt (bijna) niets: de muziek staat stil. */
  held: boolean;
  /** De zang is begonnen (niet voorspel of tussenspel). */
  singing: boolean;
  /** Gemeten positie in beats binnen de cyclus en gemeten tempo in beats per minuut. */
  position: number;
  bpm: number;
}

export interface CoastStatic {
  cycleBeats: number;
  fermatas: readonly number[];
  nominalBeatsPerSecond: number;
}

export interface CoastOutput {
  /** Positie voor de woordmarkering, of null als er (nog) geen is. */
  position: number | null;
  source: PositionSource;
  /** Hoe lang (seconden) de positie nu al geschat wordt. */
  estimatedSeconds: number;
  /** True als de weergave net aansluit na een schatting (de afstand wordt rustig ingehaald). */
  gliding: boolean;
}

const NONE: CoastOutput = { position: null, source: "none", estimatedSeconds: 0, gliding: false };

export class PositionCoaster {
  private readonly cfg: CoastConfig;
  private readonly ref: CoastStatic;
  private display: number | null = null;
  private lastTime: number | null = null;
  private reliableSeconds = 0;
  private bps: number;
  private estimating = false;
  private coastSeconds = 0;
  private gliding = false;
  private aheadFor = 0;
  private wrapTo: number | null = null;
  private out: CoastOutput = NONE;

  constructor(ref: CoastStatic, config: Partial<CoastConfig> = {}) {
    this.cfg = { ...DEFAULT_COAST_CONFIG, ...config };
    this.ref = ref;
    this.bps = ref.nominalBeatsPerSecond;
  }

  get value(): CoastOutput {
    return this.out;
  }

  /** Terug naar "niets" (nieuwe zang, voorspel, tussenspel, opnieuw synchroniseren). */
  reset(): void {
    this.display = null;
    this.lastTime = null;
    this.reliableSeconds = 0;
    this.bps = this.ref.nominalBeatsPerSecond;
    this.estimating = false;
    this.coastSeconds = 0;
    this.gliding = false;
    this.aheadFor = 0;
    this.wrapTo = null;
    this.out = NONE;
  }

  /**
   * De fase-laag heeft een rondegrens vastgesteld (op gemeten positie, nooit door deze klasse): de weergave springt mee naar het begin
   * van de nieuwe ronde in plaats van aan het einde van de vorige te blijven hangen. `position` is de gemeten positie op dat moment.
   */
  noteLap(position: number): void {
    this.wrapTo = position >= 0 && position < this.ref.cycleBeats * 0.5 ? position : 0;
  }

  /** Het laatst betrouwbaar gemeten tempo in beats per seconde. */
  get beatsPerSecond(): number {
    return this.bps;
  }

  update(input: CoastInput): CoastOutput {
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(1, input.time - this.lastTime));
    this.lastTime = input.time;
    if (!input.singing) {
      this.reset();
      this.lastTime = input.time;
      return this.out;
    }
    const { cycleBeats } = this.ref;

    if (input.reliable && !input.held) {
      this.wrapTo = null;
      this.reliableSeconds += dt;
      this.learnTempo(input.bpm, dt);
      if (this.estimating && this.display !== null) {
        // aansluiten na een schatting, zonder sprong
        const gap = input.position - this.display;
        this.estimating = false;
        this.coastSeconds = 0;
        this.gliding = true;
        this.aheadFor = 0;
        this.glide(input.position, gap, dt);
      } else if (this.gliding && this.display !== null) {
        this.glide(input.position, input.position - this.display, dt);
      } else {
        this.display = input.position;
      }
      this.out = { position: this.display, source: this.gliding ? "catching-up" : "measured", estimatedSeconds: 0, gliding: this.gliding };
      return this.out;
    }

    if (this.wrapTo !== null && this.display !== null && !(input.reliable && !input.held)) {
      this.display = this.wrapTo;
      this.wrapTo = null;
    }
    if (input.held) {
      // stilte of pauze: de muziek staat stil, dus de plek ook (en de schatting loopt niet door)
      this.out = this.display === null ? NONE : { position: this.display, source: this.estimating ? "estimated" : "frozen", estimatedSeconds: this.coastSeconds, gliding: false };
      return this.out;
    }

    // onbetrouwbaar: doorlopen op het laatst betrouwbare tempo, binnen de veilige grenzen
    if (this.display === null) {
      this.out = NONE;
      return this.out;
    }
    this.gliding = false;
    const canCoast = this.reliableSeconds >= this.cfg.minReliableSeconds && this.coastSeconds < this.cfg.maxCoastSeconds;
    if (!canCoast) {
      this.estimating = false;
      this.out = { position: this.display, source: "frozen", estimatedSeconds: this.coastSeconds, gliding: false };
      return this.out;
    }
    this.estimating = true;
    this.coastSeconds += dt;
    if (this.wrapTo !== null) {
      this.display = this.wrapTo;
      this.wrapTo = null;
    }
    let next = this.display + this.bps * dt;
    // een fermate houdt vast: hoe lang er gehouden wordt is niet te voorspellen
    for (const f of this.ref.fermatas) if (this.display <= f + 1e-6 && next > f) next = f;
    // nooit voorbij het einde van de ronde: de volgende ronde begint pas op een gemeten rondegrens
    next = Math.min(next, cycleBeats - 0.02);
    this.display = Math.max(this.display, next);
    this.out = { position: this.display, source: "estimated", estimatedSeconds: this.coastSeconds, gliding: false };
    return this.out;
  }

  private learnTempo(bpm: number, dt: number): void {
    const bps = bpm / 60;
    const [lo, hi] = this.cfg.tempoRange;
    const nominal = this.ref.nominalBeatsPerSecond;
    if (!Number.isFinite(bps) || bps < nominal * lo || bps > nominal * hi) return;
    // rustig bijstellen (tijdconstante ~4 s): één rommelige meting verandert het tempo niet
    const a = this.reliableSeconds <= dt + 1e-9 ? 1 : 1 - Math.exp(-dt / 4);
    this.bps += a * (bps - this.bps);
  }

  /** Naar de meting toe zonder visuele sprong: achterlopen = beperkt inhalen, vooruitlopen = wachten (nooit terug binnen een ronde). */
  private glide(target: number, gap: number, dt: number): void {
    if (this.display === null) return;
    const { cycleBeats } = this.ref;
    // De meting begint een nieuwe ronde terwijl de weergave nog aan het einde van de vorige staat: dat is geen terugsprong maar de rondegrens.
    const roundBoundary = this.display > cycleBeats * 0.75 && target < cycleBeats * 0.25;
    if (roundBoundary || gap > this.cfg.glideMaxBeats) {
      // geen glijdende aansluiting mogelijk: de gebruiker is echt achterop geraakt (gemiste ronde of lang verlies); de woordmarkering
      // beweegt daarna toch hooguit een regel per keer (StableCursor) en een couplet wisselt alleen op een gemeten rondegrens
      this.jumpTo(target);
      return;
    }
    if (gap < -this.cfg.glideMaxBeats) {
      // de meting ligt ver achter de weergave: eerst vasthouden (misschien een tijdelijke verkeerde plek); blijft dat, dan is het een herpositionering
      this.aheadFor += dt;
      if (this.aheadFor >= this.cfg.aheadHoldSeconds) this.jumpTo(target);
      return;
    }
    if (gap > 1e-3) {
      const step = Math.max(this.bps * this.cfg.catchUpFactor * dt, 0);
      this.display = gap <= step || gap < 0.05 ? target : this.display + step;
    } else if (gap < -0.05) {
      // de schatting liep vóór: de markering wacht tot de meting aansluit. De meting loopt zelf op tempo door, dus dit duurt hooguit
      // `glideMaxBeats` beats; er is bewust geen terugsprong na een tijdslimiet.
      this.aheadFor = 0;
    } else {
      this.display = target;
    }
    if (Math.abs(target - this.display) < 0.05) {
      this.display = target;
      this.gliding = false;
      this.aheadFor = 0;
    }
  }

  private jumpTo(target: number): void {
    this.display = target;
    this.gliding = false;
    this.aheadFor = 0;
  }
}
