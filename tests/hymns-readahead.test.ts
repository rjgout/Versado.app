import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { constantTempo, synthesizeHymn } from "../src/lib/hymns/eval/synth";
import { extractFrames } from "../src/lib/hymns/eval/harness";
import { HymnFollowSession, type FollowSnapshot } from "../src/lib/hymns/follow/session";
import { loadResolvedHymn, readManifest } from "../src/lib/hymns/library/server";
import type { FeatureFrame } from "../src/lib/hymns/audio/features";
import { KARAOKE_PREVIEW_LINES, MEASURE_HOLD_SECONDS, READ_AHEAD_BAND, READ_AHEAD_TARGET, describeStatus, holdMeasure, nextStanzaInPlan, scrollDelta, type MeasureHold } from "../src/components/hymns-poc/viewModel";
import { SAMPLE_RATE } from "./helpers/hymnScenario";
import type { LiveState } from "../src/lib/hymns/live";

// Meelezen en vooruitkijken: het volgende couplet staat klaar (volledig couplet, karaoke, bladmuziek), een kort syncverlies geeft geen
// onderbreking, het couplet wisselt alleen op een gemeten rondegrens, en de coupletvolgorde en refreinen blijven kloppen.

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

test("volgende couplet volgens de volgorde: officieel, aangepast, laatste en onbekende nummers", () => {
  assert.equal(nextStanzaInPlan([], [1, 2, 3, 4], 1), 2);
  assert.equal(nextStanzaInPlan([], [1, 2, 3, 4], 4), null, "na het laatste couplet geen voorbeeld (nooit teruglopen)");
  assert.equal(nextStanzaInPlan([1, 4], [1, 2, 3, 4], 1), 4, "aangepaste volgorde 1 -> 4: couplet 2 en 3 worden overgeslagen");
  assert.equal(nextStanzaInPlan([1, 4], [1, 2, 3, 4], 4), null);
  assert.equal(nextStanzaInPlan([2, 3], [1, 2, 3, 4], 1), 2, "handmatig couplet 1 gekozen buiten de volgorde: eerstvolgende uit de volgorde");
  assert.equal(nextStanzaInPlan([9, 12], [1, 2, 3], 1), 2, "ongeldige keuze valt terug op alle coupletten");
  assert.equal(nextStanzaInPlan([3, 3, 2], [1, 2, 3], 1), 3, "dubbelen worden genegeerd, volgorde zoals gekozen");
});

test("scrollen naar vooruitkijken: de actieve regel blijft in de bovenste helft, scrollt rustig en alleen als nodig", () => {
  const view = { viewTop: 80, viewBottom: 780 };
  assert.ok(READ_AHEAD_BAND <= 0.6 && READ_AHEAD_TARGET <= 0.35);
  const geo = (top: number) => ({ ...view, lineTop: top, lineBottom: top + 40, contentHeight: 2400 });
  assert.equal(scrollDelta(geo(120)), 0, "bovenin: niets doen");
  assert.equal(scrollDelta(geo(300)), 0, "in de bovenste helft: niets doen");
  const lower = scrollDelta(geo(520));
  assert.ok(lower > 150, `in de onderste helft: rustig omhoog naar ~30%: ${lower}`);
  // na het scrollen staat de regel op ~30%: er blijft ~70% van het scherm over voor wat eraan komt
  const after = 520 - lower;
  assert.ok(Math.abs(after - (80 + 700 * READ_AHEAD_TARGET)) < 2);
  assert.ok(scrollDelta(geo(30)) < 0, "een regel die boven in beeld verdwijnt komt terug");
});

test("status: geschatte positie is geen alarm ('Tekst loopt door'); bevroren blijft 'Even onzeker'", () => {
  const live = (over: Partial<FollowSnapshot>): LiveState =>
    ({
      stage: "following",
      hymn: null,
      choice: "manual",
      recognition: null,
      backlog: 0,
      needHymn: null,
      diag: { frames: 0, lastFrameSilent: null, lastRmsDb: null, candidates: 0, awaitingCandidates: false },
      snapshot: {
        time: 10, status: "uncertain", confidence: 0.2, paused: false, position: 3, measure: 1, bpm: 90, lap: 0, lapUncertain: false, stanza: 1,
        cursor: { section: "verse", line: 1, word: 2, frozen: false, estimated: true },
        displayPosition: 4, positionSource: "estimated", estimatedSeconds: 2,
        phase: { phase: "singing", entry: "mid", waiting: false, sungLaps: 0, coverage: 0, startReason: "wrap-tail", startEvidence: [], levelStepDb: 0, interludes: 0 },
        ...over,
      },
    }) as unknown as LiveState;
  const est = describeStatus("listening", live({}));
  assert.equal(est?.label, "Tekst loopt door");
  assert.equal(est?.tone, "neutral");
  // aansluiten na een schatting: nog niet "Volgt muziek", want de woorden staan nog niet op de meting
  const catching = describeStatus("listening", live({ positionSource: "catching-up", cursor: { section: "verse", line: 1, word: 2, frozen: false, estimated: true } }));
  assert.equal(catching?.label, "Tekst sluit aan");
  assert.equal(catching?.tone, "neutral");
  const frozen = describeStatus("listening", live({ positionSource: "frozen", cursor: { section: "verse", line: 1, word: 2, frozen: true, estimated: false } }));
  assert.equal(frozen?.label, "Even onzeker");
});

test("maatmarkering: binnen een couplet nooit terug; een blijvend lagere meting (nieuwe ronde, herstel) wordt na korte tijd wel gevolgd", () => {
  let h: MeasureHold = { key: "", value: null, behindSince: null };
  const step = (key: string, m: number | null, t: number) => (h = holdMeasure(h, key, m, t));
  step("82:1", 3, 10);
  assert.equal(step("82:1", 4, 10.2).value, 4);
  assert.equal(step("82:1", 3, 10.4).value, 4, "jitter van één maat terug wordt genegeerd");
  assert.equal(step("82:1", 4, 10.6).value, 4);
  // een nieuwe ronde: de positie begint opnieuw terwijl het couplet nog niet is doorgeschakeld
  assert.equal(step("82:1", 15, 11).value, 15);
  assert.equal(step("82:1", 1, 11.2).value, 15, "korte tijd vasthouden, geen sprong terug");
  assert.equal(step("82:1", 1, 11.2 + MEASURE_HOLD_SECONDS - 0.1).value, 15);
  assert.equal(step("82:1", 1, 11.2 + MEASURE_HOLD_SECONDS + 0.1).value, 1, "blijvend lager: de markering volgt (laatste couplet, herstel)");
  // een ander couplet begint opnieuw, ook bij een lagere maat
  step("82:1", 15, 20);
  assert.equal(step("82:2", 1, 20.3).value, 1);
  // geen meting: geen markering vasthouden
  assert.equal(step("82:2", null, 21).value, null);
});

// --- sessie met echte extractie op meerdere refreinlofzangen

function service(number: number, laps = 2) {
  const hymn = loadResolvedHymn(number)!;
  const synth = synthesizeHymn(hymn.composition, { sampleRate: SAMPLE_RATE, laps, timbre: "piano", tempoSegments: constantTempo(100), leadInSeconds: 0.5, singersDb: -6, seed: number });
  return { hymn, synth, frames: extractFrames(synth.samples, synth.sampleRate), cycle: hymn.composition.totalBeats };
}
function run(hymn: ReturnType<typeof loadResolvedHymn>, frames: FeatureFrame[], order: number[] = []) {
  const session = new HymnFollowSession(hymn!);
  session.setStanzaOrder(order);
  const snaps = frames.map((f, i) => {
    if (i === 30) session.confirmSingingStart();
    return session.pushFrame(f);
  });
  return { session, snaps };
}
const jam = (frames: FeatureFrame[], from: number, to: number): FeatureFrame[] =>
  frames.map((f) => (f.time >= from && f.time < to ? { ...f, chroma: f.chroma.map((_, i) => ((i * 7919) % 13) / 13) as unknown as Float32Array } : f));

const REFRAIN_HYMNS = (readManifest().hymns as unknown as { number: number; hasChorus?: boolean; capabilities: { scoreValidated: boolean; wordFollowing: boolean } }[]).filter((h) => h.hasChorus && h.capabilities.scoreValidated && h.capabilities.wordFollowing).slice(0, 14).map((h) => h.number);

test("refreinlofzangen: een kort syncverlies laat de markering doorlopen, over de grens van couplet naar refrein, zonder sprong terug", () => {
  assert.ok(REFRAIN_HYMNS.length >= 8, "te weinig refreinlofzangen in de bibliotheek");
  let checked = 0;
  for (const number of REFRAIN_HYMNS) {
    if (checked >= 5) break;
    const sv = service(number, 1);
    // de synthetische opname moet zonder storing gevolgd worden (anders zegt de test niets over syncverlies)
    const baseline = run(sv.hymn, sv.frames).snaps.filter((s) => s.cursor.line >= 0).length;
    if (baseline < 300) continue;
    const sections = new HymnFollowSession(sv.hymn).reference.sections;
    const chorusStart = sections.find((s) => s.id === "chorus")?.startBeat ?? sv.cycle * 0.6;
    // verlies vlak vóór het refrein, zodat het doorlopen de sectiegrens oversteekt
    const bps = 100 / 60;
    const tBoundary = sv.synth.timeAt(chorusStart);
    const from = Math.max(8, tBoundary - 3);
    const to = from + 4;
    void bps;
    const { snaps } = run(sv.hymn, jam(sv.frames, from, to));
    const marked = snaps.filter((s) => s.cursor.line >= 0 && s.time < sv.synth.timeAt(sv.cycle) - 0.5);
    assert.ok(marked.length > 100, `lofzang ${number}: te weinig markering`);
    const key = (s: FollowSnapshot) => (s.cursor.section === "chorus" ? 1000 : 0) + s.cursor.line;
    let backwards = 0;
    for (let i = 1; i < marked.length; i += 1) if (key(marked[i]) < key(marked[i - 1])) backwards += 1;
    assert.equal(backwards, 0, `lofzang ${number}: de markering ging terug`);
    checked += 1;
  }
  assert.ok(checked >= 4, `slechts ${checked} refreinlofzangen met een volgbare testopname`);
});

test("automatische overgang naar het volgende couplet: alleen op een gemeten rondegrens, ook na kort syncverlies, in de gekozen volgorde", () => {
  const sv = service(82, 3);
  const frames = jam(sv.frames, 20, 25);
  const { session, snaps } = run(sv.hymn, frames);
  const laps = session.events.filter((e) => e.type === "lap").map((e) => e.time);
  const stanzas = session.events.filter((e) => e.type === "stanza");
  assert.ok(stanzas.length >= 1, "geen automatische couplet-overgang");
  for (const e of stanzas) assert.ok(laps.some((l) => Math.abs(l - e.time) < 0.01), "couplet wisselde zonder gemeten rondegrens");
  assert.deepEqual(stanzas.map((e) => e.stanza), stanzas.map((_, i) => i + 2), "volgorde 1, 2, 3 ... zonder overslaan");
  // aangepaste volgorde 1 -> 4: nooit couplet 2 of 3 tonen
  const custom = run(sv.hymn, jam(sv.frames, 20, 25), [1, 4]);
  const shown = new Set(custom.snaps.map((s) => s.stanza));
  assert.ok(!shown.has(2) && !shown.has(3), `onverwacht couplet getoond: ${[...shown].join(",")}`);
  assert.ok(shown.has(1));
});

test("langdurig verlies over de rondegrens: geen voorspeld volgend couplet", () => {
  const sv = service(82, 2);
  // lang verlies rond de eerste rondegrens (ruim langer dan de veilige duur)
  const boundary = sv.synth.timeAt(sv.cycle);
  const { session, snaps } = run(sv.hymn, jam(sv.frames, boundary - 6, boundary + 14));
  const before = snaps.filter((s) => s.time > boundary - 6 && s.time < boundary + 14);
  assert.ok(before.every((s) => s.displayPosition === null || s.displayPosition < sv.cycle - 0.01 || s.positionSource === "measured"));
  for (const e of session.events.filter((e) => e.type === "stanza")) {
    assert.ok(session.events.some((l) => l.type === "lap" && Math.abs(l.time - e.time) < 0.01));
  }
});

// --- weergave: statische controles op de samenhang (geen browser nodig)

test("volledig couplet en karaoke: het volgende couplet staat klaar in dezelfde leesruimte, zonder eigen scrollregel en zonder grote sprong", () => {
  const lyrics = read("src/components/hymns-poc/LyricsView.tsx");
  assert.match(lyrics, /nextStanza\?: HymnStanza \| null/);
  assert.match(lyrics, /data-hymns-preview/);
  assert.equal((lyrics.match(/data-hymns-preview/g) ?? []).length, 2, "voorbeeld in beide weergaven");
  // het voorbeeld heeft nooit data-seq: automatisch scrollen en aantikken blijven op het huidige couplet
  for (const block of lyrics.split("data-hymns-preview").slice(1)) assert.doesNotMatch(block.slice(0, 400), /data-seq/);
  assert.match(lyrics, /useStanzaAnchor/, "scrollcompensatie bij een vanzelf doorschakelend couplet");
  assert.match(lyrics, /box\.scrollTop = Math\.max\(0, scrollBefore \+ \(after - before\)\)/, "scrollpositie compenseert de verschoven inhoud");
  assert.match(lyrics, /root\.animate\(/, "wat niet te compenseren is glijdt in plaats van te springen");
  assert.ok(KARAOKE_PREVIEW_LINES >= 2);
  const scroll = read("src/components/hymns-poc/useReadingScroll.ts");
  const center = Number(/const CENTER_AT = ([0-9.]+)/.exec(scroll)?.[1]);
  assert.ok(center > 0 && center <= 0.32, `karaoke-leesplek ${center} staat niet hoog genoeg`);
});

test("leespositie: een vanzelf doorschakelend couplet zet de leesplek niet terug; een bewuste keuze wel", () => {
  const client = read("src/components/hymns-poc/HymnsPocClient.tsx");
  assert.match(client, /placeKey: `\$\{hymn\?\.number \?\? opened\?\.number \?\? 0\}:\$\{placeEpoch\}:\$\{effectiveView\}`/, "placeKey mag het couplet niet bevatten");
  const handlers = ["const backToChoose", "const selectHymn", "const onStanzaTap", "const startListening"];
  for (const h of handlers) {
    const body = client.slice(client.indexOf(h), client.indexOf(h) + 700);
    assert.match(body, /bumpPlace\(\)/, `${h} meldt geen bewuste wissel`);
  }
  assert.match(client, /nextStanzaInPlan\(order, stanzaNumbers, stanza\.n\)/);
  assert.match(client, /nextStanza=\{nextStanza\}/);
  assert.match(client, /nextStanza=\{nextNumber\}/, "de bladmuziek krijgt het volgende couplet om alvast te graveren");
  // wisselen tussen weergaven start geen microfoon of sessie
  const toggle = client.slice(client.indexOf("data-hymns-view-toggle"), client.indexOf("data-hymns-view-toggle") + 600);
  assert.match(toggle, /setPrefs\(\{ view: nextView \}\)/);
  assert.doesNotMatch(toggle, /startListening|getEngine|restart|micRef/);
});

test("bladmuziek: twee graveerplekken, het volgende couplet wordt alvast gegraveerd en de wissel is een zichtbaarheidswissel", () => {
  const sheet = read("src/components/hymns-poc/SheetMusicView.tsx");
  assert.match(sheet, /nextStanza\?: number \| null/);
  assert.match(sheet, /requestIdleCallback/);
  assert.match(sheet, /setVisible\(have\)/, "een al gegraveerd couplet wisselt zonder opnieuw graveren");
  assert.match(sheet, /queue\.current = queue\.current\.then/, "één graveerbeurt tegelijk");
  assert.match(sheet, /visibility: "hidden"/);
  assert.match(sheet, /data-estimated/);
});
