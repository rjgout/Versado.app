// Diagnose van de woordmarkering: per seconde de toestand van de volger naast de waarheid, voor één scenario en lofzang.
//   npx tsx scripts/hymns/lv3-words-diag.ts --scenario groep --hymn 98 [--seconds 40] [--variant v3|base]
import { constantTempo, synthesizeHymn, type SynthOptions } from "../../src/lib/hymns/eval/synth";
import { extractFrames } from "../../src/lib/hymns/eval/harness";
import { wordTruth } from "../../src/lib/hymns/eval/words";
import { HymnFollowSession } from "../../src/lib/hymns/follow/session";
import { loadResolvedHymn } from "../../src/lib/hymns/library/server";

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const V = (o: NonNullable<SynthOptions["voice"]>) => o;
const SCEN: Record<string, Partial<SynthOptions>> = {
  solo: { voiceOnly: true, voice: V({ singers: 1, vibratoCents: 20, intonationCents: 25 }) },
  groep: { voiceOnly: true, voice: V({ singers: 6, vibratoCents: 40, intonationCents: 40, lagSeconds: 0.18, octaveJumpProbability: 0.2 }) },
};
const hymn = loadResolvedHymn(Number(flag("hymn", "98")))!;
const synth = synthesizeHymn(hymn.composition, { sampleRate: 22050, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.5, seed: hymn.number, ...SCEN[flag("scenario", "groep")!] });
const truth = wordTruth(hymn.text, synth);
const frames = extractFrames(synth.samples.subarray(0, Math.floor(Number(flag("seconds", "40")) * 22050)), 22050);
const session = new HymnFollowSession(hymn, flag("variant", "v3") === "base" ? { melodyTracking: false } : {});
const idx = new Map(truth.map((t, i) => [`${t.line}:${t.word}`, i]));
// privé velden van de sessie, alleen voor diagnose
const priv = session as unknown as { aboveLock: number; quality: number; concEma: number };
let next = 0;
for (const f of frames) {
  const s = session.pushFrame(f);
  if (f.time < next) continue;
  next = f.time + Number(flag("every", "1"));
  let sung = -1;
  for (let i = 0; i < truth.length && truth[i].start <= f.time; i += 1) sung = i;
  const c = s.cursor;
  const marked = c.section === "verse" && c.word !== null ? (idx.get(`${c.line}:${c.word}`) ?? "?") : "-";
  console.log(`${f.time.toFixed(0).padStart(3)}s phase=${s.phase.phase.padEnd(8)} src=${(s.trackSource ?? "-").padEnd(6)} st=${s.status.padEnd(9)} conf=${s.confidence.toFixed(2)} pos=${s.position.toFixed(1).padStart(5)} sungWord=${String(sung).padStart(3)} marked=${String(marked).padStart(3)} above=${priv.aboveLock.toFixed(2)} q=${priv.quality.toFixed(3)} ce=${priv.concEma.toFixed(2)} frozen=${c.frozen ? 1 : 0} est=${c.estimated ? 1 : 0}`);
}
console.log("firstTruth", truth[0].start.toFixed(1), "words", truth.length);
