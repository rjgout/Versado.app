// Kleine radix-2 FFT zonder afhankelijkheden. De engine draait volledig lokaal (ook in een
// AudioWorklet-omgeving of Node-test), dus er is bewust geen externe bibliotheek of WebAssembly nodig:
// een frame van 8192 punten kost ruwweg 0,5 miljoen bewerkingen, ongeveer 20 keer per seconde.

export class RealFft {
  readonly size: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(size: number) {
    if (size < 4 || (size & (size - 1)) !== 0) throw new Error("FFT-grootte moet een macht van 2 zijn");
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i += 1) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i += 1) {
      let r = 0;
      for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
  }

  /** Magnitudespectrum (size/2 + 1 bins) van een reëel, al gevensterd signaal. */
  magnitude(input: ArrayLike<number>, out: Float64Array): void {
    const n = this.size;
    const { re, im, rev, cos, sin } = this;
    for (let i = 0; i < n; i += 1) {
      re[rev[i]] = input[i];
      im[rev[i]] = 0;
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0; k < half; k += 1) {
          const wr = cos[k * step];
          const wi = sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    for (let k = 0; k <= n / 2; k += 1) out[k] = Math.hypot(re[k], im[k]);
  }
}

export function hannWindow(size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i += 1) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return w;
}
