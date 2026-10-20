import { test } from "node:test";
import assert from "node:assert/strict";
import { modeFromParam, modeParam, resolvePersonalStudyMode } from "../src/lib/studyContent/personalStudyMode";
import { originHref, originViewSchema } from "../src/lib/references/originView";
import { referenceTripSchema } from "../src/lib/references/tripContract";

test("een expliciete deeplink gaat voor de opgeslagen voorkeur", () => {
  assert.equal(resolvePersonalStudyMode("vrij", "STEPS"), "FREE");
  assert.equal(resolvePersonalStudyMode("stappen", "FREE"), "STEPS");
});
test("zonder deeplink geldt de voorkeur, zonder voorkeur Vrije studie", () => {
  assert.equal(resolvePersonalStudyMode(undefined, "STEPS"), "STEPS");
  assert.equal(resolvePersonalStudyMode(null, null), "FREE");
  assert.equal(resolvePersonalStudyMode("onzin", null), "FREE");
  assert.equal(modeFromParam("onzin"), null);
  assert.equal(modeParam("STEPS"), "stappen");
});
test("originHref bouwt alleen vaste vormen", () => {
  assert.equal(originHref("l1", "c1"), "/study-lesson/l1/c1");
  assert.equal(originHref("l1", "c1", { mode: "free" }), "/study-lesson/l1/c1");
  assert.equal(originHref("l1", "c1", { mode: "full" }), "/study-lesson/l1/c1?weergave=volledig");
  assert.equal(originHref("l1", "c1", { mode: "steps" }), "/study-lesson/l1/c1/stappen");
  assert.equal(originHref("l1", "c1", { mode: "steps", step: 4 }), "/study-lesson/l1/c1/stappen/4");
});
test("originViewSchema weigert ongeldige stappen en vrije velden", () => {
  assert.ok(originViewSchema.safeParse({ mode: "steps", step: 7 }).success);
  assert.ok(!originViewSchema.safeParse({ mode: "steps", step: 8 }).success);
  assert.ok(!originViewSchema.safeParse({ mode: "free", step: 2 }).success);
  assert.ok(!originViewSchema.safeParse({ mode: "full", href: "https://evil" }).success);
});
test("het retourbewijs accepteert de nieuwe origin-vormen en weigert andere", () => {
  const shape = referenceTripSchema.shape.originHref;
  for (const ok of ["/study-lesson/a/b", "/study-lesson/a/b/stappen", "/study-lesson/a/b/stappen/7", "/study-lesson/a/b?weergave=volledig"])
    assert.ok(shape.safeParse(ok).success, ok);
  for (const bad of ["/study-lesson/a/b/stappen/8", "/study-lesson/a/b/stappen/0", "//evil.test", "/study-lesson/a/b?x=1", "/study-lesson/a/b/stappen/1/2"])
    assert.ok(!shape.safeParse(bad).success, bad);
});
