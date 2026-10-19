// Lofzangen V3: reproduceerbare metingen op synthetische opnamen met een bekende tijdlijn, over de VOLLEDIGE bibliotheek.
// Eén script voor baseline én verbeteringen: het draait de huidige code van de engine (HymnLiveEngine), zodat een meting vóór en
// na een wijziging dezelfde opstelling gebruikt.
//
//   npx tsx scripts/hymns/lv3-eval.ts --mode recognize --count 24 --seconds 45 --out docs/hymns/v3/recognize-baseline.json
//   npx tsx scripts/hymns/lv3-eval.ts --mode follow --count 12 --seconds 60
//   --scenarios piano,solo,group   (komma's; zie SCENARIOS)
//
// Let op: de synthetische zang volgt de melodie die de synthese zelf afleidt (hoogste stem van de G-balk). Dat is dezelfde
// aanname als de melodiereconstructie; voor een onafhankelijke test zijn echte zangopnamen nodig (zie docs/hymns/v3).
import { writeFileSync } from "node:fs";
import { DEFAULT_CHROMA_CONFIG } from "../../src/lib/hymns/audio/features";
import { HymnLiveEngine } from "../../src/lib/hymns/live";
import { constantTempo, synthesizeHymn, type SynthOptions } from "../../src/lib/hymns/eval/synth";
import { cyclicError } from "../../src/lib/hymns/eval/harness";
import { loadRecognitionBundle, loadResolvedHymn } from "../../src/lib/hymns/library/server";
import type { RecognitionCandidate } from "../../src/lib/hymns/recognize/recognizer";
import type { ResolvedHymn } from "../../src/lib/hymns/types";

const args = process.argv.slice(2);
const flag = (name: string, def?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1]?.startsWith("--") || args[i + 1] === undefined ? "1" : args[i + 1]) : def;
};
const MODE = flag("mode", "recognize") as "recognize" | "follow";
const COUNT = Number(flag("count", "24"));
const SECONDS = Number(flag("seconds", "45"));
// Baseline zonder pitchanalyse: meet de ongewijzigde pijplijn (zonder de extra CPU-kosten van V3).
if (flag("no-pitch")) DEFAULT_CHROMA_CONFIG.pitch = false;
const SR = 22050;
const BPM = Number(flag("bpm", "80"));
const OFFSET = Number(flag("offset", "0"));
// Onbekende melodie: de lofzang zelf ontbreekt in de kandidaten; elke uitspraak is dan een valse herkenning.
const LEAVE_OUT = Boolean(flag("leave-out"));

type Scenario = { name: string; options: Partial<SynthOptions> };
const SCENARIOS: Scenario[] = [
  { name: "piano", options: { timbre: "piano" } },
  { name: "orgel", options: { timbre: "organ" } },
  { name: "solo", options: { voiceOnly: true, voice: { singers: 1, vibratoCents: 20, intonationCents: 25 } } },
  { name: "solo-laag", options: { voiceOnly: true, voice: { singers: 1, registerShift: -12, vibratoCents: 20, intonationCents: 25 } } },
  { name: "solo-andere-toonsoort", options: { voiceOnly: true, voice: { singers: 1, registerShift: -5, vibratoCents: 20, intonationCents: 25, driftCents: -40 } } },
  { name: "groep", options: { voiceOnly: true, voice: { singers: 6, vibratoCents: 40, intonationCents: 40, lagSeconds: 0.18, octaveJumpProbability: 0.2 } } },
  { name: "groep-4stemmig", options: { voiceOnly: true, voice: { singers: 4, voicing: "chords", vibratoCents: 40, intonationCents: 30, lagSeconds: 0.15 } } },
  { name: "solo-ademhaling", options: { voiceOnly: true, breaths: { everyMeasures: 4, seconds: 0.6, jitterSeconds: 0.5 }, voice: { singers: 1, vibratoCents: 25, intonationCents: 25 } } },
  { name: "solo+ruis", options: { voiceOnly: true, noiseDb: -14, voice: { singers: 1, vibratoCents: 20, intonationCents: 25 } } },
  { name: "solo+piano", options: { timbre: "piano", singersDb: -3, voice: { singers: 1, intonationCents: 25, vibratoCents: 20 } } },
  { name: "gemeente+orgel", options: { timbre: "organ", singersDb: -6, voice: { singers: 6, intonationCents: 35, vibratoCents: 35 } } },
  { name: "ruis+gebabbel", options: { voiceOnly: false, timbre: "piano", noiseDb: -10, chatterDb: 0, singersDb: -40 } },
];
const wanted = new Set((flag("scenarios", "") ?? "").split(",").filter(Boolean));
const scenarios = wanted.size ? SCENARIOS.filter((s) => wanted.has(s.name)) : SCENARIOS;

const bundle = loadRecognitionBundle();
const compById = new Map(bundle.compositions.map((c) => [c.id, c]));
const groups = new Map<string, typeof bundle.members>();
for (const m of bundle.members) groups.set(m.compositionId, [...(groups.get(m.compositionId) ?? []), m]);
const candidates: RecognitionCandidate[] = [...groups.entries()].map(([id, g]) => ({
  id,
  number: g[0].number,
  title: g[0].title,
  composition: compById.get(id)!,
  sharedWith: g.slice(1).map((m) => ({ number: m.number, title: m.title })),
  // Gecontroleerde melodie voor herkenning van zang (zoals candidatesFromBundle in de app); met --no-melody de oude situatie.
  ...(flag("no-melody") ? {} : { melody: bundle.melodies[id] }),
}));
// Gelijkmatig verdeelde steekproef uit de composities (elke compositie één keer; de eerste lofzang van de groep is de bron).
const sample = [...groups.values()].filter((_, i) => i % Math.max(1, Math.floor(groups.size / COUNT)) === OFFSET % Math.max(1, Math.floor(groups.size / COUNT))).slice(0, COUNT);

const hymnCache = new Map<number, ResolvedHymn>();
const hymnOf = (n: number): ResolvedHymn => {
  let h = hymnCache.get(n);
  if (!h) {
    h = loadResolvedHymn(n)!;
    hymnCache.set(n, h);
  }
  return h;
};

interface Row {
  scenario: string;
  hymn: number;
  /** recognize: seconden tot automatisch volgen begon; null = nooit. */
  secondsToFollow: number | null;
  wrong: boolean;
  /** follow: aandeel frames binnen 1 beat nadat de volger 10 s luisterde (buiten pauzes). */
  within1: number | null;
  medianErrMs: number | null;
  /** Verwerkingstijd per seconde audio (ms). */
  cpuMsPerAudioSecond: number;
  note?: string;
}
const rows: Row[] = [];
const quant = (a: number[], p: number): number | null => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);

for (const sc of scenarios) {
  for (const group of sample) {
    const member = group[0];
    const hymn = hymnOf(member.number);
    const T = hymn.composition.totalBeats;
    const synth = synthesizeHymn(hymn.composition, { sampleRate: SR, laps: 1, timbre: "piano", tempoSegments: constantTempo(BPM), leadInSeconds: 0.5, seed: member.number, ...sc.options });
    const audio = synth.samples.subarray(0, Math.min(synth.samples.length, Math.floor(SECONDS * SR)));
    const accept = new Set(group.map((g) => g.number));
    const engine = new HymnLiveEngine([], { autoFollow: true });
    engine.setCandidates(LEAVE_OUT ? candidates.filter((c) => c.id !== member.compositionId) : candidates);
    if (MODE === "recognize") engine.startRecognizing();
    else {
      engine.registerHymn(hymn);
      engine.followHymn(member.number, "manual");
    }
    let followAt: number | null = null;
    let wrong = false;
    const errs: number[] = [];
    const errMs: number[] = [];
    let cpu = 0;
    for (let i = 0; i < audio.length; i += 4096) {
      const chunk = audio.subarray(i, Math.min(audio.length, i + 4096));
      const t0 = performance.now();
      engine.pushAudio(chunk, SR, Infinity);
      const st0 = engine.state();
      if (st0.needHymn !== null && !hymnCache.has(st0.needHymn)) engine.registerHymn(hymnOf(st0.needHymn));
      else if (st0.needHymn !== null) engine.registerHymn(hymnOf(st0.needHymn));
      cpu += performance.now() - t0;
      const t = (i + chunk.length) / SR;
      const st = engine.state();
      if (MODE === "recognize" && st.stage === "following" && followAt === null) {
        followAt = t;
        if (LEAVE_OUT || !accept.has(st.hymn!.number)) wrong = true;
      }
      if (st.snapshot && st.stage === "following" && (MODE === "follow" ? t > 10 : followAt !== null && t > followAt + 10) && !synth.inPause(t)) {
        const e = cyclicError(st.snapshot.position, synth.beatAt(t), T);
        errs.push(Math.abs(e));
        const bps = Math.max(0.2, Math.abs(synth.beatAt(t + 0.5) - synth.beatAt(t - 0.5)));
        errMs.push((Math.abs(e) / bps) * 1000);
      }
    }
    rows.push({
      scenario: sc.name,
      hymn: member.number,
      secondsToFollow: followAt,
      wrong,
      within1: errs.length ? errs.filter((e) => e <= 1).length / errs.length : null,
      medianErrMs: quant(errMs, 0.5),
      cpuMsPerAudioSecond: cpu / (audio.length / SR),
    });
    process.stderr.write(`${sc.name} ${member.number} ${followAt?.toFixed(1) ?? "-"}${wrong ? " FOUT" : ""}\n`);
  }
}

const summary = scenarios.map((sc) => {
  const r = rows.filter((x) => x.scenario === sc.name);
  const ok = r.filter((x) => x.secondsToFollow !== null && !x.wrong);
  const times = ok.map((x) => x.secondsToFollow as number);
  const w1 = r.filter((x) => x.within1 !== null).map((x) => x.within1 as number);
  return {
    scenario: sc.name,
    n: r.length,
    correct: ok.length,
    wrong: r.filter((x) => x.wrong).length,
    notIdentified: r.filter((x) => x.secondsToFollow === null).length,
    secondsMedian: quant(times, 0.5),
    secondsP90: quant(times, 0.9),
    within1Median: quant(w1, 0.5),
    within1P10: quant(w1, 0.1),
    medianErrMs: quant(r.filter((x) => x.medianErrMs !== null).map((x) => x.medianErrMs as number), 0.5),
    cpuMsPerAudioSecondMedian: quant(r.map((x) => x.cpuMsPerAudioSecond), 0.5),
  };
});
console.log(JSON.stringify({ mode: MODE, leaveOut: LEAVE_OUT, bpm: BPM, seconds: SECONDS, compositions: groups.size, sampled: sample.length, summary }, null, 1));
if (flag("out")) writeFileSync(flag("out") as string, JSON.stringify({ mode: MODE, leaveOut: LEAVE_OUT, bpm: BPM, seconds: SECONDS, compositions: groups.size, sampled: sample.length, summary, rows }, null, 1));
