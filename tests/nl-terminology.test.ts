// Nederlandse terminologie voor reeksen: in zichtbare Nederlandse teksten staan "reeks" en "reeksbevriezing(en)", nooit
// "streak", "freeze" of een losse "bevriezing". Technische sleutels, slugs en identifiers (currentStreak, freezeCount, "streak-7", enz.)
// zijn bewust toegestaan en worden hier niet bekeken: de test loopt alleen over tekstwaarden. Zie docs/VERSADO-DESIGN.md ("Nederlandse terminologie").
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { nl } from "../src/lib/i18n/messages/nl";
import { en } from "../src/lib/i18n/messages/en";
import { getT } from "../src/lib/i18n";
import type { MessageKey } from "../src/lib/i18n/core";

type Tree = { [key: string]: Tree | string };
function strings(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : strings(value, `${prefix}${key}.`));
}
const FORBIDDEN = /streak|freeze|(^|[^s])bevriez/i;
const nlStrings = strings(nl as unknown as Tree);

test("Nederlandse teksten bevatten geen Engelse reekswoorden of losse 'bevriezing'", () => {
  // Parameters als {streak} zijn variabelen, geen zichtbare tekst.
  const hits = nlStrings.filter(([, value]) => FORBIDDEN.test(value.replace(/\{\w+\}/g, "")));
  assert.deepEqual(hits.map(([key, value]) => `${key}: ${value}`), []);
});

test("de Nederlandse seed- en weergavegegevens voor prestaties hebben dezelfde terminologie", () => {
  for (const file of ["src/lib/seed.ts", "src/lib/achievementDisplay.ts"]) {
    const text = readFileSync(file, "utf8");
    // Alleen tekstwaarden van name/description; slugs ("streak-7", "first-freeze-earned") en code blijven Engels.
    const values = [...text.matchAll(/(?:name|description)\s*:\s*"([^"]*)"/g)].map((match) => match[1]);
    assert.ok(values.length > 5, `${file}: tekstwaarden gevonden`);
    assert.deepEqual(values.filter((value) => FORBIDDEN.test(value)), [], file);
  }
});

test("foutmeldingen uit streak.ts voor cadeau's gebruiken de goede termen", () => {
  const text = readFileSync("src/lib/streak.ts", "utf8");
  const messages = [...text.matchAll(/new Error\("([^"]*)"\)/g)].map((match) => match[1]);
  assert.deepEqual(messages.filter((value) => FORBIDDEN.test(value)), []);
  assert.ok(messages.includes("Je hebt geen reeksbevriezing om weg te geven.") && messages.includes("Je kunt jezelf geen reeksbevriezing geven."));
  const t = getT("nl");
  assert.equal(t("serverTexts.noFreezeToGive" as MessageKey), "Je hebt geen reeksbevriezing om weg te geven.");
});

test("enkelvoud en meervoud van reeksbevriezingen", () => {
  const t = getT("nl");
  assert.equal(t("lesson.freezesEarnedOne", { n: 1 }), "Mijlpaal gehaald! Je hebt 1 reeksbevriezing verdiend. 🧊");
  assert.equal(t("lesson.freezesEarnedMany", { n: 3 }), "Mijlpaal gehaald! Je hebt 3 reeksbevriezingen verdiend. 🧊");
  assert.equal(t("shop.freezeBought", { n: 1 }), "1 reeksbevriezing gekocht! 🧊");
  assert.equal(t("shop.freezesBought", { n: 5 }), "5 reeksbevriezingen gekocht! 🧊");
  assert.equal(t("streakPage.freezesUsedOne", { n: 1 }), "1 reeksbevriezing gebruikt");
  assert.equal(t("streakPage.freezesUsedMany", { n: 2 }), "2 reeksbevriezingen gebruikt");
  assert.equal(t("misc.freezeGiftMany" as MessageKey, { n: 2 }), "Je hebt 2 nieuwe reeksbevriezingen gekregen.");
});

test("cadeau-, winkel- en meldingsteksten gebruiken de voorgeschreven zinnen en behouden hun parameters", () => {
  const t = getT("nl");
  assert.equal(t("friends.freezeConfirm", { tag: "Jan#83" }), "Weet je zeker dat je een reeksbevriezing wilt geven aan Jan#83?");
  assert.equal(t("friends.freezeTitle" as MessageKey), "Reeksbevriezing geven?");
  assert.equal(t("misc.freezeGiftText" as MessageKey, { sender: "Jan#83" }), "Jan#83 heeft je een reeksbevriezing cadeau gedaan.");
  assert.equal(t("notify.freezeText" as MessageKey, { name: "Jan#83" }), "Jan#83 heeft je een reeksbevriezing gegeven! 🧊");
  assert.equal(t("notify.reminderEmail" as MessageKey, { app: "Versado" }), "Je bent vandaag nog niet langs geweest bij Versado — houd je reeks vast!");
  assert.equal(t("streakPage.explain", { streak: "reeks" }).includes("reeksbevriezing"), true);
});

test("per sleutel dezelfde placeholders in het Nederlands als in het Engels (reeksteksten)", () => {
  const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");
  const english = new Map(strings(en as unknown as Tree));
  const related = nlStrings.filter(([key, value]) => /reeks|bevriez/i.test(value) || /streak|freeze/i.test(key));
  assert.ok(related.length > 40);
  for (const [key, value] of related) { const other = english.get(key); if (other !== undefined) assert.equal(placeholders(value), placeholders(other), key); }
});

test("de reeksfunctionaliteit zelf is ongewijzigd: interne namen blijven Engels", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  for (const name of ["currentStreak", "longestStreak", "freezeCount", "model StreakDay", "model FreezeTransaction"]) assert.ok(schema.includes(name), name);
  const migration = readFileSync("prisma/migrations/20260914190153_streak_calendar/migration.sql", "utf8");
  assert.ok(migration.includes("Streak beschermd op"), "de historische migratie en haar herkenningstekst blijven onaangeroerd");
});
