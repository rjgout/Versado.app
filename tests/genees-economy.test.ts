import assert from "node:assert/strict";
import test from "node:test";
import { GENEES_BASE_PRICE_XP, GENEES_PRICE_STEP_XP, geneesPriceXp } from "../src/lib/genees/pricing";
import { deathOptionFor } from "../src/lib/snelleZendeling/runs";

// De ene canonieke prijsregel (winkel en in-game): 100 + voorraad × 25.
test("de Genees-prijs is 100 XP plus 25 XP per Genees op voorraad", () => {
  assert.equal(GENEES_BASE_PRICE_XP, 100);
  assert.equal(GENEES_PRICE_STEP_XP, 25);
  assert.equal(geneesPriceXp(0), 100);
  assert.equal(geneesPriceXp(1), 125);
  assert.equal(geneesPriceXp(2), 150);
  assert.equal(geneesPriceXp(3), 175);
  assert.equal(geneesPriceXp(4), 200);
  assert.equal(geneesPriceXp(10), 350);
  assert.equal(geneesPriceXp(1000), 25_100, "geen maximumprijs");
});

test("alleen de huidige voorraad bepaalt de prijs, niet wat eerder gekocht of gebruikt is", () => {
  // Voorraad 4 -> 200; drie gebruikt -> voorraad 1 -> weer 125.
  assert.equal(geneesPriceXp(4), 200);
  assert.equal(geneesPriceXp(4 - 3), 125);
});

test("een ongeldige voorraad wordt geweigerd in plaats van een prijs te raden", () => {
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => geneesPriceXp(bad), RangeError);
});

test("na een botsing: gratis Genees eerst, dan voorraad, dan één noodkoop, daarna niets", () => {
  const base = { hasQuestions: true, freeUsed: false, stock: 0, purchaseUsed: false };
  assert.equal(deathOptionFor(base), "free");
  assert.equal(deathOptionFor({ ...base, stock: 5 }), "free", "de gratis Genees gaat altijd voor de voorraad");
  assert.equal(deathOptionFor({ ...base, freeUsed: true, stock: 5 }), "stock");
  assert.equal(deathOptionFor({ ...base, freeUsed: true, stock: 0 }), "buy");
  assert.equal(deathOptionFor({ ...base, freeUsed: true, stock: 0, purchaseUsed: true }), "none");
  assert.equal(deathOptionFor({ ...base, freeUsed: true, stock: 2, purchaseUsed: true }), "stock", "de noodkoop-limiet raakt de voorraad niet");
  assert.equal(deathOptionFor({ ...base, hasQuestions: false }), "none", "zonder vragen is er geen Genees");
});
