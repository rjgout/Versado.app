import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ChromaExtractor } from "../src/lib/hymns/audio/features";
import { PitchAnalyzer, hzToMidi } from "../src/lib/hymns/audio/pitch";
import { constantTempo, synthesizeHymn } from "../src/lib/hymns/eval/synth";
import { extractFrames } from "../src/lib/hymns/eval/harness";
import { MelodyPrefilter } from "../src/lib/hymns/recognize/melodyPrefilter";
import { loadMelody, loadRecognitionBundle, loadReliableMelody, loadResolvedHymn } from "../src/lib/hymns/library/server";
import { decodeNotation } from "../src/lib/hymns/notation/decode";
import { melodyComposition, reconstructMelody } from "../src/lib/hymns/score/melody";

// Lofzangen V3, stap B: zang-only-synthese, grondtoonanalyse, melodiereconstructie en melodieherkenning.

const SR = 22050;
const BASE = { sampleRate: SR, laps: 1, timbre: "piano", leadInSeconds: 0.5, tempoSegments: constantTempo(80) } as const;

test("voiceOnly: alleen zang, geen instrument, geen NaN en niet stil", () => {
  const hymn = loadResolvedHymn(2)!;
  const s = synthesizeHymn(hymn.composition, { ...BASE, seed: 2, voiceOnly: true, voice: { singers: 1 } });
  let peak = 0;
  for (const v of s.samples) {
    assert.ok(Number.isFinite(v));
    peak = Math.max(peak, Math.abs(v));
  }
  assert.ok(peak > 0.3 && peak <= 0.71, `piek ${peak}`);
  // zonder instrument en met ruis/gebabbel: geen deling door nul bij het normaliseren
  const noisy = synthesizeHymn(hymn.composition, { ...BASE, seed: 2, voiceOnly: true, noiseDb: -14, chatterDb: -10, shoutsAt: [3], voice: { singers: 3 } });
  assert.ok(noisy.samples.every(Number.isFinite));
});

test("voiceOnly: ademhalingspauzes staan in de tijdlijn en zijn echt stil", () => {
  const hymn = loadResolvedHymn(2)!;
  const s = synthesizeHymn(hymn.composition, { ...BASE, seed: 2, voiceOnly: true, breaths: { everyMeasures: 4, seconds: 0.8, jitterSeconds: 0.4 }, voice: { singers: 1 } });
  const plain = synthesizeHymn(hymn.composition, { ...BASE, seed: 2, voiceOnly: true, voice: { singers: 1 } });
  assert.ok(s.duration > plain.duration + 1, "pauzes maken de uitvoering langer");
  const pause = s.anchors.find((a, i) => s.anchors[i + 1]?.beat === a.beat && s.anchors[i + 1].seconds > a.seconds)!;
  assert.ok(s.inPause(pause.seconds + 0.1));
  const from = Math.floor((pause.seconds + 0.25) * SR);
  const to = Math.floor((pause.seconds + 0.6) * SR);
  let max = 0;
  for (let i = from; i < to; i += 1) max = Math.max(max, Math.abs(s.samples[i]));
  assert.ok(max < 0.05, `stilte tijdens de pauze (piek ${max})`);
});

test("Pitchy: grondtoon en clarity van een zuivere toon; ruis geeft geen grondtoon", () => {
  const analyzer = new PitchAnalyzer({ windowSize: 2048 });
  const tone = new Float32Array(2048);
  for (let i = 0; i < tone.length; i += 1) tone[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.15 * Math.sin((2 * Math.PI * 440 * i) / SR);
  const r = analyzer.estimate(tone, SR);
  assert.ok(Math.abs(r.hz - 220) < 2, `hz ${r.hz}`);
  assert.ok(r.clarity > 0.95);
  assert.ok(Math.abs(hzToMidi(220) - 57) < 1e-9);
  let seed = 1;
  const noise = Float32Array.from({ length: 2048 }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  });
  assert.equal(analyzer.estimate(noise, SR).hz, 0, "ruis heeft geen betrouwbare grondtoon");
});

test("de extractor levert per frame een grondtoon bij zang en kan zonder pitch draaien", () => {
  const hymn = loadResolvedHymn(2)!;
  const s = synthesizeHymn(hymn.composition, { ...BASE, seed: 2, voiceOnly: true, voice: { singers: 1, vibratoCents: 20 } });
  const frames = extractFrames(s.samples.subarray(0, SR * 8), SR);
  const voiced = frames.filter((f) => !f.silent && f.pitch && f.pitch.hz > 0).length;
  assert.ok(voiced / frames.filter((f) => !f.silent).length > 0.7, "de meeste zangframes hebben een grondtoon");
  const off = new ChromaExtractor({ sampleRate: SR, pitch: false });
  const plain = off.push(s.samples.subarray(0, SR * 2));
  assert.ok(plain.length > 0 && plain.every((f) => f.pitch === undefined));
  // pitch verandert de chroma niet
  const on = new ChromaExtractor({ sampleRate: SR });
  const withPitch = on.push(s.samples.subarray(0, SR * 2));
  assert.deepEqual(Array.from(withPitch[10].chroma), Array.from(plain[10].chroma));
});

test("melodiereconstructie: de hele bibliotheek, conservatief en controleerbaar", () => {
  const bundle = loadRecognitionBundle();
  let ok = 0;
  const reasons: Record<string, number> = {};
  for (const c of bundle.compositions) {
    const m = loadMelody(c.id)!;
    assert.ok(m, c.id);
    if (m.status === "ok") {
      ok += 1;
      assert.ok(m.topAgreement >= 0.9 && m.coverage >= 0.85, c.id);
      // één lijn: nooit twee melodienoten tegelijk
      for (let i = 0; i + 1 < m.notes.length; i += 1) assert.ok(m.notes[i][0] + m.notes[i][1] <= m.notes[i + 1][0] + 0.03, `${c.id} overlap bij ${m.notes[i][0]}`);
      assert.ok(bundle.melodies[c.id], "betrouwbare melodie zit in het herkenningspakket");
    } else {
      assert.ok(m.reasons.length > 0);
      assert.equal(bundle.melodies[c.id], undefined, "onbetrouwbare melodie wordt niet gebruikt");
      for (const r of m.reasons) reasons[r] = (reasons[r] ?? 0) + 1;
    }
  }
  assert.ok(ok >= 150, `betrouwbare melodieën: ${ok}/${bundle.compositions.length} (${JSON.stringify(reasons)})`);
});

test("melodiereconstructie: zonder notatie of stokrichting nooit 'ok'; een afwijkende lettergreep maakt de melodie onzeker", () => {
  const bundle = loadRecognitionBundle();
  const comp = bundle.compositions[0];
  assert.equal(reconstructMelody(comp, null).status, "uncertain");
  const slug = comp.id.replace(/^comp:/, "");
  const notation = decodeNotation(JSON.parse(readFileSync(`src/lib/hymns/library/data/notation/${slug}.json`, "utf8")));
  const stripped = { ...notation, notes: notation.notes.map((n) => ({ ...n, stem: null })) };
  assert.deepEqual(reconstructMelody(comp, stripped).reasons, ["stokrichting-ontbreekt"]);
  const good = reconstructMelody(comp, notation);
  assert.equal(good.status, "ok");
  // een lettergreep op een beat zonder melodienoot
  const bad = reconstructMelody(comp, notation, { syllableBeats: [...good.notes.map((n) => n[0]), 0.123, 0.456, 0.789] });
  assert.equal(bad.syllableAnchors !== null && bad.syllableAnchors < 1, true);
  assert.equal(melodyComposition(comp, { ...good, status: "uncertain" }), null);
  assert.equal(melodyComposition(comp, good)!.notes.every((n) => n[3] === 0), true);
});

test("melodieherkenning (pitch): solozang in drie toonsoorten staat bovenaan in de hele bibliotheek, instrumenten doen niet mee", () => {
  const bundle = loadRecognitionBundle();
  const usable = bundle.compositions.filter((c) => bundle.melodies[c.id]).map((c) => ({ id: c.id, melody: bundle.melodies[c.id], totalBeats: c.totalBeats }));
  const members = new Map(bundle.members.map((m) => [m.compositionId, m.number]));
  const picks = usable.filter((_, i) => i % 40 === 5).slice(0, 4);
  assert.ok(picks.length >= 3);
  let hits = 0;
  let total = 0;
  for (const shift of [0, -5, -12]) {
    for (const p of picks) {
      const hymn = loadResolvedHymn(members.get(p.id)!)!;
      const s = synthesizeHymn(hymn.composition, { ...BASE, seed: 3, voiceOnly: true, voice: { singers: 1, registerShift: shift, vibratoCents: 20, intonationCents: 25 } });
      const mp = new MelodyPrefilter(usable);
      for (const f of extractFrames(s.samples.subarray(0, SR * 22), SR)) mp.push(f);
      const r = mp.rankNow();
      total += 1;
      if (r && r.ranking[0].id === p.id) hits += 1;
    }
  }
  assert.ok(hits / total >= 0.8, `top-1 ${hits}/${total}`);
  // een piano met akkoorden heeft geen stabiele grondtoon: geen melodievenster
  const hymn = loadResolvedHymn(members.get(picks[0].id)!)!;
  const piano = synthesizeHymn(hymn.composition, { ...BASE, seed: 3 });
  const mp = new MelodyPrefilter(usable);
  for (const f of extractFrames(piano.samples.subarray(0, SR * 22), SR)) mp.push(f);
  assert.ok(mp.tracker.voicedShare() < 0.3, `piano voicedShare ${mp.tracker.voicedShare()}`);
});

test("betrouwbare melodie per lofzang: loadReliableMelody komt overeen met het pakket", () => {
  const hymn = loadResolvedHymn(2)!;
  assert.deepEqual(hymn.melody, loadReliableMelody(hymn.composition.id));
});
