import test from "node:test";
import assert from "node:assert/strict";
import { compareRecords, hintCategoryFor } from "../src/lib/puzzle/records";
import { formatPuzzleTime } from "../src/lib/puzzle/recordFormat";

const rec = (over: Partial<Parameters<typeof compareRecords>[0]> = {}) => ({ elapsedMs: 100_000, extraHintsUsed: 0, hintsUsed: 0, completedAt: new Date("2026-01-01T00:00:00Z"), userId: "u1", sessionId: "s1", ...over });

test("hintcategorie: iedere hint, ook een inbegrepen hint, telt als hintgebruik", () => {
  assert.equal(hintCategoryFor(0), "NO_HINTS");
  assert.equal(hintCategoryFor(1), "WITH_HINTS");
  assert.equal(hintCategoryFor(7), "WITH_HINTS");
});

test("volgorde: milliseconden, dan persoonlijke extra hints, dan hints totaal, dan vroegste voltooiing, dan stabiele sleutel", () => {
  assert.ok(compareRecords(rec({ elapsedMs: 99_999.5 }), rec()) < 0, "de officiële milliseconden beslissen");
  assert.ok(compareRecords(rec({ extraHintsUsed: 0 }), rec({ extraHintsUsed: 1 })) < 0);
  assert.ok(compareRecords(rec({ hintsUsed: 1 }), rec({ hintsUsed: 2 })) < 0);
  assert.ok(compareRecords(rec({ completedAt: new Date("2025-12-31T00:00:00Z") }), rec()) < 0);
  assert.ok(compareRecords(rec({ userId: "a" }), rec({ userId: "b" })) < 0);
  assert.equal(compareRecords(rec(), rec()), 0, "identiek is gelijk (dus niet strikt beter: idempotent)");
  // Een snellere tijd met meer hints wint nog steeds in zijn eigen categorie (de categorie scheidt, de tijd rangschikt).
  assert.ok(compareRecords(rec({ elapsedMs: 90_000, extraHintsUsed: 5, hintsUsed: 9 }), rec()) < 0);
});

test("weergave rondt alleen af voor tonen; twee tijden op dezelfde seconde blijven intern verschillend", () => {
  assert.equal(formatPuzzleTime(0), "0:00.0");
  assert.equal(formatPuzzleTime(12_345), "0:12.3");
  assert.equal(formatPuzzleTime(135_999), "2:15");
  assert.equal(formatPuzzleTime(3_725_000), "1:02:05");
  assert.equal(formatPuzzleTime(135_100), formatPuzzleTime(135_900), "boven een minuut op de seconde");
  assert.ok(compareRecords(rec({ elapsedMs: 135_100 }), rec({ elapsedMs: 135_900 })) < 0);
});
