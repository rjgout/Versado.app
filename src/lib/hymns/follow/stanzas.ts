// Coupletselectie en muzikale positie zijn TWEE afzonderlijke toestanden.
//
// De muziek herhaalt dezelfde melodie voor elk couplet; uit het orgelspel alleen valt dus niet af te leiden
// welk couplet de gemeente zingt. Daarom geldt:
//  - de muziekengine levert alleen "positie in de cyclus" en "er is een nieuwe ronde begonnen";
//  - dit object bepaalt welk couplet wordt getoond;
//  - een handmatige keuze heeft altijd voorrang en wordt nooit door een automatische keuze teruggedraaid;
//  - automatisch doorschakelen gebeurt alleen op een betrouwbaar herkende rondegrens, naar het volgende
//    couplet uit de gekozen volgorde, en nooit "terug".

export interface StanzaChange {
  stanza: number;
  reason: "start" | "manual" | "auto-lap" | "order";
}

export class StanzaPlan {
  private readonly available: number[];
  private selected: number[];
  private shown: number;
  private autoAdvance = true;
  private manualAtLap: number | null = null;

  constructor(stanzaNumbers: number[]) {
    this.available = [...stanzaNumbers].sort((a, b) => a - b);
    this.selected = [...this.available];
    this.shown = this.selected[0] ?? 1;
  }

  /** Het couplet dat nu wordt getoond. */
  get current(): number {
    return this.shown;
  }

  /** De gekozen volgorde (bijvoorbeeld [1, 4]). */
  get order(): readonly number[] {
    return this.selected;
  }

  get stanzas(): readonly number[] {
    return this.available;
  }

  get isCustomOrder(): boolean {
    return this.selected.length !== this.available.length;
  }

  setAutoAdvance(on: boolean): void {
    this.autoAdvance = on;
  }

  /**
   * Kies de coupletvolgorde. Een leeg of ongeldig verzoek betekent "alle coupletten". Het getoonde couplet
   * verandert hier niet: de gebruiker blijft lezen waar hij leest.
   */
  setOrder(order: number[]): void {
    const valid = Array.from(new Set(order)).filter((n) => this.available.includes(n));
    this.selected = valid.length > 0 ? valid : [...this.available];
  }

  /** De gebruiker tikt op een coupletnummer: onmiddellijk tonen; de muziekherkenning merkt hier niets van. */
  selectManual(stanza: number, lap: number): StanzaChange | null {
    if (!this.available.includes(stanza)) return null;
    this.shown = stanza;
    this.manualAtLap = lap;
    return { stanza, reason: "manual" };
  }

  /**
   * Er is een nieuwe ronde van de melodie begonnen (betrouwbaar herkend). Ga naar het volgende couplet
   * uit de gekozen volgorde, gerekend vanaf het couplet dat nu wordt getoond (dus ook na een handmatige
   * keuze). Aan het eind van de volgorde blijft het laatste couplet staan: er wordt nooit teruggesprongen.
   */
  onNewLap(lap: number): StanzaChange | null {
    if (!this.autoAdvance) return null;
    // Een handmatige keuze in dezelfde ronde als deze rondegrens (gebruiker was net iets eerder) wordt niet
    // meteen weer overschreven.
    if (this.manualAtLap !== null && this.manualAtLap >= lap) return null;
    const next = this.selected.find((n) => n > this.shown);
    if (next === undefined) return null;
    this.shown = next;
    return { stanza: next, reason: "auto-lap" };
  }

  /** Terug naar het begin (bijvoorbeeld bij opnieuw starten van de microfoon). */
  reset(): void {
    this.shown = this.selected[0] ?? this.available[0] ?? 1;
    this.manualAtLap = null;
  }
}
