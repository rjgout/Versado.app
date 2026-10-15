import type { HymnComposition } from "../types";
import { DEFAULT_CHROMA_CONFIG, DEFAULT_LAYOUT, PITCH_CLASSES, bandOf, layoutDim, type FeatureLayout } from "../audio/features";

// Referentiekenmerken: wat de partituur "zou laten klinken" op elk punt van de cyclus, uitgedrukt in
// dezelfde 12 toonklassen als de gemeten audio. Dit is AFGELEID van de noten (nooit een opname) en hangt
// dus niet af van een tempo of een uitvoering: de tijdas is de partituur zelf (in kwartnoten).

export interface Reference {
  compositionId: string;
  /** Lengte van één cyclus (couplet + eventueel refrein) in beats. */
  cycleBeats: number;
  stepBeats: number;
  steps: number;
  /** Lengte van een kenmerkvector (12 per band). */
  dim: number;
  /** steps x dim, per stap L2-genormaliseerd (nullen als er niets klinkt). */
  chroma: Float32Array;
  /** Beats waarop minstens één noot begint (alle stemmen). */
  onsets: number[];
  fermatas: number[];
  /** Fermate-vensters [begin, einde) in beats waarin een uitvoering mag blijven hangen. */
  fermataWindows: [number, number][];
  /** Nominale tempo in beats per seconde (midden van de aanwijzing, anders 80 bpm). */
  nominalBeatsPerSecond: number;
  sections: HymnComposition["sections"];
}

export interface ReferenceOptions {
  stepBeats?: number;
  partials?: number;
  /** Uitsmeren van de referentie over een klein tijdvenster (beats), omdat een gemeten frame ~0,19 s middelt. */
  blurBeats?: number;
  layout?: FeatureLayout;
}

function midiHz(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

export function buildReference(comp: HymnComposition, options: ReferenceOptions = {}): Reference {
  const stepBeats = options.stepBeats ?? 1 / 8;
  const partials = options.partials ?? 8;
  const blur = options.blurBeats ?? 0.25;
  const layout = options.layout ?? DEFAULT_LAYOUT;
  const FEATURE_DIM = layoutDim(layout);
  const cycle = comp.totalBeats;
  const steps = Math.round(cycle / stepBeats);
  const raw = new Float64Array(steps * FEATURE_DIM);

  for (const [t, dur, midi] of comp.notes) {
    const from = Math.max(0, Math.floor(t / stepBeats));
    // Een noot klinkt tot zijn einde; de laatste noot van de cyclus eindigt op de cyclusgrens.
    const to = Math.min(steps, Math.ceil((t + dur) / stepBeats - 1e-9));
    for (let h = 1; h <= partials; h += 1) {
      const hz = midiHz(midi) * h;
      if (hz < DEFAULT_CHROMA_CONFIG.minHz || hz > DEFAULT_CHROMA_CONFIG.maxHz) continue;
      const pc = (((midi + Math.round(12 * Math.log2(h))) % 12) + 12) % 12;
      const amp = 1 / h;
      const bandOffset = bandOf(layout, hz) * PITCH_CLASSES;
      for (let s = from; s < to; s += 1) raw[s * FEATURE_DIM + bandOffset + pc] += amp;
    }
  }

  // uitsmeren over ±blur beats (cyclisch), daarna normaliseren zoals de gemeten chroma
  const radius = Math.max(0, Math.round(blur / stepBeats));
  const smoothed = new Float64Array(steps * FEATURE_DIM);
  for (let s = 0; s < steps; s += 1) {
    for (let d = -radius; d <= radius; d += 1) {
      const src = (((s + d) % steps) + steps) % steps;
      const w = 1 - Math.abs(d) / (radius + 1);
      for (let c = 0; c < FEATURE_DIM; c += 1) smoothed[s * FEATURE_DIM + c] += raw[src * FEATURE_DIM + c] * w;
    }
  }
  const chroma = new Float32Array(steps * FEATURE_DIM);
  for (let s = 0; s < steps; s += 1) {
    let max = 0;
    for (let c = 0; c < FEATURE_DIM; c += 1) max = Math.max(max, smoothed[s * FEATURE_DIM + c]);
    if (max <= 0) continue;
    let norm = 0;
    for (let c = 0; c < FEATURE_DIM; c += 1) {
      const v = (smoothed[s * FEATURE_DIM + c] / max) ** layout.power;
      chroma[s * FEATURE_DIM + c] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    for (let c = 0; c < FEATURE_DIM; c += 1) chroma[s * FEATURE_DIM + c] /= norm;
  }

  const onsets = Array.from(new Set(comp.notes.map((n) => Math.round(n[0] * 1000) / 1000))).sort((a, b) => a - b);
  const fermataWindows: [number, number][] = comp.fermatas.map((f) => {
    const longest = comp.notes.filter((n) => Math.abs(n[0] - f) < 1e-6).reduce((m, n) => Math.max(m, n[1]), 1);
    return [f - 0.25, f + longest + 0.25];
  });
  const bpm = comp.tempoQuarterBpm ? (comp.tempoQuarterBpm[0] + comp.tempoQuarterBpm[1]) / 2 : 80;
  return {
    compositionId: comp.id,
    cycleBeats: cycle,
    stepBeats,
    steps,
    dim: FEATURE_DIM,
    chroma,
    onsets,
    fermatas: comp.fermatas,
    fermataWindows,
    nominalBeatsPerSecond: bpm / 60,
    sections: comp.sections,
  };
}

/** Index van de referentiestap voor een positie (cyclisch). */
export function stepIndex(ref: Reference, beat: number): number {
  const wrapped = ((beat % ref.cycleBeats) + ref.cycleBeats) % ref.cycleBeats;
  return Math.min(ref.steps - 1, Math.floor(wrapped / ref.stepBeats));
}
