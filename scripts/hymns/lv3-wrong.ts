// Lofzangen V3: wat doet de volger als er een ANDERE lofzang gezongen wordt dan de gekozen (of een verkeerde automatische herkenning
// gevolgd wordt), of als er alleen ruis en gebabbel klinkt? De markering hoort dan niet te doen alsof er iets herkend wordt.
//   npx tsx scripts/hymns/lv3-wrong.ts --count 12 --seconds 45 [--out docs/hymns/v3/wrong-follow.json]
// Gemeten per scenario: aandeel van de tijd (na 10 s luisteren) waarin een woord of regel gemarkeerd staat (niet bevroren) en waarin de
// status "locked" is. Lager is beter; bij juiste lofzang (zelfde audio) staan dezelfde maten ter vergelijking.
import { writeFileSync } from "node:fs";
import { constantTempo, synthesizeHymn, type SynthOptions } from "../../src/lib/hymns/eval/synth";
import { extractFrames } from "../../src/lib/hymns/eval/harness";
import { HymnFollowSession } from "../../src/lib/hymns/follow/session";
import { loadRecognitionBundle, loadResolvedHymn } from "../../src/lib/hymns/library/server";

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const COUNT = Number(flag("count", "12"));
const SECONDS = Number(flag("seconds", "45"));
const CFG = JSON.parse(flag("cfg", "{}") as string);
const ONLY = flag("scenarios") ? new Set((flag("scenarios") as string).split(",")) : null;
const V = (o: NonNullable<SynthOptions["voice"]>) => o;
const SCEN: Record<string, Partial<SynthOptions>> = {
  solo: { voiceOnly: true, voice: V({ singers: 1, vibratoCents: 20, intonationCents: 25 }) },
  "solo-laag": { voiceOnly: true, voice: V({ singers: 1, registerShift: -12, vibratoCents: 20, intonationCents: 25 }) },
  "solo-andere-toonsoort": { voiceOnly: true, voice: V({ singers: 1, registerShift: -5, vibratoCents: 20, intonationCents: 25, driftCents: -40 }) },
  groep: { voiceOnly: true, voice: V({ singers: 6, vibratoCents: 40, intonationCents: 40, lagSeconds: 0.18, octaveJumpProbability: 0.2 }) },
  piano: { timbre: "piano" },
  "ruis+gebabbel": { voiceOnly: false, timbre: "piano", noiseDb: -10, chatterDb: 0, singersDb: -40 },
};
const bundle = loadRecognitionBundle();
const groups = new Map<string, number[]>();
for (const m of bundle.members) groups.set(m.compositionId, [...(groups.get(m.compositionId) ?? []), m.number]);
const withMelody = [...groups.entries()].filter(([id]) => bundle.melodies[id]).map(([, g]) => g[0]);
const step = Math.max(1, Math.floor(withMelody.length / COUNT));
const picks = withMelody.filter((_, i) => i % step === 0).slice(0, COUNT);

interface Row { scenario: string; kind: "juist" | "verkeerd"; audioHymn: number; followed: number; marked: number; locked: number; source: string; qMean: number; cMean: number; confMean: number; vMean: number }
const rows: Row[] = [];
for (const name of Object.keys(SCEN).filter((n) => !ONLY || ONLY.has(n))) {
  picks.forEach((num, i) => {
    const hymn = loadResolvedHymn(num)!;
    const synth = synthesizeHymn(hymn.composition, { sampleRate: 22050, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.5, seed: num, ...SCEN[name] });
    const frames = extractFrames(synth.samples.subarray(0, Math.min(synth.samples.length, SECONDS * 22050)), 22050);
    for (const kind of name === "ruis+gebabbel" ? (["verkeerd"] as const) : (["juist", "verkeerd"] as const)) {
      const follow = kind === "juist" ? hymn : loadResolvedHymn(picks[(i + 1) % picks.length])!;
      const session = new HymnFollowSession(follow, CFG);
      let n = 0, marked = 0, locked = 0, wordMarked = 0, qs = 0, cs = 0, confs = 0, vs = 0;
      let src = "full";
      for (const f of frames) {
        const s = session.pushFrame(f);
        if (f.time < 10) continue;
        n += 1;
        if (s.cursor.line >= 0 && !s.cursor.frozen) marked += 1;
        if (s.cursor.word !== null && !s.cursor.frozen) wordMarked += 1;
        if (s.status === "locked") locked += 1;
        src = s.trackSource ?? "full";
        // diagnose: de ruwe kwaliteit en concentratie waaruit het vertrouwen volgt (privé velden van de sessie)
        qs += (session as unknown as { quality: number }).quality; cs += (session as unknown as { concEma: number }).concEma; confs += s.confidence; vs += (session as unknown as { tracker: { voice?: { voicedShare: number } } }).tracker.voice?.voicedShare ?? 0;
      }
      void wordMarked;
      rows.push({ scenario: name, kind, audioHymn: num, followed: follow.number, marked: marked / Math.max(1, n), locked: locked / Math.max(1, n), source: src, qMean: qs / Math.max(1, n), cMean: cs / Math.max(1, n), confMean: confs / Math.max(1, n), vMean: vs / Math.max(1, n) });
    }
    process.stderr.write(".");
  });
  process.stderr.write(` ${name}\n`);
}
const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const summary = Object.keys(SCEN).filter((n) => !ONLY || ONLY.has(n)).flatMap((name) => (["juist", "verkeerd"] as const).map((kind) => {
  const r = rows.filter((x) => x.scenario === name && x.kind === kind);
  return r.length ? { scenario: name, kind, n: r.length, markedMedian: med(r.map((x) => x.marked)), markedMean: mean(r.map((x) => x.marked)), markedMax: Math.max(...r.map((x) => x.marked)), lockedMean: mean(r.map((x) => x.locked)), qMedian: med(r.map((x) => x.qMean)), cMedian: med(r.map((x) => x.cMean)), confMedian: med(r.map((x) => x.confMean)) } : null;
})).filter(Boolean);
console.log(JSON.stringify(summary, null, 1));
if (flag("out")) writeFileSync(flag("out")!, JSON.stringify({ summary, rows }, null, 1));
