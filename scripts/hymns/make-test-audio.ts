// Maakt synthetische testopnamen (WAV) van een proeflofzang, met bekende tijdlijn.
// Bedoeld voor handmatige tests en de nep-microfoon van Chromium:
//   chromium --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=<bestand>.wav%noloop
// Aanroep: npx tsx scripts/hymns/make-test-audio.ts <nummer> <uitvoer.wav> [bpm] [rondes] [samplefrequentie]
import { constantTempo, synthesizeHymn } from "../../src/lib/hymns/eval/synth";
import { POC_LIBRARY, resolveHymn } from "../../src/lib/hymns/library";
import { writeWav } from "./wav";

const [, , numberArg, out, bpmArg, lapsArg, rateArg] = process.argv;
const hymn = resolveHymn(POC_LIBRARY, Number(numberArg));
if (!hymn || !out) throw new Error("Gebruik: make-test-audio.ts <24|36|82> <uitvoer.wav> [bpm] [rondes] [samplefrequentie]");
const sampleRate = Number(rateArg ?? 48000);
const s = synthesizeHymn(hymn.composition, {
  sampleRate,
  laps: Number(lapsArg ?? 2),
  timbre: "organ",
  tempoSegments: constantTempo(Number(bpmArg ?? 90)),
  leadInSeconds: 1.0,
  reverbSeconds: 1.2,
  noiseDb: -30,
  seed: hymn.number,
});
writeWav(out, s.samples, sampleRate);
console.log(`${out}: ${s.duration.toFixed(1)} s, ${sampleRate} Hz, ${hymn.composition.totalBeats * Number(lapsArg ?? 2)} beats`);
