import assert from "node:assert/strict";
import test from "node:test";
import { constantTempo } from "../src/lib/hymns/eval/synth";
import { rawCursor } from "../src/lib/hymns/follow/display";
import type { FollowSnapshot } from "../src/lib/hymns/follow/session";
import { follow, makeService, referenceFor, type Service, type ServicePart } from "./helpers/hymnScenario";

// Voorspel en zangbegin. Elk scenario is een synthetische "dienst" met een exact bekende tijdlijn die door de
// echte engine wordt gehaald. De woordmarkering mag pas beginnen als de zang betrouwbaar is begonnen; zonder
// bewijs wacht de engine op de bevestiging van de gebruiker (BETROUWBAARHEID GAAT BOVEN AUTOMATISERING).

const BPM = 90;
const FAST = { tempoSegments: constantTempo(BPM) } as const;
const SINGERS = { ...FAST, singersDb: -6 } as const;
/** Hymne 82: 48 beats per couplet, de gemeentezang en het voorspel beginnen altijd bij een rondegrens. */
const N = 82;
const CYCLE = 48;

function active(s: FollowSnapshot): boolean {
  return s.cursor.line >= 0;
}

function firstActiveTime(snaps: FollowSnapshot[]): number | null {
  const s = snaps.find(active);
  return s ? s.time : null;
}

function startEvent(run: ReturnType<typeof follow>) {
  return run.session.events.find((e) => e.type === "phase" && e.phaseEvent === "start");
}

/** Events tot het einde van de muziek: een rondegrens op het allerlaatste frame zegt niets. */
function untilEnd<T extends { time: number }>(events: T[], end: number): T[] {
  return events.filter((e) => e.time < end - 0.5);
}

function tailPrelude(fraction: number): ServicePart {
  return { options: { ...FAST, startBeat: CYCLE * (1 - fraction) } };
}

test("scenario A: de laatste vier maten als voorspel: tekst staat klaar, markering begint pas bij de zang", () => {
  const sv = makeService(N, [tailPrelude(0.34), { options: SINGERS }]);
  const run = follow(sv.hymn, sv.frames);
  const start = startEvent(run);
  assert.ok(start, "zangbegin niet vastgesteld");
  assert.ok(Math.abs(start.time - sv.partStart[1]) < 1.5, `zangbegin ${start.time.toFixed(1)} s, werkelijk ${sv.partStart[1].toFixed(1)} s`);
  // tijdens het voorspel is er geen enkel actief woord of regel
  const during = run.snapshots.filter((s) => s.time < sv.partStart[1] - 0.2);
  assert.ok(during.length > 100);
  assert.ok(during.every((s) => !active(s) && s.phase.phase === "prelude"), "markering tijdens het voorspel");
  // en kort na het begin van de zang loopt de markering mee
  const t = firstActiveTime(run.snapshots);
  assert.ok(t !== null && t - sv.partStart[1] < 3, `markering begon ${t} s, zang ${sv.partStart[1].toFixed(1)} s`);
  assert.equal(run.snapshots.find((s) => s.phase.phase === "singing")!.stanza, 1, "couplet 1 hoort bij de eerste zangronde");
  assert.equal(run.session.snapshotNow.phase.startReason, "wrap-tail");
});

test("scenario B: een heel couplet als voorspel wordt niet als couplet 1 geteld en de engine wacht op bevestiging", () => {
  const sv = makeService(N, [{ options: FAST }, { options: SINGERS }]);
  const run = follow(sv.hymn, sv.frames);
  assert.equal(startEvent(run), undefined, "zonder bewijs mag er geen automatisch zangbegin zijn");
  assert.ok(run.snapshots.every((s) => !active(s)), "er was een actief woord zonder zangbegin");
  const last = run.session.snapshotNow;
  assert.equal(last.stanza, 1);
  assert.equal(last.lap, 0, "het voorspel telde als gezongen ronde");
  assert.equal(last.phase.waiting, true, "geen verzoek om bevestiging");
  assert.equal(last.phase.phase, "prelude");
  assert.ok(!run.session.events.some((e) => e.type === "stanza"), "het voorspel schakelde een couplet door");
});

test("scenario B/J: 'Zang begint' neemt het over zonder de muziekvolging aan te raken (bit voor bit gelijk)", () => {
  const sv = makeService(N, [{ options: FAST }, { options: SINGERS }]);
  const plain = follow(sv.hymn, sv.frames);
  const confirmAt = sv.partStart[1] + 4;
  const tapped = follow(sv.hymn, sv.frames, {}, (_i, s) => {
    if (s.snapshotNow.time >= confirmAt && s.snapshotNow.phase.phase === "prelude") s.confirmSingingStart();
  });
  assert.deepEqual(
    tapped.snapshots.map((s) => [s.position, s.bpm, s.confidence, s.status]),
    plain.snapshots.map((s) => [s.position, s.bpm, s.confidence, s.status]),
    "de bevestiging veranderde de muziekvolging"
  );
  const from = tapped.snapshots.find((s) => s.phase.phase === "singing");
  assert.ok(from && from.time >= confirmAt - 0.1 && from.time < confirmAt + 0.3, "overgang niet direct na de tik");
  // de markering staat meteen op de juiste regel van de gezongen melodie
  const ref = referenceFor(sv.hymn);
  const probe = tapped.snapshots.find((s) => s.time >= confirmAt + 2 && active(s))!;
  const truthBeat = ((probe.time - sv.partStart[1]) * BPM) / 60;
  const expected = rawCursor(sv.hymn.text, ref.sections, 1, truthBeat);
  assert.ok(Math.abs(probe.cursor.line - expected.line) <= 1, `regel ${probe.cursor.line}, verwacht ${expected.line}`);
  assert.equal(tapped.session.events.filter((e) => e.type === "phase" && e.phaseEvent === "start").length, 1);
  assert.equal(tapped.session.snapshotNow.phase.startReason, "manual");
});

test("scenario C: slechts twee maten voorspel: de engine past zich aan (automatisch of vraagt om bevestiging, nooit een gok)", () => {
  const sv = makeService(N, [tailPrelude(0.17), { options: SINGERS }]);
  const run = follow(sv.hymn, sv.frames);
  const start = startEvent(run);
  const markedBeforeSinging = run.snapshots.some((s) => s.time < sv.partStart[1] - 0.3 && active(s));
  assert.equal(markedBeforeSinging, false, "markering tijdens het korte voorspel");
  if (start) assert.ok(Math.abs(start.time - sv.partStart[1]) < 2, `zangbegin ${start.time.toFixed(1)} s, werkelijk ${sv.partStart[1].toFixed(1)} s`);
  else assert.equal(run.session.snapshotNow.phase.waiting, true, "geen zangbegin en ook geen verzoek om bevestiging");
});

test("scenario D: een duidelijke stilte tussen voorspel en samenzang is bewijs voor het zangbegin", () => {
  const sv = makeService(N, [{ options: FAST }, { gapBefore: 2.5, options: SINGERS }]);
  const run = follow(sv.hymn, sv.frames);
  const start = startEvent(run);
  assert.ok(start, "geen zangbegin na de stilte");
  assert.match(String(start.reason), /pauze/);
  assert.equal(run.session.snapshotNow.phase.startReason, "wrap-gap");
  assert.ok(Math.abs(start.time - sv.partStart[1]) < 1.5, `zangbegin ${start.time.toFixed(1)} s, werkelijk ${sv.partStart[1].toFixed(1)} s`);
  assert.ok(run.snapshots.filter((s) => s.time < sv.partStart[1] - 0.2).every((s) => !active(s)));
});

test("scenario D2: ook als de volger de rondegrens al aan het begin van de stilte ziet (orgel, hymne 36)", () => {
  const organ = { ...FAST, timbre: "organ" as const };
  const sv = makeService(36, [{ options: organ }, { gapBefore: 2.5, options: { ...organ, singersDb: -6 } }]);
  const run = follow(sv.hymn, sv.frames);
  const start = startEvent(run);
  assert.ok(start, "geen zangbegin na de stilte");
  assert.equal(run.session.snapshotNow.phase.startReason, "wrap-gap");
  // het zingen begint waar de muziek na de stilte weer klinkt, niet in het midden van de stilte
  assert.ok(Math.abs(start.time - sv.partStart[1]) < 1.5, `zangbegin ${start.time.toFixed(1)} s, werkelijk ${sv.partStart[1].toFixed(1)} s`);
  assert.ok(run.snapshots.filter((s) => s.time < sv.partStart[1] - 0.2).every((s) => !active(s)));
});

test("scenario E: zonder stilte en zonder ander bewijs wacht de engine op handmatige bevestiging", () => {
  const sv = makeService(N, [{ options: FAST }, { options: SINGERS }]);
  const run = follow(sv.hymn, sv.frames);
  assert.equal(startEvent(run), undefined);
  assert.equal(run.session.snapshotNow.phase.waiting, true);
  assert.ok(run.session.events.some((e) => e.type === "phase" && e.phaseEvent === "waiting"), "geen melding dat bewijs ontbreekt");
});

test("scenario F: pratende en roepende kinderen tijdens het voorspel zijn geen zangbegin", () => {
  const shared = { chatterDb: -8, noiseDb: -26, shoutsAt: [7, 15, 22] };
  const sv = makeService(N, [{ options: FAST }, { options: SINGERS }], shared);
  const run = follow(sv.hymn, sv.frames);
  const before = run.snapshots.filter((s) => s.time < sv.partStart[1] + 2);
  assert.equal(before.some(active), false, "gebabbel of een roep werd als zang gezien");
  assert.equal(startEvent(run), undefined);
  // de engine blijft de muziek zelf volgen ondanks het gebabbel (grofweg binnen een maat, in het voorspel)
  const locked = before.filter((s) => s.time > 12 && s.time < sv.partStart[1] - 1);
  assert.ok(locked.length > 100);
  assert.ok(locked.filter((s) => s.status === "locked" || s.status === "recovered").length / locked.length > 0.5, "synchronisatie ging verloren door gebabbel");
});

test("scenario F2: met gebabbel en een tail-voorspel begint de zang nog steeds op de rondegrens, niet eerder", () => {
  const shared = { chatterDb: -8, noiseDb: -26, shoutsAt: [3] };
  const sv = makeService(N, [tailPrelude(0.34), { options: SINGERS }], shared);
  const run = follow(sv.hymn, sv.frames);
  assert.equal(run.snapshots.filter((s) => s.time < sv.partStart[1] - 0.3).some(active), false);
  const start = startEvent(run);
  if (start) assert.ok(start.time > sv.partStart[1] - 0.5, `zangbegin ${start.time.toFixed(1)} s voor de zang (${sv.partStart[1].toFixed(1)} s)`);
});

test("scenario G: instappen midden in een couplet: positie wordt herkend, couplet 1 wordt niet blind aangenomen", () => {
  // De muziek speelt al als de luisterfunctie start (geen stilte vooraf): couplet 2 van een lopende samenzang.
  const sv = makeService(
    N,
    [
      { options: { ...SINGERS, startBeat: CYCLE * 0.4 } },
      { options: SINGERS },
    ],
    {},
    0
  );
  const run = follow(sv.hymn, sv.frames);
  assert.equal(run.session.snapshotNow.phase.entry, "joined");
  assert.equal(startEvent(run), undefined, "zonder stilte of ander bewijs mag het zangbegin niet worden aangenomen");
  assert.ok(run.snapshots.every((s) => !active(s)));
  // de positie klopt wel: de volger weet waar de muziek is
  const late = run.snapshots.filter((s) => s.time > 12 && s.time < sv.partEnd[0] - 1);
  const err = (s: FollowSnapshot) => {
    const truth = CYCLE * 0.4 + ((s.time - 0) * BPM) / 60;
    const d = Math.abs(((s.position - truth) % CYCLE + CYCLE) % CYCLE);
    return Math.min(d, CYCLE - d);
  };
  assert.ok(late.filter((s) => err(s) <= 1.5).length / late.length > 0.8, "positie in het lopende couplet niet herkend");
  // de gebruiker kiest couplet 3 en bevestigt: de markering loopt meteen mee binnen couplet 3
  const second = makeService(N, [{ options: { ...SINGERS, startBeat: CYCLE * 0.4 } }, { options: SINGERS }], {}, 0);
  const picked = follow(second.hymn, second.frames, {}, (_i, s) => {
    if (s.snapshotNow.time > 14 && s.snapshotNow.phase.phase === "prelude") {
      s.selectStanza(3);
      s.confirmSingingStart();
    }
  });
  const marked = picked.snapshots.find(active)!;
  assert.equal(marked.stanza, 3);
  assert.ok(picked.snapshots.filter((s) => s.phase.phase === "singing").every((s) => s.stanza >= 3));
});

test("scenario H: gekozen volgorde 1 -> 4: couplet 1 na het voorspel, na de eerste echte zangronde couplet 4", () => {
  const sv = makeService(N, [tailPrelude(0.34), { options: { ...SINGERS, laps: 2 } }]);
  const run = follow(sv.hymn, sv.frames, {}, (i, s) => {
    if (i === 0) s.setStanzaOrder([1, 4]);
  });
  const end = sv.partEnd[1];
  const stanzas = untilEnd(run.session.events.filter((e) => e.type === "stanza"), end);
  assert.deepEqual(stanzas.map((e) => e.stanza), [4]);
  const firstWrap = sv.partStart[1] + (CYCLE * 60) / BPM;
  assert.ok(Math.abs(stanzas[0].time - firstWrap) < 1.5, `couplet 4 om ${stanzas[0].time.toFixed(1)} s, rondegrens ${firstWrap.toFixed(1)} s`);
  // bij het voorspel stond couplet 1 klaar
  const atStart = run.snapshots.find((s) => s.phase.phase === "singing")!;
  assert.equal(atStart.stanza, 1);
});

test("scenario I: een instrumentaal tussenspel van twee regels telt niet als extra couplet", () => {
  const sv = makeService(N, [
    tailPrelude(0.34),
    { options: SINGERS },
    // tussenspel: alleen de laatste regels, zonder gemeente
    { options: { ...FAST, startBeat: CYCLE * 0.7 } },
    { options: SINGERS },
  ]);
  const run = follow(sv.hymn, sv.frames);
  const end = sv.partEnd[3];
  // Gezongen: couplet 1 (na het voorspel), couplet 2 (tweede zangronde, wissel op de rondegrens na ronde 1).
  // Het tussenspel (twee regels, daarna een rondegrens) mag GEEN extra wissel opleveren.
  const stanzaEvents = run.session.events.filter((e) => e.type === "stanza");
  assert.deepEqual(untilEnd(stanzaEvents, end).map((e) => e.stanza), [2], `coupletwissels: ${stanzaEvents.map((e) => `${e.stanza}@${e.time.toFixed(0)}`).join(", ")}`);
  const interludeEnd = sv.partEnd[2];
  assert.ok(!stanzaEvents.some((e) => Math.abs(e.time - interludeEnd) < 3), "het einde van het tussenspel schakelde een couplet door");
  assert.ok(run.session.events.some((e) => e.type === "phase" && e.phaseEvent === "interlude"), "tussenspel niet herkend");
  assert.ok(run.session.events.some((e) => e.type === "phase" && e.phaseEvent === "lap-ignored"), "tussenspelgrens niet genegeerd");
  assert.ok(run.session.events.some((e) => e.type === "phase" && e.phaseEvent === "resume"), "zang na het tussenspel niet hervat");
  // tijdens het tussenspel staat de tekst klaar zonder markering
  const during = run.snapshots.filter((s) => s.time > sv.partStart[2] + 6 && s.time < interludeEnd - 0.5);
  assert.ok(during.length > 50 && during.every((s) => !active(s)), "markering tijdens het tussenspel");
});

test("scenario L: instrumentale muziek zonder hoorbare zang: er wordt geen zangbegin 'gedetecteerd'", () => {
  const sv = makeService(N, [{ options: FAST }, { options: { ...FAST, laps: 2 } }]);
  const run = follow(sv.hymn, sv.frames);
  assert.equal(startEvent(run), undefined);
  assert.equal(run.session.snapshotNow.phase.startReason, null);
  // handmatig starten kan altijd
  const manual = follow(sv.hymn, sv.frames, {}, (_i, s) => {
    if (s.snapshotNow.time > sv.partStart[1] + 3 && s.snapshotNow.phase.phase === "prelude") s.confirmSingingStart();
  });
  assert.equal(manual.session.snapshotNow.phase.startReason, "manual");
  assert.ok(manual.snapshots.some(active));
});

test("opnieuw synchroniseren: terug naar voorspel, couplet blijft, geen audio-reset en daarna weer synchroon", () => {
  const sv = makeService(N, [tailPrelude(0.34), { options: { ...SINGERS, laps: 2 } }]);
  const resyncAt = sv.partStart[1] + 12;
  let resyncIndex = -1;
  const run = follow(sv.hymn, sv.frames, {}, (i, s) => {
    if (resyncIndex < 0 && s.snapshotNow.time >= resyncAt) {
      resyncIndex = i;
      s.selectStanza(2);
      s.resync();
    }
  });
  const after = run.snapshots.slice(resyncIndex);
  assert.equal(after[0].phase.phase, "prelude");
  assert.equal(after[0].cursor.line, -1);
  assert.equal(after[0].stanza, 2, "het gekozen couplet ging verloren");
  assert.ok(after.some((s) => s.status === "locked"), "volger synchroniseerde niet opnieuw");
});

test("handmatig zangbegin vlak voor een rondegrens begint het zingen pas bij die grens", () => {
  const sv = makeService(N, [{ options: FAST }, { options: SINGERS }]);
  const gridEnd = sv.partEnd[0];
  let tapped = false;
  const run = follow(sv.hymn, sv.frames, {}, (_i, s) => {
    if (!tapped && s.snapshotNow.time >= gridEnd - 1.5) {
      tapped = true;
      s.confirmSingingStart();
    }
  });
  const start = startEvent(run);
  assert.ok(start && start.time >= gridEnd - 0.5, `begin ${start?.time.toFixed(1)} s, voorspel eindigt ${gridEnd.toFixed(1)} s`);
  assert.equal(run.session.snapshotNow.phase.startReason, "manual");
});

function summary(sv: Service, run: ReturnType<typeof follow>) {
  return { start: startEvent(run)?.time, partStart: sv.partStart, levelStep: run.session.snapshotNow.phase.levelStepDb };
}
void summary;
