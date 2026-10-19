// CPU-kosten per seconde audio van de V3-onderdelen, op een rustige machine (geen andere meting tegelijk):
//   npx tsx scripts/hymns/lv3-bench.ts [--seconds 60]
// Meet: extractor zonder en met pitchanalyse; een volg-sessie zonder en met melodievolger (hybride); de herkenner met en zonder melodie.
import { ChromaExtractor } from "../../src/lib/hymns/audio/features";
import { constantTempo, synthesizeHymn } from "../../src/lib/hymns/eval/synth";
import { HymnFollowSession } from "../../src/lib/hymns/follow/session";
import { candidatesFromBundle } from "../../src/lib/hymns/recognize/candidates";
import { HymnRecognizer } from "../../src/lib/hymns/recognize/recognizer";
import { extractFrames } from "../../src/lib/hymns/eval/harness";
import { loadRecognitionBundle, loadResolvedHymn } from "../../src/lib/hymns/library/server";

const args = process.argv.slice(2);
const SECONDS = Number(args[args.indexOf("--seconds") + 1] || 60);
const SR = 22050;
const hymn = loadResolvedHymn(98)!;
const synth = synthesizeHymn(hymn.composition, { sampleRate: SR, laps: 2, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.5, seed: 98, voiceOnly: true, voice: { singers: 1, vibratoCents: 20, intonationCents: 25 } });
const audio = synth.samples.subarray(0, SECONDS * SR);
const secs = audio.length / SR;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const time = (fn: () => void, runs = 3) => median(Array.from({ length: runs }, () => { const t = performance.now(); fn(); return ((performance.now() - t) / secs); }));

const out: Record<string, number> = {};
const extract = (pitch: boolean) => () => { const ex = new ChromaExtractor({ sampleRate: SR, pitch }); for (let i = 0; i < audio.length; i += 4096) ex.push(audio.subarray(i, i + 4096)); };
out.extractorMsPerAudioSecond_noPitch = time(extract(false));
out.extractorMsPerAudioSecond_pitch = time(extract(true));
const frames = extractFrames(audio, SR);
const follow = (melody: boolean) => () => { const s = new HymnFollowSession(melody ? hymn : { ...hymn, melody: null }, melody ? {} : { melodyTracking: false }); for (const f of frames) s.pushFrame(f); };
out.followMsPerAudioSecond_fullOnly = time(follow(false));
out.followMsPerAudioSecond_hybrid = time(follow(true));
const bundle = loadRecognitionBundle();
const withMelody = candidatesFromBundle(bundle);
const withoutMelody = withMelody.map(({ melody: _m, ...rest }) => rest);

const recog = (cands: typeof withMelody) => () => { const r = new HymnRecognizer(cands); for (const f of frames) r.update(f); };
out.recognizerMsPerAudioSecond_chromaOnly = time(recog(withoutMelody as typeof withMelody), 2);
out.recognizerMsPerAudioSecond_withMelody = time(recog(withMelody), 2);
console.log(JSON.stringify({ audioSeconds: secs, ...Object.fromEntries(Object.entries(out).map(([k, v]) => [k, +v.toFixed(2)])) }, null, 1));

