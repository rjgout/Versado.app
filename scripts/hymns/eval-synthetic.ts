// Reproduceerbare metingen op synthetische opnamen met bekende tijdlijn. Uitvoer is Markdown voor
// docs/hymns/05-TEST-RESULTS.md. Aanroep: npx tsx scripts/hymns/eval-synthetic.ts [volg|herken|cpu]
import { readFileSync } from "node:fs";
import { constantTempo, synthesizeHymn, type SynthOptions } from "../../src/lib/hymns/eval/synth";
import { cyclicError, extractFrames } from "../../src/lib/hymns/eval/harness";
import { POC_LIBRARY, listHymns, resolveHymn } from "../../src/lib/hymns/library";
import { HymnFollowSession } from "../../src/lib/hymns/follow/session";
import { HymnRecognizer, type RecognitionCandidate } from "../../src/lib/hymns/recognize/recognizer";
import type { HymnComposition } from "../../src/lib/hymns/types";

const SR = 22050;
const what = process.argv[2] ?? "volg";
const unknown = JSON.parse(readFileSync(new URL("../../tests/fixtures/hymns/unknown-melodies.json", import.meta.url), "utf8")).compositions as HymnComposition[];

function q(a: number[], p: number): number {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

if (what === "volg") {
  const scen = (T: number): Record<string, Partial<SynthOptions>> => ({
    "normaal 80/min piano": {},
    "langzaam 55/min": { tempoSegments: constantTempo(55) },
    "snel 110/min": { tempoSegments: constantTempo(110) },
    "versnellen 60→110": { tempoSegments: [60, 70, 80, 90, 100, 110].map((b, i) => ({ fromBeat: (i * T) / 6, bps: b / 60 })) },
    "vertragen 100→55 orgel": { timbre: "organ", tempoSegments: [100, 90, 80, 70, 62, 55].map((b, i) => ({ fromBeat: (i * T) / 6, bps: b / 60 })) },
    "stilte 6 s": { pauses: [{ atBeat: T * 0.6, seconds: 6 }] },
    "fermate 4 s (uitklinkend)": { pauses: [{ atBeat: T * 0.5, seconds: 4, ringOut: true }] },
    "foute noten 25%": { wrongNoteProbability: 0.25, wrongNoteRange: [T * 0.3, T * 0.7] },
    "gemeente+ruis+galm": { singersDb: -6, noiseDb: -18, reverbSeconds: 1.8 },
    "orgel+gemeente+galm 2,2 s": { timbre: "organ", singersDb: -4, noiseDb: -20, reverbSeconds: 2.2 },
    "voorspel vanaf 55%": { startBeat: T * 0.55 },
    "stemming +30 cent": { tuningSemitones: 0.3 },
  });
  console.log("| Scenario | Lofzang | Gesynchr. na (s) | mediane fout (ms) | p90 fout (ms) | binnen 0,5 beat | binnen 1 beat | mediane afwijking vooruit(+)/achter(−) (ms) |");
  console.log("|---|---|---|---|---|---|---|---|");
  const agg: Record<string, { ms: number[]; w1: number[]; lock: number[] }> = {};
  for (const h of listHymns(POC_LIBRARY)) {
    const T = h.composition.totalBeats;
    for (const [name, extra] of Object.entries(scen(T))) {
      const synth = synthesizeHymn(h.composition, { sampleRate: SR, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.5, seed: h.number, ...extra, ...(extra.startBeat ? { laps: 2 } : {}) });
      const frames = extractFrames(synth.samples, SR);
      const s = new HymnFollowSession(h);
      const errBeats: number[] = [];
      const errMs: number[] = [];
      const signedMs: number[] = [];
      let lockAt: number | null = null;
      for (const f of frames) {
        const snap = s.pushFrame(f);
        if (lockAt === null && snap.status === "locked") lockAt = f.time - (synth.timeAt(extra.startBeat ?? 0));
        if (f.time < 6 || synth.inPause(f.time) || snap.paused) continue;
        const e = cyclicError(snap.position, synth.beatAt(f.time), T);
        const bps = Math.max(0.2, Math.abs(synth.beatAt(f.time + 0.5) - synth.beatAt(f.time - 0.5)));
        errBeats.push(Math.abs(e));
        errMs.push((Math.abs(e) / bps) * 1000);
        signedMs.push((e / bps) * 1000);
      }
      const row = { ms: q(errMs, 0.5), p90: q(errMs, 0.9), w05: errBeats.filter((e) => e <= 0.5).length / errBeats.length, w1: errBeats.filter((e) => e <= 1).length / errBeats.length, bias: q(signedMs, 0.5) };
      (agg[name] ??= { ms: [], w1: [], lock: [] }).ms.push(row.ms);
      agg[name].w1.push(row.w1);
      if (lockAt !== null) agg[name].lock.push(lockAt);
      console.log(`| ${name} | ${h.number} | ${lockAt === null ? "nooit" : lockAt.toFixed(1)} | ${row.ms.toFixed(0)} | ${row.p90.toFixed(0)} | ${(row.w05 * 100).toFixed(0)}% | ${(row.w1 * 100).toFixed(0)}% | ${row.bias.toFixed(0)} |`);
    }
  }
}

if (what === "herken") {
  const cands: RecognitionCandidate[] = listHymns(POC_LIBRARY).map((h) => ({ id: h.composition.id, number: h.number, title: h.text.title, composition: h.composition }));
  const variants: Record<string, (T: number) => Partial<SynthOptions>> = {
    "piano 80": () => ({}),
    "orgel 65": () => ({ timbre: "organ", tempoSegments: constantTempo(65) }),
    "piano 100 + gemeente/ruis/galm": () => ({ tempoSegments: constantTempo(100), singersDb: -6, noiseDb: -18, reverbSeconds: 1.8 }),
    "voorspel vanaf 55%": (T) => ({ startBeat: T * 0.55 }),
    "piano 55": () => ({ tempoSegments: constantTempo(55) }),
    "orgel 90 + gemeente/ruis/galm 2,2 s": () => ({ timbre: "organ", tempoSegments: constantTempo(90), singersDb: -4, noiseDb: -20, reverbSeconds: 2.2 }),
    "foute noten 20%": () => ({ wrongNoteProbability: 0.2 }),
  };
  const sources = [
    ...listHymns(POC_LIBRARY).map((h) => ({ name: `lofzang ${h.number}`, comp: h.composition, truth: h.number as number | null })),
    ...unknown.map((c) => ({ name: `onbekend (${c.id.replace("comp:unknown-", "lofzang ")})`, comp: c, truth: null as number | null })),
  ];
  console.log("| Fragment | Omstandigheid | Eindstand na 35 s | Eerste voorstel | Bewijs per kandidaat (nats) |");
  console.log("|---|---|---|---|---|");
  let tp = 0, wrong = 0, none = 0, fp = 0, nPos = 0, nNeg = 0;
  const times: number[] = [];
  for (const s of sources) for (const [vn, v] of Object.entries(variants)) {
    const T = s.comp.totalBeats;
    const synth = synthesizeHymn(s.comp, { sampleRate: SR, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.3, seed: 5, ...v(T), startBeat: vn.startsWith("voorspel") ? T * 0.55 : 0 });
    const frames = extractFrames(synth.samples, SR).filter((f) => f.time < 35);
    const rec = new HymnRecognizer(cands);
    let first: { n: number; t: number } | null = null;
    let st = rec.state();
    for (const f of frames) {
      st = rec.update(f);
      if (!first && st.status === "identified") first = { n: st.suggestion!.number, t: f.time };
    }
    if (s.truth) {
      nPos += 1;
      if (first?.n === s.truth) { tp += 1; times.push(first.t); } else if (first) wrong += 1; else none += 1;
    } else {
      nNeg += 1;
      if (first) fp += 1;
    }
    console.log(`| ${s.name} | ${vn} | ${st.status} | ${first ? `${first.n} na ${first.t.toFixed(1)} s` : "geen"} | ${st.ranking.map((r) => `${r.number}: ${r.evidence.toFixed(0)}`).join(", ")} |`);
  }
  console.log(`\nSamenvatting: bekende lofzangen ${tp}/${nPos} juist herkend, ${wrong} verkeerd, ${none} niet herkend; mediane tijd tot voorstel ${q(times, 0.5).toFixed(1)} s (p90 ${q(times, 0.9).toFixed(1)} s, max ${Math.max(...times).toFixed(1)} s); onbekende melodieën: ${fp}/${nNeg} ten onrechte voorgesteld.`);
}

if (what === "cpu") {
  const h = resolveHymn(POC_LIBRARY, 82)!;
  const synth = synthesizeHymn(h.composition, { sampleRate: SR, laps: 2, timbre: "piano", tempoSegments: constantTempo(90), leadInSeconds: 0.5 });
  // feature-extractie (FFT) apart van de tracker
  const t0 = process.hrtime.bigint();
  const frames = extractFrames(synth.samples, SR);
  const extractMs = Number(process.hrtime.bigint() - t0) / 1e6 / frames.length;
  const s = new HymnFollowSession(h);
  const t1 = process.hrtime.bigint();
  for (const f of frames) s.pushFrame(f);
  const followMs = Number(process.hrtime.bigint() - t1) / 1e6 / frames.length;
  const cands = listHymns(POC_LIBRARY).map((x) => ({ id: x.composition.id, number: x.number, title: x.text.title, composition: x.composition }));
  const rec = new HymnRecognizer(cands);
  const t2 = process.hrtime.bigint();
  for (const f of frames) rec.update(f);
  const recMs = Number(process.hrtime.bigint() - t2) / 1e6 / frames.length;
  const hop = 1024 / SR * 1000 * 1; // hopSize = frameSize/4 = 1024 bij 22050 Hz
  console.log(`frames: ${frames.length}, hop: ${(4096 / 4 / SR * 1000).toFixed(1)} ms`);
  console.log(`FFT + kenmerken: ${extractMs.toFixed(3)} ms/frame; volgen (1 tracker, 600 deeltjes): ${followMs.toFixed(3)} ms/frame; herkennen (3 trackers x 500): ${recMs.toFixed(3)} ms/frame`);
  const budget = (4096 / 4 / SR) * 1000;
  console.log(`CPU-belasting (Node op deze machine, 1 kern): volgen ${(((extractMs + followMs) / budget) * 100).toFixed(1)}%, herkennen ${(((extractMs + recMs) / budget) * 100).toFixed(1)}% van een kern`);
  void hop;
}

if (what === "herstel") {
  // Hersteltijd na een verstoring, op lofzang 82 (100/min). Waarheid = de bekende tijdlijn van de synthetische opname.
  const h = resolveHymn(POC_LIBRARY, 82)!;
  const T = h.composition.totalBeats;
  const run = (synth: ReturnType<typeof synthesizeHymn>, frames: ReturnType<typeof extractFrames>) => {
    const s = new HymnFollowSession(h);
    const snaps = frames.map((f) => s.pushFrame(f));
    return { s, snaps };
  };
  const recoveredAfter = (snaps: { time: number; position: number }[], synth: ReturnType<typeof synthesizeHymn>, from: number) => {
    let okSince: number | null = null;
    for (const sn of snaps) {
      if (sn.time < from) continue;
      const ok = Math.abs(cyclicError(sn.position, synth.beatAt(sn.time), T)) <= 1;
      if (ok) {
        okSince ??= sn.time;
        if (sn.time - okSince >= 1) return okSince - from;
      } else okSince = null;
    }
    return null;
  };
  // 1. stilte van 6 s
  for (const secs of [3, 6, 12]) {
    const synth = synthesizeHymn(h.composition, { sampleRate: SR, laps: 2, timbre: "piano", tempoSegments: constantTempo(100), leadInSeconds: 0.5, pauses: [{ atBeat: T * 0.6, seconds: secs }] });
    const frames = extractFrames(synth.samples, SR);
    const { snaps } = run(synth, frames);
    const resume = synth.timeAt(T * 0.6);
    console.log(`stilte ${secs} s: positie weer binnen 1 beat ${recoveredAfter(snaps, synth, resume)?.toFixed(1) ?? "nooit"} s na het hervatten`);
  }
  // 2. onbekende muziek ingeplakt (gat van 18 s)
  const base = synthesizeHymn(h.composition, { sampleRate: SR, laps: 2, timbre: "piano", tempoSegments: constantTempo(100), leadInSeconds: 0.5 });
  const baseFrames = extractFrames(base.samples, SR);
  for (const gap of [6, 10, 18]) {
    const noise = synthesizeHymn(unknown[0], { sampleRate: SR, laps: 1, timbre: "piano", tempoSegments: constantTempo(84), leadInSeconds: 0 });
    const noiseFrames = extractFrames(noise.samples, SR);
    const GAP_START = 20;
    const frames = [...baseFrames.filter((f) => f.time < GAP_START), ...noiseFrames.filter((f) => f.time < gap).map((f) => ({ ...f, time: f.time + GAP_START })), ...baseFrames.filter((f) => f.time >= GAP_START + gap)];
    const s = new HymnFollowSession(h);
    const snaps = frames.map((f) => s.pushFrame(f));
    const ev = s.events.filter((e) => e.type === "status" && e.time >= GAP_START);
    const firstLost = ev.find((e) => e.to === "lost");
    const rec = ev.find((e) => e.to === "recovered" || (e.to === "locked" && e.time > GAP_START + gap));
    console.log(
      `onbekende muziek ${gap} s: onzeker na ${ev.find((e) => e.to === "uncertain") ? (ev.find((e) => e.to === "uncertain")!.time - GAP_START).toFixed(1) : "nooit"} s, verloren ${firstLost ? `na ${(firstLost.time - GAP_START).toFixed(1)} s` : "nooit"}, ` +
        `status weer gesynchroniseerd/hersteld ${rec ? (rec.time - (GAP_START + gap)).toFixed(1) + " s na het einde van het gat" : "nooit"}, positie weer binnen 1 beat ${recoveredAfter(snaps, base, GAP_START + gap)?.toFixed(1) ?? "nooit"} s na het gat`
    );
  }
  // 3. verkeerde noten in een deel van het stuk
  for (const p of [0.15, 0.3, 0.5]) {
    const synth = synthesizeHymn(h.composition, { sampleRate: SR, laps: 2, timbre: "piano", tempoSegments: constantTempo(100), leadInSeconds: 0.5, wrongNoteProbability: p, wrongNoteRange: [T * 0.3, T * 0.7] });
    const frames = extractFrames(synth.samples, SR);
    const { snaps, s } = run(synth, frames);
    const lost = s.events.filter((e) => e.type === "status" && e.to === "lost").length;
    const within = snaps.filter((sn) => sn.time > 6 && Math.abs(cyclicError(sn.position, synth.beatAt(sn.time), T)) <= 1).length / snaps.filter((sn) => sn.time > 6).length;
    console.log(`verkeerde noten ${(p * 100).toFixed(0)}% in 40% van het stuk: ${(within * 100).toFixed(0)}% van de tijd binnen 1 beat, ${lost}x 'verloren'`);
  }
}
