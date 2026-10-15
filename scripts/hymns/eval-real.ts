// Meting op de officiële begeleidingsopnamen (MP3, ge-decodeerd naar WAV in de cachemap). Let op:
//  - de opnamen zijn van de ENGELSE begeleiding (de enige audio die de kerk bij deze liederen biedt),
//    de partituur is de Nederlandse bladmuziek; waar die muziek afwijkt (refrein van 24) klopt de partituur
//    niet met de opname;
//  - er is geen exacte tijdlijn: als "waarheid" dient een offline (niet-causale) DTW-uitlijning. Dat is een
//    schatting, geen meting.
// Aanroep: npx tsx scripts/hymns/eval-real.ts <cachemap>
import { existsSync } from "node:fs";
import { ChromaExtractor, type FeatureFrame } from "../../src/lib/hymns/audio/features";
import { cyclicError } from "../../src/lib/hymns/eval/harness";
import { alignOffline } from "../../src/lib/hymns/eval/offlineAlign";
import { POC_LIBRARY, listHymns } from "../../src/lib/hymns/library";
import { buildReference } from "../../src/lib/hymns/score/reference";
import { HymnFollowSession } from "../../src/lib/hymns/follow/session";
import { HymnRecognizer } from "../../src/lib/hymns/recognize/recognizer";
import { readWav } from "./wav";

const cache = process.argv[2] ?? ".cache/hymns";
const FILES: Record<number, { wav: string; stanzas: number }> = {
  24: { wav: "praise-to-the-man.acc.wav", stanzas: 4 },
  36: { wav: "come-o-thou-king-of-kings.acc.wav", stanzas: 4 },
  82: { wav: "come-follow-me.acc.wav", stanzas: 6 },
};

/**
 * Onafhankelijke controle zonder toonhoogtekenmerken: valt een duidelijke geluidsaanzet (spectrale flux) op
 * de momenten waarop de gevolgde positie een nootbegin passeert? Vergeleken met dezelfde momenten, maar een
 * halve beat verschoven (kans).
 */
function onsetCheck(frames: FeatureFrame[], positions: number[], onsets: number[], cycle: number): { real: number; shifted: number } {
  const flux = frames.map((f) => f.flux);
  const sorted = [...flux].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * 0.8)];
  // tijd waarop de gevolgde (uitgerolde) positie elk nootbegin passeert
  const unrolled: number[] = [];
  let lap = 0;
  for (let i = 0; i < positions.length; i += 1) {
    if (i > 0 && positions[i] < positions[i - 1] - cycle / 2) lap += 1;
    unrolled.push(positions[i] + lap * cycle);
  }
  const crossTime = (beat: number): number | null => {
    for (let i = 1; i < unrolled.length; i += 1) {
      if (unrolled[i - 1] <= beat && unrolled[i] > beat) {
        const f = (beat - unrolled[i - 1]) / Math.max(1e-9, unrolled[i] - unrolled[i - 1]);
        return frames[i - 1].time + f * (frames[i].time - frames[i - 1].time);
      }
    }
    return null;
  };
  const hit = (t: number): boolean => {
    for (let i = 0; i < frames.length; i += 1) {
      if (frames[i].time > t + 0.12) break;
      if (frames[i].time >= t - 0.12 && flux[i] >= threshold) return true;
    }
    return false;
  };
  let real = 0;
  let shifted = 0;
  let n = 0;
  for (let l = 1; l < Math.floor(unrolled[unrolled.length - 1] / cycle); l += 1) {
    for (const o of onsets) {
      const t = crossTime(l * cycle + o);
      const t2 = crossTime(l * cycle + o + 0.5);
      if (t === null || t2 === null || t < 30) continue;
      n += 1;
      if (hit(t)) real += 1;
      if (hit(t2)) shifted += 1;
    }
  }
  return { real: n ? real / n : NaN, shifted: n ? shifted / n : NaN };
}

const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

console.log("| Lofzang | Duur | Binnen 1 beat t.o.v. offline uitlijning (na eerste 30 s) | Mediane afwijking (ms) | Rondewissels (tracker / offline uitlijning / overeenkomend binnen 2,5 s) | Onset-controle (zonder toonhoogtekenmerk) | Eerste voorstel herkenner |");
console.log("|---|---|---|---|---|---|---|");
for (const h of listHymns(POC_LIBRARY)) {
  const f = FILES[h.number];
  const path = `${cache}/${f.wav}`;
  if (!existsSync(path)) {
    console.log(`| ${h.number} | — | bestand ontbreekt (${path}) | | | |`);
    continue;
  }
  const { sampleRate, samples } = readWav(path);
  const ex = new ChromaExtractor({ sampleRate });
  const frames: FeatureFrame[] = [];
  for (let i = 0; i < samples.length; i += 4096) frames.push(...ex.push(samples.subarray(i, i + 4096)));
  const T = h.composition.totalBeats;
  const truth = alignOffline(frames, buildReference(h.composition), f.stanzas);
  const s = new HymnFollowSession(h);
  const errs: number[] = [];
  const errMs: number[] = [];
  const posList: number[] = [];
  frames.forEach((fr, i) => {
    const snap = s.pushFrame(fr);
    posList.push(snap.position);
    if (fr.time < 30 || snap.paused) return;
    const e = Math.abs(cyclicError(snap.position, truth[i].beat, T));
    const bps = Math.max(0.3, Math.abs(truth[Math.min(frames.length - 1, i + 11)].beat - truth[Math.max(0, i - 11)].beat) / (frames[Math.min(frames.length - 1, i + 11)].time - frames[Math.max(0, i - 11)].time));
    errs.push(e);
    errMs.push((e / bps) * 1000);
  });
  const check = onsetCheck(frames, posList, buildReference(h.composition).onsets, T);
  // rondewissels volgens de offline uitlijning: de momenten waarop de uitgelijnde positie een veelvoud van de cyclus passeert
  const truthWraps: number[] = [];
  for (let i = 1; i < truth.length; i += 1) {
    if (Math.floor(truth[i].beat / T) > Math.floor(truth[i - 1].beat / T)) truthWraps.push(frames[i].time);
  }
  const lapTimes = s.events.filter((e) => e.type === "lap").map((e) => e.time);
  if (process.env.DEBUG_LAPS) console.log(h.number, "tracker", lapTimes.map((t) => t.toFixed(1)).join(" "), "| offline", truthWraps.map((t) => t.toFixed(1)).join(" "));
  const matched = lapTimes.filter((t) => truthWraps.some((w) => Math.abs(w - t) <= 2.5)).length;
  const rec = new HymnRecognizer(listHymns(POC_LIBRARY).map((x) => ({ id: x.composition.id, number: x.number, title: x.text.title, composition: x.composition })));
  let first = "geen";
  for (const fr of frames) {
    if (fr.time > 60) break;
    const st = rec.update(fr);
    if (first === "geen" && st.status === "identified") first = `${st.suggestion!.number} na ${fr.time.toFixed(1)} s`;
  }
  console.log(`| ${h.number} | ${(samples.length / sampleRate).toFixed(0)} s | ${((errs.filter((e) => e <= 1).length / errs.length) * 100).toFixed(0)}% | ${q(errMs, 0.5).toFixed(0)} | ${lapTimes.length} herkend, ${truthWraps.length} volgens uitlijning, ${matched} juist | ${(check.real * 100).toFixed(0)}% van de aanzetten op een nootbegin (kans bij 0,5 beat verschuiving: ${(check.shifted * 100).toFixed(0)}%) | ${first} |`);
}

