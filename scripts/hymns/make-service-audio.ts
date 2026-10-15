// Maakt een synthetische "dienst" (voorspel, eventuele pauze, daarna de samenzang) als WAV voor de nep-microfoon
// van Chromium, met een exact bekende tijdlijn. Aanroep:
//   npx tsx scripts/hymns/make-service-audio.ts <nummer> <uitvoer.wav> <staart|heel|heel-pauze> [rondes]
import { constantTempo } from "../../src/lib/hymns/eval/synth";
import { POC_LIBRARY, resolveHymn } from "../../src/lib/hymns/library";
import { makeService } from "../../tests/helpers/hymnScenario";
import { writeWav } from "./wav";

const [, , numberArg, out, kind = "heel-pauze", lapsArg = "2"] = process.argv;
const hymn = resolveHymn(POC_LIBRARY, Number(numberArg));
if (!hymn || !out) throw new Error("Gebruik: make-service-audio.ts <24|36|82> <uitvoer.wav> <staart|heel|heel-pauze> [rondes]");
const cycle = hymn.composition.totalBeats;
const tempo = { tempoSegments: constantTempo(90), timbre: "organ" as const, reverbSeconds: 1.2, noiseDb: -30 };
const sv = makeService(
  hymn.number,
  [
    { options: { ...tempo, startBeat: kind === "staart" ? cycle * 0.66 : 0 } },
    { gapBefore: kind === "heel-pauze" ? 2.5 : 0, options: { ...tempo, singersDb: -6, laps: Number(lapsArg) } },
  ],
  {},
  2
);
// Chromium verwacht een 48 kHz-opname: lineair opwaarderen van 22,05 kHz.
const from = 22050;
const to = 48000;
const resampled = new Float32Array(Math.floor((sv.samples.length * to) / from));
for (let i = 0; i < resampled.length; i += 1) {
  const x = (i * from) / to;
  const a = Math.floor(x);
  const f = x - a;
  resampled[i] = sv.samples[a] * (1 - f) + (sv.samples[Math.min(sv.samples.length - 1, a + 1)] ?? 0) * f;
}
writeWav(out, resampled, to);
console.log(`${out}: ${sv.duration.toFixed(1)} s; voorspel ${sv.partStart[0].toFixed(1)}-${sv.partEnd[0].toFixed(1)} s, zang vanaf ${sv.partStart[1].toFixed(1)} s`);
