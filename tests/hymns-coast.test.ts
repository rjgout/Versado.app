import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DEFAULT_COAST_CONFIG, PositionCoaster, type CoastInput } from "../src/lib/hymns/follow/coast";
import { rawCursor } from "../src/lib/hymns/follow/display";
import { constantTempo, synthesizeHymn } from "../src/lib/hymns/eval/synth";
import { extractFrames } from "../src/lib/hymns/eval/harness";
import type { FeatureFrame } from "../src/lib/hymns/audio/features";
import type { HymnComposition } from "../src/lib/hymns/types";
import type { FollowSnapshot } from "../src/lib/hymns/follow/session";
import { SAMPLE_RATE, follow, makeScenario, makeService } from "./helpers/hymnScenario";

// Tijdelijk syncverlies: de woordmarkering loopt een beperkte tijd voorspelbaar door op het laatst betrouwbare tempo (follow/coast.ts),
// onderscheidt gemeten van geschatte positie, loopt nooit door naar een volgend couplet, en sluit bij herstel zonder sprong aan.

const unknown = JSON.parse(readFileSync(new URL("./fixtures/hymns/unknown-melodies.json", import.meta.url), "utf8")).compositions as HymnComposition[];
const DT = 0.05;
const REF = { cycleBeats: 48, fermatas: [30] as number[], nominalBeatsPerSecond: 1.5 };

function run(c: PositionCoaster, from: number, seconds: number, partial: Partial<CoastInput> & { position?: number }, startPos = 10): { time: number; out: ReturnType<PositionCoaster["update"]> }[] {
  const out = [];
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    const time = from + (i + 1) * DT;
    out.push({ time, out: c.update({ time, reliable: true, held: false, singing: true, position: startPos + (time - from) * 1.5, bpm: 90, ...partial }) });
  }
  return out;
}

test("coast: niet tijdens het voorspel of tussenspel (nooit woorden markeren voor het zingen)", () => {
  const c = new PositionCoaster(REF);
  const rows = run(c, 0, 6, { singing: false });
  assert.ok(rows.every((r) => r.out.position === null && r.out.source === "none"));
  // en ook niet doorlopen als er nooit betrouwbaar gemeten is
  const rows2 = run(c, 6, 4, { singing: true, reliable: false });
  assert.ok(rows2.every((r) => r.out.position === null), "zonder meting is er niets om op door te lopen");
});

test("coast: korte onbetrouwbare periode: loopt op het laatst gemeten tempo door en is als geschat gemarkeerd", () => {
  const c = new PositionCoaster(REF);
  const measured = run(c, 0, 6, {}, 10);
  const last = measured[measured.length - 1].out.position!;
  const est = run(c, 6, 3, { reliable: false });
  assert.ok(est.every((r) => r.out.source === "estimated"));
  const end = est[est.length - 1].out.position!;
  // 3 s op 1,5 beat/s (90/min): ongeveer 4,5 beats verder
  assert.ok(Math.abs(end - last - 4.5) < 0.6, `liep ${end - last} beats door in 3 s`);
  assert.ok(est.every((r, i) => i === 0 || r.out.position! >= est[i - 1].out.position!), "positie ging terug");
});

test("coast: het tempo komt van de laatste betrouwbare meting, niet van de onbetrouwbare", () => {
  const c = new PositionCoaster(REF);
  run(c, 0, 8, { bpm: 120 }, 5); // 2 beats per seconde
  const est = run(c, 8, 2, { reliable: false, bpm: 30 }); // een rommelige (onbetrouwbare) meting telt niet
  const rate = (est[est.length - 1].out.position! - est[0].out.position!) / (2 - DT);
  assert.ok(rate > 1.7 && rate < 2.3, `tempo ${rate} beats/s`);
});

test("coast: veilige duur: na maxCoastSeconds bevriest de positie en loopt niet ongecontroleerd door", () => {
  const c = new PositionCoaster(REF);
  run(c, 0, 5, {}, 2);
  const est = run(c, 5, 20, { reliable: false });
  const estimated = est.filter((r) => r.out.source === "estimated");
  const frozen = est.filter((r) => r.out.source === "frozen");
  assert.ok(estimated.length * DT <= DEFAULT_COAST_CONFIG.maxCoastSeconds + 0.1);
  assert.ok(frozen.length > 100);
  assert.equal(new Set(frozen.map((r) => r.out.position)).size, 1, "bevroren positie bewoog");
});

test("coast: er wordt pas doorgelopen na voldoende betrouwbare meting (anders is het tempo onbekend)", () => {
  const c = new PositionCoaster(REF);
  run(c, 0, 1, {}, 2); // maar 1 s betrouwbaar
  const est = run(c, 1, 3, { reliable: false });
  assert.ok(est.every((r) => r.out.source === "frozen"));
});

test("coast: stilte telt niet mee: de positie staat stil en het schatbudget loopt niet", () => {
  const c = new PositionCoaster(REF);
  run(c, 0, 5, {}, 10);
  const silent = run(c, 5, 30, { reliable: false, held: true });
  assert.equal(new Set(silent.map((r) => r.out.position)).size, 1, "positie bewoog tijdens stilte");
  assert.ok(silent.every((r) => r.out.estimatedSeconds === 0));
  // na de stilte mag er nog steeds (volledig) doorgelopen worden
  const est = run(c, 35, 3, { reliable: false });
  assert.ok(est.every((r) => r.out.source === "estimated"));
});

test("coast: nooit voorbij het einde van de ronde (geen voorspeld volgend couplet) en een fermate houdt vast", () => {
  const c = new PositionCoaster({ ...REF, fermatas: [] }, { maxCoastSeconds: 60 });
  run(c, 0, 5, { bpm: 120 }, 40);
  const est = run(c, 5, 30, { reliable: false });
  assert.ok(est.every((r) => r.out.position! < REF.cycleBeats), "liep voorbij de rondegrens");
  const f = new PositionCoaster({ ...REF, fermatas: [20] }, { maxCoastSeconds: 60 });
  run(f, 0, 5, { bpm: 120 }, 5);
  const held = run(f, 5, 20, { reliable: false });
  assert.ok(held.every((r) => r.out.position! <= 20 + 1e-6), "liep door een fermate heen");
});

test("coast: rondegrens uit de fase-laag zet de weergave mee naar het begin van de nieuwe ronde", () => {
  const c = new PositionCoaster(REF, { maxCoastSeconds: 60 });
  run(c, 0, 5, { bpm: 120 }, 40);
  run(c, 5, 3, { reliable: false });
  c.noteLap(1.2);
  const next = c.update({ time: 8.05, reliable: false, held: false, singing: true, position: 1.3, bpm: 90 });
  assert.ok(next.position !== null && next.position < 4, `positie ${next.position} bleef aan het einde hangen`);
});

test("coast: herstel zonder sprong: achterlopen wordt met beperkte snelheid ingehaald, vooruitlopen wacht, nooit terug", () => {
  // achterlopen: de meting is 3 beats verder dan de schatting
  const c = new PositionCoaster(REF);
  run(c, 0, 5, {}, 10);
  const est = run(c, 5, 3, { reliable: false });
  const lastEst = est[est.length - 1].out.position!;
  const measuredStart = lastEst + 3;
  const rows = run(c, 8, 3, {}, measuredStart);
  const maxStep = 1.5 * DEFAULT_COAST_CONFIG.catchUpFactor * DT + 0.3;
  let prev = lastEst;
  for (const r of rows) {
    assert.ok(r.out.position! - prev <= maxStep + 1e-6, `sprong van ${r.out.position! - prev} beats in één frame`);
    assert.ok(r.out.position! >= prev - 1e-9, "positie ging terug");
    prev = r.out.position!;
  }
  const finalGap = Math.abs(rows[rows.length - 1].out.position! - (measuredStart + 3 * 1.5 - DT * 1.5));
  assert.ok(finalGap < 0.2, `sloot niet aan: ${finalGap}`);
  // vooruitlopen: de schatting liep 1,5 beat voor op de meting: wachten, niet teruggaan
  const d = new PositionCoaster(REF);
  run(d, 0, 5, {}, 10);
  const e2 = run(d, 5, 3, { reliable: false });
  const ahead = e2[e2.length - 1].out.position!;
  const rows2 = run(d, 8, 2, {}, ahead - 1.5);
  assert.ok(rows2.every((r) => r.out.position! >= ahead - 1e-9), "de weergave ging terug bij herstel");
});

// --- sessieniveau met echte extractie: syncverlies in het midden van het zingen

function dropout(frames: FeatureFrame[], from: number, to: number): FeatureFrame[] {
  const noise = synthesizeHymn(unknown[0], { sampleRate: SAMPLE_RATE, laps: 1, timbre: "piano", tempoSegments: constantTempo(84), leadInSeconds: 0 });
  const nf = extractFrames(noise.samples, noise.sampleRate);
  return [...frames.filter((f) => f.time < from), ...nf.filter((f) => f.time < to - from).map((f) => ({ ...f, time: f.time + from })), ...frames.filter((f) => f.time >= to)];
}
const SING = (i: number, s: { confirmSingingStart(): void }) => {
  if (i === 30) s.confirmSingingStart();
};
const lineKey = (s: FollowSnapshot) => (s.cursor.section === "chorus" ? 100 : 0) + s.cursor.line;

test("sessie, kort verlies (6 s): de woorden lopen door op tempo en blijven binnen ~1 regel van de waarheid; geschat is zichtbaar anders dan gemeten", () => {
  const sc = makeScenario(82, { tempoSegments: constantTempo(100), laps: 2, singersDb: -6 });
  const { session, snapshots } = follow(sc.hymn, dropout(sc.frames, 20, 26), {}, SING);
  const estimated = snapshots.filter((s) => s.cursor.estimated);
  assert.ok(estimated.length > 80, `slechts ${estimated.length} geschatte frames`);
  assert.ok(estimated.every((s) => s.positionSource === "estimated" && !s.cursor.frozen));
  // gemeten positie en geschatte positie zijn te onderscheiden in de momentopname
  assert.ok(snapshots.some((s) => s.positionSource === "measured") && estimated.every((s) => s.displayPosition !== null));
  // tempo: de weergavepositie schrijdt tijdens het schatten voort met ~ het gemeten tempo
  const a = estimated[0];
  const b = estimated[estimated.length - 1];
  const bpsMeasured = (snapshots.find((s) => s.time > 15)!.bpm || 100) / 60;
  if (b.time - a.time > 3 && b.displayPosition! > a.displayPosition!) {
    const rate = (b.displayPosition! - a.displayPosition!) / (b.time - a.time);
    assert.ok(rate > bpsMeasured * 0.6 && rate < bpsMeasured * 1.4 || b.displayPosition! >= sc.cycle - 0.1, `tempo ${rate} t.o.v. ${bpsMeasured}`);
  }
  // juist: de geschatte regel wijkt hooguit één regel af van de waarheid
  let maxOff = 0;
  for (const s of estimated) {
    const trueBeat = sc.synth.beatAt(s.time) % sc.cycle;
    // rond de rondegrens loopt de weergave bewust niet vooruit op de (nog niet gemeten) nieuwe ronde: dat stuk telt niet mee
    if (trueBeat < 10) continue;
    const truth = rawCursor(sc.hymn.text, session.reference.sections, s.stanza, trueBeat);
    if (truth.section === s.cursor.section) maxOff = Math.max(maxOff, Math.abs(truth.line - s.cursor.line));
  }
  assert.ok(maxOff <= 1, `geschatte regel week ${maxOff} regels af`);
});

test("sessie, herstel: geen sprong terug en geen grote sprong vooruit in de markering", () => {
  const sc = makeScenario(82, { tempoSegments: constantTempo(100), laps: 2, singersDb: -6 });
  const { snapshots } = follow(sc.hymn, dropout(sc.frames, 20, 26), {}, SING);
  let backwards = 0;
  let bigJump = 0;
  let prev: FollowSnapshot | null = null;
  for (const s of snapshots) {
    if (s.cursor.line < 0 || s.time > 29.5) {
      prev = s;
      continue; // na de rondegrens begint de nieuwe ronde bij het begin: dat is geen sprong terug
    }
    if (prev && prev.cursor.line >= 0 && prev.stanza === s.stanza) {
      if (lineKey(s) < lineKey(prev)) backwards += 1;
      if (lineKey(s) - lineKey(prev) > 1) bigJump += 1;
    }
    prev = s;
  }
  assert.equal(backwards, 0, "de markering ging terug");
  assert.equal(bigJump, 0, "de markering sprong meer dan één regel per frame");
});

test("sessie, langdurig verlies (18 s): na de veilige duur staat de markering vast en komt er geen volgend couplet bij een onzekere overgang", () => {
  const sc = makeScenario(82, { tempoSegments: constantTempo(100), laps: 2, singersDb: -6 });
  const { session, snapshots } = follow(sc.hymn, dropout(sc.frames, 20, 38), {}, SING);
  const lost = snapshots.filter((s) => s.status === "lost" && s.cursor.line >= 0);
  assert.ok(lost.length > 50);
  const tail = lost.filter((s) => s.positionSource === "frozen");
  assert.ok(tail.length > 30 && tail.every((s) => s.cursor.frozen && !s.cursor.estimated));
  assert.equal(new Set(tail.map((s) => lineKey(s))).size, 1);
  // een couplet wisselt alleen op een door de fase-laag vastgestelde rondegrens, nooit door het doorlopen zelf
  const stanzaEvents = session.events.filter((e) => e.type === "stanza").map((e) => e.time);
  const lapEvents = session.events.filter((e) => e.type === "lap").map((e) => e.time);
  for (const t of stanzaEvents) assert.ok(lapEvents.some((l) => Math.abs(l - t) < 0.01), "couplet wisselde zonder rondegrens");
  const fromLoss = snapshots.filter((s) => s.time > 20 && s.time < 38);
  assert.ok(fromLoss.every((s) => s.displayPosition === null || s.displayPosition < sc.cycle), "de weergave liep voorbij de rondegrens");
});

test("sessie, voorspel: er worden geen woorden gemarkeerd, ook niet bij syncverlies in het voorspel", () => {
  const sv = makeService(82, [{ options: { tempoSegments: constantTempo(90) } }, { gapBefore: 2.5, options: { tempoSegments: constantTempo(90), singersDb: -6, laps: 1 } }]);
  const frames = dropout(sv.frames, 6, 14);
  const { snapshots } = follow(sv.hymn, frames);
  const prelude = snapshots.filter((s) => s.time < sv.partStart[1] - 0.5);
  assert.ok(prelude.length > 200);
  assert.ok(prelude.every((s) => s.cursor.line < 0 && s.displayPosition === null && s.positionSource === "none"), "er werd tijdens het voorspel gemarkeerd of geschat");
});

test("sessie, stilte: tijdens een pauze loopt de markering niet door", () => {
  const sc = makeScenario(82, { tempoSegments: constantTempo(100), laps: 1, singersDb: -6 });
  const frames = sc.frames.map((f) => (f.time > 12 && f.time < 20 ? { ...f, silent: true, rmsDb: -90, chroma: new Float32Array(f.chroma.length) } : f));
  const { snapshots } = follow(sc.hymn, frames, {}, SING);
  const silent = snapshots.filter((s) => s.time > 14 && s.time < 19.5 && s.cursor.line >= 0);
  assert.ok(silent.length > 30);
  assert.equal(new Set(silent.map((s) => `${lineKey(s)}:${s.cursor.word}`)).size, 1, "de markering liep door tijdens stilte");
  assert.ok(silent.every((s) => !s.cursor.estimated));
});
