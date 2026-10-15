import assert from "node:assert/strict";
import test from "node:test";
import { StanzaPlan } from "../src/lib/hymns/follow/stanzas";
import { StableCursor, rawCursor, type SectionBounds } from "../src/lib/hymns/follow/display";
import { POC_LIBRARY, resolveHymn } from "../src/lib/hymns/library";

test("standaard: alle coupletten in volgorde en automatisch doorschakelen bij elke nieuwe ronde", () => {
  const plan = new StanzaPlan([1, 2, 3, 4]);
  assert.equal(plan.current, 1);
  assert.equal(plan.onNewLap(1)?.stanza, 2);
  assert.equal(plan.onNewLap(2)?.stanza, 3);
  assert.equal(plan.onNewLap(3)?.stanza, 4);
  // na het laatste couplet blijft het staan: nooit terug naar het begin
  assert.equal(plan.onNewLap(4), null);
  assert.equal(plan.current, 4);
});

test("gekozen volgorde 1 -> 4: alleen die coupletten, in die volgorde", () => {
  const plan = new StanzaPlan([1, 2, 3, 4]);
  plan.setOrder([1, 4]);
  assert.deepEqual([...plan.order], [1, 4]);
  assert.equal(plan.current, 1);
  assert.equal(plan.onNewLap(1)?.stanza, 4);
  assert.equal(plan.onNewLap(2), null);
  assert.equal(plan.current, 4);
});

test("een handmatige keuze heeft voorrang en geen herstart van de muziek is nodig (alleen de weergave verandert)", () => {
  const plan = new StanzaPlan([1, 2, 3, 4]);
  const change = plan.selectManual(4, 0);
  assert.deepEqual(change, { stanza: 4, reason: "manual" });
  assert.equal(plan.current, 4);
});

test("na een handmatige keuze wordt niet automatisch teruggeschakeld, ook niet in dezelfde ronde", () => {
  const plan = new StanzaPlan([1, 2, 3, 4]);
  plan.selectManual(3, 1);
  // rondegrens van ronde 1 (de ronde waarin de gebruiker net koos): geen automatische overschrijving
  assert.equal(plan.onNewLap(1), null);
  assert.equal(plan.current, 3);
  // de volgende ronde gaat door vanaf het gekozen couplet, nooit terug
  assert.equal(plan.onNewLap(2)?.stanza, 4);
});

test("handmatig kiezen buiten de gekozen volgorde: doorgaan met het eerstvolgende gekozen couplet", () => {
  const plan = new StanzaPlan([1, 2, 3, 4]);
  plan.setOrder([1, 4]);
  plan.selectManual(2, 0);
  assert.equal(plan.onNewLap(1)?.stanza, 4);
});

test("ongeldige invoer: onbekend couplet wordt genegeerd, lege volgorde betekent alles", () => {
  const plan = new StanzaPlan([1, 2, 3]);
  assert.equal(plan.selectManual(9, 0), null);
  assert.equal(plan.current, 1);
  plan.setOrder([]);
  assert.deepEqual([...plan.order], [1, 2, 3]);
  plan.setOrder([7, 8]);
  assert.deepEqual([...plan.order], [1, 2, 3]);
});

test("automatisch doorschakelen kan worden uitgezet", () => {
  const plan = new StanzaPlan([1, 2]);
  plan.setAutoAdvance(false);
  assert.equal(plan.onNewLap(1), null);
  assert.equal(plan.current, 1);
});

const h24 = resolveHymn(POC_LIBRARY, 24)!;
const sections = h24.composition.sections as SectionBounds[];

test("weergave: de actieve regel volgt de positie en wisselt naar het refrein", () => {
  const first = rawCursor(h24.text, sections, 1, 0.2);
  assert.equal(first.section, "verse");
  assert.equal(first.line, 0);
  const later = rawCursor(h24.text, sections, 1, 17);
  assert.equal(later.section, "verse");
  assert.ok(later.line >= 1);
  const chorus = rawCursor(h24.text, sections, 1, sections[1].startBeat + 0.5);
  assert.equal(chorus.section, "chorus");
  assert.equal(chorus.line, 0);
});

test("weergave: woordmarkering alleen bij woordkoppeling, anders alleen de regel", () => {
  const word = rawCursor(h24.text, sections, 1, 0.2);
  assert.notEqual(word.word, null);
  const h82 = resolveHymn(POC_LIBRARY, 82)!;
  const line = rawCursor(h82.text, h82.composition.sections as SectionBounds[], 6, 3);
  assert.equal(line.word, null);
  assert.ok(line.line >= 0);
});

test("weergave springt niet heen en weer: binnen een ronde alleen vooruit, en bevroren bij onzekerheid", () => {
  const cur = new StableCursor();
  const a = cur.update(h24.text, sections, 1, 9, true);
  const b = cur.update(h24.text, sections, 1, 2, true); // een enkele terugspringende schatting
  assert.ok(b.line >= a.line, "markering sprong terug");
  const frozen = cur.update(h24.text, sections, 1, 20, false);
  assert.equal(frozen.frozen, true);
  assert.equal(frozen.line, b.line, "markering verschoof tijdens onzekerheid");
  // na een toegestane sprong (nieuwe ronde of herstel) mag het wel terug
  cur.permitJump();
  const back = cur.update(h24.text, sections, 1, 0.2, true);
  assert.equal(back.line, 0);
});

test("weergave beweegt niet meer dan één regel per update vooruit zolang er geen sprong is toegestaan", () => {
  const cur = new StableCursor();
  cur.update(h24.text, sections, 1, 0.2, true);
  const jump = cur.update(h24.text, sections, 1, 28, true);
  assert.ok(jump.line <= 1, "te grote sprong vooruit");
});
