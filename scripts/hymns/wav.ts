import { readFileSync, writeFileSync } from "node:fs";

/** Leest een mono 16-bit PCM-WAV (zoals `ffmpeg -ac 1 -ar 22050` die maakt). Alleen voor tests en scripts. */
export function readWav(path: string): { sampleRate: number; samples: Float32Array } {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("Geen WAV-bestand");
  let offset = 12;
  let sampleRate = 0;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      if (bits !== 16 || channels !== 1) throw new Error("Alleen mono 16-bit PCM wordt ondersteund");
      const n = Math.min(size, buf.length - offset - 8) / 2;
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i += 1) samples[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768;
      return { sampleRate, samples };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("Geen data-chunk gevonden");
}

/** Schrijft mono 16-bit PCM als WAV (voor testbestanden en de nep-microfoon van Chromium). */
export function writeWav(path: string, samples: Float32Array, sampleRate: number): void {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write("RIFF", 0, "ascii");
  data.writeUInt32LE(36 + samples.length * 2, 4);
  data.write("WAVEfmt ", 8, "ascii");
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36, "ascii");
  data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  writeFileSync(path, data);
}
