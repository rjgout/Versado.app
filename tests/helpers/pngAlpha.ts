import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/**
 * Minimale PNG-lezer voor tests: alleen het alphakanaal van een 8-bit RGBA-
 * bestand zonder interlacing (zo staan alle spelsprites). Geen dependency
 * nodig; een ander formaat geeft een duidelijke fout in plaats van rommel.
 */
export function readPngAlpha(file: string): { width: number; height: number; alpha: Uint8Array } {
  const png = readFileSync(file);
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is geen PNG`);
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error(`${file}: alleen 8-bit RGBA zonder interlacing wordt ondersteund`);
    } else if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const alpha = new Uint8Array(width * height);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? line[i - 4] : 0;
      const up = previous[i];
      const upLeft = i >= 4 ? previous[i - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[i] = (line[i] + predictor) & 0xff;
    }
    for (let x = 0; x < width; x++) alpha[y * width + x] = line[x * 4 + 3];
    previous = line;
  }
  return { width, height, alpha };
}

/** Schaalt het ondoorzichtige silhouet (alpha > 128) naar een raster van `size` x `size` wereldpixels met `scale`x supersampling. */
export function opaqueGrid(file: string, size: number, scale: number): { grid: Uint8Array; cells: number; bounds: { left: number; top: number; right: number; bottom: number } } {
  const { width, height, alpha } = readPngAlpha(file);
  const cells = size * scale;
  const grid = new Uint8Array(cells * cells);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      // gemiddelde alpha van het bronblok dat bij deze cel hoort
      const x0 = Math.floor((cx * width) / cells), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / cells));
      const y0 = Math.floor((cy * height) / cells), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / cells));
      let sum = 0, count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += alpha[y * width + x]; count++; }
      if (sum / count > 128) {
        grid[cy * cells + cx] = 1;
        left = Math.min(left, cx); right = Math.max(right, cx + 1); top = Math.min(top, cy); bottom = Math.max(bottom, cy + 1);
      }
    }
  }
  return { grid, cells, bounds: { left: left / scale, top: top / scale, right: right / scale, bottom: bottom / scale } };
}
