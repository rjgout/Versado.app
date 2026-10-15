// Positiemapping (laag 5): van een muzikale positie in beats naar de maat op het blad. De muziek (score following) weet
// alleen beats; de gravure weet alleen maten. Dit is de enige plek die ze verbindt, zodat een weergave nooit zelf beats omrekent.

export interface BeatMeasure {
  start: number;
  length: number;
}

/** Index van de maat waarin de beat valt; null als de beat buiten de partituur ligt (bv. voor de opmaat). */
export function measureIndexAt(measures: readonly BeatMeasure[], beat: number): number | null {
  if (!Number.isFinite(beat) || measures.length === 0) return null;
  let lo = 0;
  let hi = measures.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = measures[mid];
    if (beat < m.start - 1e-6) hi = mid - 1;
    else if (beat >= m.start + m.length - 1e-6) lo = mid + 1;
    else return mid;
  }
  return null;
}

/** Een maat wordt alleen gemarkeerd bij een betrouwbare positie én als de coupletgravure gevalideerd is; anders geen markering. */
export function markableMeasure(opts: { measures: readonly BeatMeasure[]; beat: number | null; reliable: boolean; validated: boolean }): number | null {
  if (!opts.reliable || !opts.validated || opts.beat === null) return null;
  return measureIndexAt(opts.measures, opts.beat);
}
