import { PitchDetector } from "pitchy";

// Grondtoonschatting (McLeod Pitch Method, via Pitchy) voor monofone zang. Dit is AANVULLEND op de toonklassenanalyse
// (chroma) in features.ts, geen vervanging: bij meerstemmig orgel of piano blijft chroma de bron. Pitchy geeft per venster een
// frequentie en een "clarity" (0..1: hoe periodiek het signaal is). Alleen vensters met een hoge clarity binnen het
// zangbereik tellen als gestemd; al het andere is "geen betrouwbare toonhoogte" (hz = 0). Er wordt nooit een toonhoogte verzonnen.
// Octaaffouten van de schatter maken niet uit voor de melodieherkenning, die toonklassen (mod 12) vergelijkt.

export interface PitchEstimate {
  /** Grondtoon in Hz; 0 als er geen betrouwbare toonhoogte is. */
  hz: number;
  /** Clarity van Pitchy (0..1), ook als hz 0 is (voor diagnose). */
  clarity: number;
}

export interface PitchConfig {
  /** Venstergrootte in samples (macht van twee is niet vereist, wel gelijk aan wat de analyser bouwde). */
  windowSize: number;
  minClarity: number;
  minHz: number;
  maxHz: number;
}

export const DEFAULT_PITCH_CONFIG: PitchConfig = { windowSize: 2048, minClarity: 0.88, minHz: 75, maxHz: 1100 };

export class PitchAnalyzer {
  readonly config: PitchConfig;
  private readonly detector: PitchDetector<Float32Array>;

  constructor(config: Partial<PitchConfig> = {}) {
    this.config = { ...DEFAULT_PITCH_CONFIG, ...config };
    this.detector = PitchDetector.forFloat32Array(this.config.windowSize);
  }

  /** `window` heeft precies `config.windowSize` samples. */
  estimate(window: Float32Array, sampleRate: number): PitchEstimate {
    const [hz, clarity] = this.detector.findPitch(window, sampleRate);
    const ok = clarity >= this.config.minClarity && hz >= this.config.minHz && hz <= this.config.maxHz && Number.isFinite(hz);
    return { hz: ok ? hz : 0, clarity };
  }
}

/** Toonhoogte in (fractionele) midinoten. */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}
