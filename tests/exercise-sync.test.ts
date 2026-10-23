// De pure regels voor stabiele oefen-identiteit (src/lib/exerciseSync.ts): geen database nodig.
import test from "node:test";
import assert from "node:assert/strict";
import { exerciseSignature, optionsFingerprint, planExerciseSync } from "../src/lib/exerciseSync";

const base = { type: "FILL_BLANK", verseRef: "Alma 1:1", prompt: "De ____ kwam.", answers: JSON.stringify(["man"]), wordBank: null, options: [{ label: "man", isCorrect: true }, { label: "vrouw", isCorrect: false }] };

test("dezelfde inhoud geeft dezelfde handtekening, ook als de afleiders of hun volgorde veranderen", () => {
  assert.equal(exerciseSignature(base), exerciseSignature({ ...base }));
  assert.equal(exerciseSignature(base), exerciseSignature({ ...base, options: [{ label: "kind", isCorrect: false }, { label: "man", isCorrect: true }] }), "afleiders horen niet bij de identiteit");
  assert.notEqual(optionsFingerprint(base.options), optionsFingerprint([{ label: "kind", isCorrect: false }, { label: "man", isCorrect: true }]), "maar een andere optielijst wordt wel herkend");
});

test("een ander antwoord, andere vraag of ander juist antwoord is een andere oefening", () => {
  const signature = exerciseSignature(base);
  assert.notEqual(signature, exerciseSignature({ ...base, answers: JSON.stringify(["vrouw"]) }));
  assert.notEqual(signature, exerciseSignature({ ...base, prompt: "De ____ ging." }));
  assert.notEqual(signature, exerciseSignature({ ...base, options: [{ label: "man", isCorrect: false }, { label: "vrouw", isCorrect: true }] }), "wisselt het juiste antwoord, dan nooit als dezelfde vraag behandelen");
  assert.notEqual(signature, exerciseSignature({ ...base, verseRef: "Alma 1:2" }));
  assert.notEqual(signature, exerciseSignature({ ...base, wordBank: JSON.stringify(["a"]) }));
});

test("koppelen: elke bestaande oefening hooguit één keer, in volgorde; dubbele inhoud blijft stabiel", () => {
  const existing = [{ id: "a", signature: "x" }, { id: "b", signature: "x" }, { id: "c", signature: "y" }, { id: "d", signature: "z" }];
  const plan = planExerciseSync(existing, ["x", "y", "x", "x", "w"]);
  assert.deepEqual(plan.keep.map((row) => row?.id ?? null), ["a", "c", "b", null, null]);
  assert.deepEqual(plan.unmatched.map((row) => row.id), ["d"]);
  // Herhaald met exact dezelfde set: alles gekoppeld, niets over.
  const again = planExerciseSync(existing, ["x", "x", "y", "z"]);
  assert.deepEqual(again.keep.map((row) => row?.id), ["a", "b", "c", "d"]);
  assert.deepEqual(again.unmatched, []);
});
