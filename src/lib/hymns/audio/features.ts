import { RealFft, hannWindow } from "./fft";

// Lokale audiokenmerken voor het volgen van live orgel- of pianospel. Alles hier werkt op losse
// audiosamples in het geheugen; er wordt niets opgeslagen of verstuurd. De extractor houdt alleen een
// rollend venster van één frame vast en geeft per hop een klein kenmerkframe terug.

/**
 * Indeling van het kenmerk: 12 toonklassen per frequentieband. Standaard twee banden (laag = baspartij en
 * tenor, hoog = alt, sopraan en bovenspelen). De extractor en de referentie MOETEN dezelfde indeling
 * gebruiken; ze krijgen die daarom uit hetzelfde object.
 */
export interface FeatureLayout {
  /** Bandgrenzen in Hz (oplopend); n grenzen geven n+1 banden. */
  splitsHz: number[];
  /** Compressie van de magnitude vóór normalisatie (0,5 = wortel). */
  power: number;
}

export const PITCH_CLASSES = 12;
export const DEFAULT_LAYOUT: FeatureLayout = { splitsHz: [260], power: 0.5 };
export const FEATURE_DIM = PITCH_CLASSES * (DEFAULT_LAYOUT.splitsHz.length + 1);

export function layoutDim(layout: FeatureLayout): number {
  return PITCH_CLASSES * (layout.splitsHz.length + 1);
}

/** Bandnummer van een frequentie. */
export function bandOf(layout: FeatureLayout, hz: number): number {
  let b = 0;
  for (const split of layout.splitsHz) if (hz >= split) b += 1;
  return b;
}

export interface FeatureFrame {
  /** Tijd (seconden sinds start) van het midden van het analysevenster. */
  time: number;
  /** 2 x 12 toonklassen (laag, hoog; C=0), samen L2-genormaliseerd; nullen als er niets bruikbaars klinkt. */
  chroma: Float32Array;
  /** Niveau van het venster in dBFS. */
  rmsDb: number;
  /** Onset-sterkte (positieve spectrale flux over semitoonbanden), 0..~1+. */
  flux: number;
  /** True als het niveau niet boven de (zelflerende) ruisvloer uitkomt: een pauze of stilte. */
  silent: boolean;
}

export interface ChromaConfig {
  sampleRate: number;
  /** Frequentiebereik waarin toonhoogte wordt geteld. Lager dan ~90 Hz is bij deze vensterlengte onbetrouwbaar. */
  minHz: number;
  maxHz: number;
  /** Stemming t.o.v. A=440 in halve tonen (kerkorgels staan soms wat laag of hoog). */
  tuningSemitones: number;
  /** Absolute drempel waaronder alles stilte is. */
  silenceFloorDb: number;
  /** Zo veel dB onder het recente pieklevel geldt als stilte. */
  silenceDropDb: number;
  layout: FeatureLayout;
}

export const DEFAULT_CHROMA_CONFIG: Omit<ChromaConfig, "sampleRate"> = {
  minHz: 90,
  maxHz: 2200,
  tuningSemitones: 0,
  silenceFloorDb: -62,
  silenceDropDb: 30,
  layout: DEFAULT_LAYOUT,
};

const BAND_COUNT = 96; // semitoonbanden vanaf MIDI 24 (C1)

export class ChromaExtractor {
  readonly config: ChromaConfig;
  readonly frameSize: number;
  readonly hopSize: number;
  readonly hopSeconds: number;
  private readonly fft: RealFft;
  private readonly window: Float64Array;
  private readonly ring: Float32Array;
  private ringFill = 0;
  private samplesSeen = 0;
  private readonly buffer: Float64Array;
  private readonly mag: Float64Array;
  private readonly lowBin: number;
  private readonly highBin: number;
  private readonly binPitch: Float64Array;
  private readonly binBand: Uint8Array;
  readonly dim: number;
  private prevBands = new Float64Array(BAND_COUNT);
  private peakDb = -120;

  constructor(config: Partial<ChromaConfig> & { sampleRate: number }) {
    this.config = { ...DEFAULT_CHROMA_CONFIG, ...config };
    const fs = this.config.sampleRate;
    // ~186 ms venster: genoeg frequentie-resolutie voor de lage orgelnoten, hop van een kwart voor reactiesnelheid.
    this.frameSize = 2 ** Math.round(Math.log2(0.186 * fs));
    this.hopSize = this.frameSize / 4;
    this.hopSeconds = this.hopSize / fs;
    this.fft = new RealFft(this.frameSize);
    this.window = hannWindow(this.frameSize);
    this.ring = new Float32Array(this.frameSize);
    this.buffer = new Float64Array(this.frameSize);
    this.mag = new Float64Array(this.frameSize / 2 + 1);
    const binHz = fs / this.frameSize;
    this.lowBin = Math.max(1, Math.ceil(this.config.minHz / binHz));
    this.highBin = Math.min(this.frameSize / 2, Math.floor(this.config.maxHz / binHz));
    this.dim = layoutDim(this.config.layout);
    this.binBand = new Uint8Array(this.highBin + 1);
    this.binPitch = new Float64Array(this.highBin + 1);
    for (let k = this.lowBin; k <= this.highBin; k += 1) {
      this.binPitch[k] = 69 + 12 * Math.log2((k * binHz) / 440) - this.config.tuningSemitones;
      this.binBand[k] = bandOf(this.config.layout, k * binHz);
    }
  }

  /** Voer samples in; geeft de frames terug die daarmee compleet werden. */
  push(samples: Float32Array): FeatureFrame[] {
    const out: FeatureFrame[] = [];
    let i = 0;
    while (i < samples.length) {
      const take = Math.min(this.frameSize - this.ringFill, samples.length - i);
      this.ring.set(samples.subarray(i, i + take), this.ringFill);
      this.ringFill += take;
      this.samplesSeen += take;
      i += take;
      if (this.ringFill === this.frameSize) {
        out.push(this.analyse());
        this.ring.copyWithin(0, this.hopSize);
        this.ringFill = this.frameSize - this.hopSize;
      }
    }
    return out;
  }

  private analyse(): FeatureFrame {
    const n = this.frameSize;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const v = this.ring[i];
      sum += v * v;
      this.buffer[i] = v * this.window[i];
    }
    const rmsDb = 20 * Math.log10(Math.sqrt(sum / n) + 1e-9);
    this.fft.magnitude(this.buffer, this.mag);

    const bands = new Float64Array(BAND_COUNT);
    const chromaRaw = new Float64Array(this.dim);
    for (let k = this.lowBin; k <= this.highBin; k += 1) {
      const pitch = this.binPitch[k];
      const nearest = Math.round(pitch);
      const weight = Math.cos(Math.PI * (pitch - nearest)) ** 2; // een bin tussen twee toonhoogtes telt nauwelijks
      const m = this.mag[k] * weight;
      const band = nearest - 24;
      if (band >= 0 && band < BAND_COUNT) bands[band] += m;
      chromaRaw[this.binBand[k] * PITCH_CLASSES + (((nearest % 12) + 12) % 12)] += m;
    }

    // Onset-sterkte: positieve toename van de gecomprimeerde semitoonbanden.
    let bandMax = 1e-12;
    for (let b = 0; b < BAND_COUNT; b += 1) bandMax = Math.max(bandMax, bands[b]);
    const compressed = new Float64Array(BAND_COUNT);
    let flux = 0;
    for (let b = 0; b < BAND_COUNT; b += 1) {
      compressed[b] = Math.log1p((bands[b] / bandMax) * 30);
      const diff = compressed[b] - this.prevBands[b];
      if (diff > 0) flux += diff;
    }
    this.prevBands = compressed;
    flux /= 12;

    const silent = this.isSilent(rmsDb);
    const chroma = new Float32Array(this.dim);
    if (!silent) {
      let max = 1e-12;
      for (let c = 0; c < this.dim; c += 1) max = Math.max(max, chromaRaw[c]);
      let norm = 0;
      for (let c = 0; c < this.dim; c += 1) {
        const v = (chromaRaw[c] / max) ** this.config.layout.power; // compressie: de sterke harmonischen domineren minder
        chroma[c] = v;
        norm += v * v;
      }
      norm = Math.sqrt(norm) || 1;
      for (let c = 0; c < this.dim; c += 1) chroma[c] /= norm;
    }
    return { time: (this.samplesSeen - n / 2) / this.config.sampleRate, chroma, rmsDb, flux, silent };
  }

  private isSilent(rmsDb: number): boolean {
    // Stilte = ver onder het recente pieklevel (een pauze in het spel) of onder een absolute ondergrens.
    // Het pieklevel zakt langzaam, zodat een lange stilte niet vanzelf weer als geluid gaat tellen.
    this.peakDb = Math.max(rmsDb, this.peakDb - 0.05);
    if (rmsDb < this.config.silenceFloorDb) return true;
    return rmsDb < this.peakDb - this.config.silenceDropDb;
  }

  reset(): void {
    this.ringFill = 0;
    this.samplesSeen = 0;
    this.prevBands.fill(0);
    this.peakDb = -120;
  }
}
