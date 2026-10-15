import { ChromaExtractor, type FeatureFrame } from "./audio/features";
import { HymnFollowSession, type FollowSnapshot, type SessionConfig } from "./follow/session";
import { HymnRecognizer, type RecognitionCandidate, type RecognitionState } from "./recognize/recognizer";
import type { ResolvedHymn } from "./types";

// Eén doorlopende luistersessie voor "Herken lofzang" én "Volgen". Er is één audiopijplijn (de microfoon en
// één kenmerkextractor); herkennen en volgen zijn twee fasen van dezelfde stroom kenmerkframes:
//
//  - recognizing: de herkenner draait parallel voor elke kandidaat;
//  - following:   één score-follower met zijn voorspel-/zangfase.
//
// De overgang van herkennen naar volgen start GEEN nieuwe microfoon- of audiosessie. Omdat de herkenner en de
// volger verschillend afgestelde deeltjesfilters zijn, wordt hun toestand niet overgezet; in plaats daarvan
// worden de recente kenmerkframes (geen audio, alleen 24 getallen per 46 ms, in het geheugen) opnieuw door de
// volger gehaald. De volger staat daardoor precies waar hij zou staan als hij vanaf het begin had meegeluisterd,
// en de voorspel-/zangfaselaag heeft ook het begin van het voorspel gezien. Dat is dezelfde berekening als bij
// direct volgen; het resultaat is dus bewijsbaar gelijk (tests/hymns-live.test.ts).
//
// De frames wachten in een wachtrij en worden binnen een tijdsbudget per aanroep verwerkt, zodat een
// terugspeling van een halve minuut de telefoon niet laat haperen.

export type LiveStage = "idle" | "recognizing" | "following";
export type HymnChoice = "manual" | "auto";

export interface LiveState {
  stage: LiveStage;
  hymn: ResolvedHymn | null;
  /** Hoe de lofzang is gekozen: door de gebruiker of door de herkenning. */
  choice: HymnChoice | null;
  recognition: RecognitionState | null;
  snapshot: FollowSnapshot | null;
  /** Aantal frames dat nog op verwerking wacht (na een overgang). */
  backlog: number;
  /**
   * Bibliotheekmodus: de herkenning heeft een lofzang gekozen waarvan de tekst nog niet is geladen. De UI haalt hem op,
   * meldt hem met registerHymn() en de engine volgt dan vanaf het geheugen (er gaat geen luistertijd verloren).
   */
  needHymn: number | null;
  /** Diagnostiek van de audioketen (alleen tellers en niveaus, nooit audio). */
  diag: LiveDiagnostics;
}

export interface LiveDiagnostics {
  /** Aantal kenmerkframes dat de extractor sinds de start produceerde. */
  frames: number;
  /** Laatste frame: hoorbare muziek of stilte, en het niveau in dBFS (null als er nog geen frame was). */
  lastFrameSilent: boolean | null;
  lastRmsDb: number | null;
  /** Aantal kandidaat-composities waartegen herkend wordt (0 zolang de herkenningsgegevens ontbreken). */
  candidates: number;
  /** De herkenning wacht nog op de herkenningsgegevens (de microfoon luistert intussen door). */
  awaitingCandidates: boolean;
}

export interface LiveEngineOptions {
  session?: Partial<SessionConfig>;
  /** Hoeveel seconden kenmerkframes we vasthouden voor de overgang (en een wissel van lofzang). */
  bufferSeconds?: number;
  /** Een voorstel van de herkenner moet zo lang achter elkaar hetzelfde zijn voor automatisch volgen. */
  stableSeconds?: number;
  /** Zonder automatisch volgen blijft een herkende lofzang een voorstel dat de gebruiker bevestigt. */
  autoFollow?: boolean;
}

const DEFAULT_BUFFER_SECONDS = 90;

/** Eén kandidaat per unieke compositie; lofzangen met dezelfde melodie delen die kandidaat (de gebruiker kiest dan de tekst). */
export function candidatesFromHymns(hymns: ResolvedHymn[]): RecognitionCandidate[] {
  const byComposition = new Map<string, ResolvedHymn[]>();
  for (const h of hymns) byComposition.set(h.composition.id, [...(byComposition.get(h.composition.id) ?? []), h]);
  return [...byComposition.values()].map((group) => ({
    id: group[0].composition.id,
    number: group[0].number,
    title: group[0].text.title,
    composition: group[0].composition,
    sharedWith: group.slice(1).map((h) => ({ number: h.number, title: h.text.title })),
  }));
}

export class HymnLiveEngine {
  private hymns: ResolvedHymn[];
  private candidates: RecognitionCandidate[] | null = null;
  private needHymn: number | null = null;
  private awaitingCandidates = false;
  private framesProduced = 0;
  private lastFrame: { silent: boolean; rmsDb: number } | null = null;
  private readonly opts: Required<Omit<LiveEngineOptions, "session">> & { session: Partial<SessionConfig> };
  private extractor: ChromaExtractor | null = null;
  private recognizer: HymnRecognizer | null = null;
  private session: HymnFollowSession | null = null;
  private stage: LiveStage = "idle";
  private hymn: ResolvedHymn | null = null;
  private choice: HymnChoice | null = null;
  private readonly buffer: FeatureFrame[] = [];
  private queue: FeatureFrame[] = [];
  private queueAt = 0;
  private stanzaOrder: number[] = [];
  private suggestionId: string | null = null;
  private suggestionSince = 0;
  private lastRecognition: RecognitionState | null = null;

  constructor(hymns: ResolvedHymn[], options: LiveEngineOptions = {}) {
    this.hymns = hymns;
    this.opts = {
      session: options.session ?? {},
      bufferSeconds: options.bufferSeconds ?? DEFAULT_BUFFER_SECONDS,
      stableSeconds: options.stableSeconds ?? 2,
      autoFollow: options.autoFollow ?? true,
    };
  }

  /**
   * Bibliotheekmodus: herken tegen deze kandidaten (alle gevalideerde composities) in plaats van tegen de geladen lofzangen.
   * Wacht de herkenning al op de kandidaten (zie startRecognizing), dan begint ze nu en loopt ze eerst het geheugen door:
   * het begin van het voorspel gaat dus niet verloren omdat de gegevens later binnenkwamen dan de microfoon.
   */
  setCandidates(candidates: RecognitionCandidate[]): void {
    this.candidates = candidates;
    if (this.awaitingCandidates && this.stage === "recognizing") {
      this.awaitingCandidates = false;
      this.recognizer = new HymnRecognizer(candidates);
      this.queue = [...this.buffer];
      this.queueAt = 0;
    }
  }

  get hasCandidates(): boolean {
    return this.candidates !== null;
  }

  /** Maakt een (inmiddels geladen) lofzang bekend zodat de engine hem kan volgen. */
  registerHymn(hymn: ResolvedHymn): void {
    if (!this.hymns.some((h) => h.number === hymn.number)) this.hymns = [...this.hymns, hymn];
    if (this.needHymn === hymn.number && this.stage === "recognizing") {
      this.needHymn = null;
      this.followHymn(hymn.number, "auto");
    }
  }

  get currentStage(): LiveStage {
    return this.stage;
  }

  get currentHymn(): ResolvedHymn | null {
    return this.hymn;
  }

  /** Voor tests en diagnose: dezelfde extractor blijft de hele luistersessie in gebruik. */
  get extractorInstance(): ChromaExtractor | null {
    return this.extractor;
  }

  get followSession(): HymnFollowSession | null {
    return this.session;
  }

  /**
   * Begin met herkennen (de lofzang is nog niet bekend). Gooit de vorige keuze weg, niet de audio.
   * Met `awaitCandidates` mag de microfoon al luisteren terwijl de herkenningsgegevens nog binnenkomen.
   */
  startRecognizing(options: { awaitCandidates?: boolean } = {}): void {
    this.session = null;
    this.hymn = null;
    this.choice = null;
    this.stage = "recognizing";
    this.suggestionId = null;
    this.queueAt = 0;
    this.needHymn = null;
    this.awaitingCandidates = options.awaitCandidates === true && this.candidates === null;
    this.recognizer = this.awaitingCandidates ? null : new HymnRecognizer(this.candidates ?? candidatesFromHymns(this.hymns));
    // Wat al gehoord is, telt mee: de herkenner loopt eerst het geheugen door (binnen het tijdsbudget).
    this.queue = [...this.buffer];
    this.queueAt = 0;
  }

  /** Volg deze lofzang. Mag midden in een luistersessie; de microfoon en de extractor blijven doorlopen. */
  followHymn(number: number, choice: HymnChoice = "manual"): void {
    const hymn = this.hymns.find((h) => h.number === number);
    if (!hymn) return;
    this.needHymn = null;
    this.hymn = hymn;
    this.choice = choice;
    this.stage = "following";
    this.recognizer = null;
    this.awaitingCandidates = false;
    this.session = new HymnFollowSession(hymn, this.opts.session);
    this.session.setStanzaOrder(this.stanzaOrder);
    // alles wat we hoorden (inclusief het voorspel) door de volger, op volgorde, voor de nieuwe frames
    this.queue = [...this.buffer];
    this.queueAt = 0;
  }

  setStanzaOrder(order: number[]): void {
    this.stanzaOrder = order;
    this.session?.setStanzaOrder(order);
  }

  selectStanza(stanza: number): void {
    this.session?.selectStanza(stanza);
  }

  confirmSingingStart(): void {
    this.session?.confirmSingingStart();
  }

  resync(): void {
    this.session?.resync();
  }

  /** Alles weg voor een nieuwe luistersessie (nieuwe microfoonstart). */
  restart(): void {
    this.extractor?.reset();
    this.extractor = null;
    this.framesProduced = 0;
    this.lastFrame = null;
    this.buffer.length = 0;
    this.queue = [];
    this.queueAt = 0;
    this.session = null;
    this.recognizer = null;
    this.hymn = null;
    this.choice = null;
    this.stage = "idle";
    this.suggestionId = null;
    this.needHymn = null;
    this.awaitingCandidates = false;
    this.lastRecognition = null;
  }

  /** Ruwe samples van de microfoon (of een testbestand). */
  pushAudio(samples: Float32Array, sampleRate: number, budgetMs = 8): void {
    if (!this.extractor || this.extractor.config.sampleRate !== sampleRate) this.extractor = new ChromaExtractor({ sampleRate });
    for (const frame of this.extractor.push(samples)) this.enqueue(frame);
    this.drain(budgetMs);
  }

  /** Eén kenmerkframe (tests en eigen extractie). */
  pushFrame(frame: FeatureFrame): void {
    this.enqueue(frame);
    this.drain(Infinity);
  }

  private enqueue(frame: FeatureFrame): void {
    this.framesProduced += 1;
    this.lastFrame = { silent: frame.silent, rmsDb: frame.rmsDb };
    this.buffer.push(frame);
    const keep = this.opts.bufferSeconds;
    while (this.buffer.length > 1 && frame.time - this.buffer[0].time > keep) this.buffer.shift();
    if (this.stage === "idle") return;
    this.queue.push(frame);
  }

  get backlog(): number {
    return this.queue.length - this.queueAt;
  }

  /** Verwerk wachtende frames binnen `budgetMs`. Geeft true terug als er nog werk over is. */
  drain(budgetMs: number): boolean {
    const start = typeof performance !== "undefined" ? performance.now() : 0;
    while (this.queueAt < this.queue.length) {
      // Bij een overgang is de wachtrij opnieuw gevuld (vanaf het begin van het geheugen): dan niet doortellen.
      if (!this.process(this.queue[this.queueAt])) this.queueAt += 1;
      if (budgetMs !== Infinity && typeof performance !== "undefined" && performance.now() - start > budgetMs) break;
    }
    if (this.queueAt >= this.queue.length) {
      this.queue = [];
      this.queueAt = 0;
    } else if (this.queueAt > 4096) {
      this.queue = this.queue.slice(this.queueAt);
      this.queueAt = 0;
    }
    return this.backlog > 0;
  }

  /** Verwerk alles wat wacht (tests, en het afronden van een testbestand). */
  drainAll(): void {
    this.drain(Infinity);
  }

  /** Verwerkt één frame. Geeft true terug als de wachtrij daarbij opnieuw is opgebouwd (overgang naar volgen). */
  private process(frame: FeatureFrame): boolean {
    if (this.stage === "following" && this.session) {
      this.session.pushFrame(frame);
      return false;
    }
    if (this.stage !== "recognizing" || !this.recognizer) return false;
    const state = this.recognizer.update(frame);
    this.lastRecognition = state;
    if (!this.opts.autoFollow) return false;
    // Alleen automatisch volgen bij een duidelijk voorstel dat even stabiel blijft. Bij meerdere even goede
    // kandidaten ("ambiguous") of te weinig bewijs kiest de engine niet zelf.
    if (state.status === "identified" && state.suggestion) {
      // Dezelfde melodie hoort bij meerdere lofzangen: de muziek kan de tekst niet bepalen, de gebruiker kiest.
      if (state.suggestion.sharedWith.length > 0) return false;
      if (this.suggestionId !== state.suggestion.id) {
        this.suggestionId = state.suggestion.id;
        this.suggestionSince = frame.time;
      } else if (frame.time - this.suggestionSince >= this.opts.stableSeconds) {
        if (!this.hymns.some((h) => h.number === state.suggestion?.number)) {
          // bibliotheekmodus: de tekst moet eerst worden opgehaald; de herkenner blijft intussen luisteren
          this.needHymn = state.suggestion.number;
          return false;
        }
        // followHymn zet de wachtrij opnieuw; de huidige frame zit al in het geheugen en komt daar dus in terug
        this.followHymn(state.suggestion.number, "auto");
        return true;
      }
    } else {
      this.suggestionId = null;
      this.needHymn = null;
    }
    return false;
  }

  state(): LiveState {
    return {
      stage: this.stage,
      hymn: this.hymn,
      choice: this.choice,
      recognition: this.stage === "recognizing" ? (this.recognizer?.state() ?? this.lastRecognition) : null,
      snapshot: this.session?.snapshotNow ?? null,
      backlog: this.backlog,
      needHymn: this.needHymn,
      diag: {
        frames: this.framesProduced,
        lastFrameSilent: this.lastFrame?.silent ?? null,
        lastRmsDb: this.lastFrame ? Math.round(this.lastFrame.rmsDb * 10) / 10 : null,
        candidates: this.candidates?.length ?? 0,
        awaitingCandidates: this.awaitingCandidates,
      },
    };
  }
}
