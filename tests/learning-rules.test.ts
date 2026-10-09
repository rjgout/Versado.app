import test from "node:test";
import assert from "node:assert/strict";
import { contentKeyForChapter } from "../src/lib/learning/contentIdentity";
import { planChapterExercises, pickChapterExercises, pickPartExercises, splitVerseRange, partForRange } from "../src/lib/learning/exercisePlan";
import { applyAttempt, maxContentBaseXp, withLegacy, COMPLETION_BONUS, XP_PER_CORRECT } from "../src/lib/learning/rewards";
import { qualifiesForStreak } from "../src/lib/learning/streakRules";
import { estimateReadingMinutes, isLongChapter, countWords } from "../src/lib/learning/readingTime";
import { resolveContentState } from "../src/lib/learning/progressState";

// Een hoofdstuk van `verses` verzen met `perVerse` vragen per vers.
function chapterExercises(verses: number, perVerse: number, prefix = "e") {
  const list: { id: string; verseNumber: number | null }[] = [];
  for (let v = 1; v <= verses; v++) for (let i = 0; i < perVerse; i++) list.push({ id: `${prefix}${v}-${i}`, verseNumber: v });
  return list;
}

test("dezelfde inhoud heeft in elke taal en route dezelfde sleutel", () => {
  assert.equal(contentKeyForChapter({ id: "nl-1", number: 5, bookKey: "bofm/1-ne" }), "bofm/1-ne#5");
  assert.equal(contentKeyForChapter({ id: "en-1", number: 5, bookKey: "bofm/1-ne" }), "bofm/1-ne#5");
  // Een nieuw boek zonder kerksleutel valt terug op het hoofdstuk zelf.
  assert.equal(contentKeyForChapter({ id: "x", number: 1, bookKey: null }), "chapter:x");
});

test("oefenplan: 4 delen van 3 vragen = 12 vragen, in elke route", () => {
  const plan = planChapterExercises(40, chapterExercises(40, 1));
  assert.equal(plan.parts.length, 4);
  assert.deepEqual(plan.parts.map((p) => p.count), [3, 3, 3, 3]);
  assert.equal(plan.total, 12);
  // De delen zijn exact de stappen van Stap voor stap.
  assert.deepEqual(plan.parts.map(({ startVerse, endVerse }) => ({ startVerse, endVerse })), splitVerseRange(40));
});

test("oefenplan: een deel met minder vragen telt alleen wat er is", () => {
  const exercises = [...chapterExercises(10, 1), { id: "los", verseNumber: 15 }];
  const plan = planChapterExercises(20, exercises);
  assert.deepEqual(plan.parts.map((p) => p.count), [3, 1]);
  assert.equal(plan.total, 4);
});

test("oefenplan: vragen zonder bronvers horen bij het laatste deel", () => {
  const plan = planChapterExercises(20, [{ id: "a", verseNumber: null }]);
  assert.deepEqual(plan.parts.map((p) => p.pool), [[], ["a"]]);
});

test("willekeurige vragen: altijd het juiste totaal, per deel uit de eigen verzen", () => {
  const plan = planChapterExercises(77, chapterExercises(77, 2));
  for (let run = 0; run < 25; run++) {
    const picked = pickChapterExercises(plan);
    assert.equal(picked.length, plan.total);
    assert.equal(new Set(picked).size, picked.length, "geen dubbele vragen");
  }
  const part = partForRange(plan, plan.parts[2].startVerse, plan.parts[2].endVerse)!;
  const stepPick = pickPartExercises(part);
  assert.equal(stepPick.length, part.count);
  assert.ok(stepPick.every((id) => part.pool.includes(id)));
});

test("routes zijn gelijkwaardig: dezelfde maximale basis-XP voor dezelfde inhoud", () => {
  const plan = planChapterExercises(40, chapterExercises(40, 2));
  const max = maxContentBaseXp(plan.total);
  // Hoofdstuk voor hoofdstuk: één set van N, alles goed.
  const whole = applyAttempt({ answered: 0, rewardCorrect: 0, bonusAwarded: false }, plan.total, { newAnswered: plan.total, newCorrect: plan.total, correct: plan.total });
  // Stap voor stap: per deel de vragen van dat deel.
  let state = { answered: 0, rewardCorrect: 0, bonusAwarded: false };
  let steps = 0;
  for (const part of plan.parts) {
    const outcome = applyAttempt(state, plan.total, { newAnswered: part.count, newCorrect: part.count, correct: part.count });
    steps += outcome.baseXp + outcome.bonusXp;
    state = outcome.next;
  }
  assert.equal(whole.baseXp + whole.bonusXp, max);
  assert.equal(steps, max);
  assert.equal(max, 12 * XP_PER_CORRECT + COMPLETION_BONUS);
});

test("geen dubbele basis-XP via een andere route; herhaling geeft alleen de korting", () => {
  const total = 12;
  const first = applyAttempt({ answered: 0, rewardCorrect: 0, bonusAwarded: false }, total, { newAnswered: 12, newCorrect: 12, correct: 12 });
  assert.equal(first.baseXp + first.bonusXp, maxContentBaseXp(total));
  // Daarna dezelfde inhoud via een andere route: alle vragen nieuw, maar de
  // inhoud is al volledig beloond.
  const again = applyAttempt(first.next, total, { newAnswered: 12, newCorrect: 12, correct: 12 });
  assert.equal(again.baseXp, 0);
  assert.equal(again.bonusXp, 0);
  assert.ok(again.repeatXp > 0 && again.repeatXp < first.baseXp / 5);
});

test("gedeeltelijke voortgang blijft staan en vult later aan tot het maximum", () => {
  const total = 12;
  const partial = applyAttempt({ answered: 0, rewardCorrect: 0, bonusAwarded: false }, total, { newAnswered: 12, newCorrect: 8, correct: 8 });
  assert.equal(partial.baseXp, 80);
  assert.equal(partial.bonusXp, 0);
  assert.equal(partial.completedNow, true);
  const better = applyAttempt(partial.next, total, { newAnswered: 0, newCorrect: 4, correct: 12 });
  assert.equal(better.baseXp, 40);
  assert.equal(better.bonusXp, COMPLETION_BONUS);
  assert.equal(partial.baseXp + better.baseXp + better.bonusXp, maxContentBaseXp(total));
});

test("oude voortgang telt als al beloond: geen dubbele XP na de migratie", () => {
  const empty = { answered: 0, rewardCorrect: 0, bonusAwarded: false };
  // Oud: 7 vragen allemaal goed = 90 XP. Nieuw is het hoofdstuk 12 vragen
  // (140 XP) waard: alleen het verschil is nog te verdienen.
  const legacy = withLegacy(empty, { legacyXp: 90, legacyCompleted: true }, 12);
  assert.deepEqual(legacy, { answered: 12, rewardCorrect: 9, bonusAwarded: false });
  const after = applyAttempt(legacy, 12, { newAnswered: 12, newCorrect: 12, correct: 12 });
  assert.equal(90 + after.baseXp + after.bonusXp, maxContentBaseXp(12));
  // Wie toen al het maximum (of meer) haalde, krijgt niets extra.
  const full = withLegacy(empty, { legacyXp: 200, legacyCompleted: true }, 12);
  const none = applyAttempt(full, 12, { newAnswered: 12, newCorrect: 12, correct: 12 });
  assert.equal(none.baseXp + none.bonusXp, 0);
  // Zonder oude voortgang verandert er niets.
  assert.deepEqual(withLegacy(empty, { legacyXp: 0, legacyCompleted: false }, 12), empty);
});

test("reeks: elke echt afgeronde activiteit telt, ook een korte of een uitdrukkelijk afgeronde leesstap", () => {
  // Een uitdrukkelijke leesafronding is één afronding; alleen openen/scrollen heeft geen afronding.
  assert.equal(qualifiesForStreak({ kind: "READING", answered: 1, required: 1 }), true);
  assert.equal(qualifiesForStreak({ kind: "READING", answered: 0, required: 1 }), false, "niets afgerond");
  assert.equal(qualifiesForStreak({ kind: "GAME", answered: 1, required: 1 }), true, "ook zonder XP of score");
  assert.equal(qualifiesForStreak({ kind: "PRACTICE", answered: 1, required: 1 }), true, "een korte ronde telt");
  assert.equal(qualifiesForStreak({ kind: "COURSE_LESSON", answered: 1, required: 1 }), true);
  assert.equal(qualifiesForStreak({ kind: "CONTENT_EXERCISES", answered: 12, required: 12 }), true);
  assert.equal(qualifiesForStreak({ kind: "CONTENT_EXERCISES", answered: 0, required: 0 }), false, "lege inzending");
  assert.equal(qualifiesForStreak({ kind: "CONTENT_EXERCISES", answered: 2, required: 3 }), false, "niet afgemaakt");
  assert.equal(qualifiesForStreak({ kind: "GAME", answered: 1, required: 1 }), true);
});

test("leestijd: lang hoofdstuk krijgt een tip, een normaal hoofdstuk niet", () => {
  assert.equal(countWords("  En het geschiedde  dat "), 4);
  assert.equal(estimateReadingMinutes(1055), 8);
  assert.equal(isLongChapter(estimateReadingMinutes(1055)), false);
  assert.equal(isLongChapter(estimateReadingMinutes(2400)), true);
  assert.equal(estimateReadingMinutes(0), 0);
});

test("status: gelezen en oefeningen staan los van elkaar", () => {
  const base = { readStatus: null, readVerse: 0, exerciseAnswered: 0, rewardCorrect: 0, rewardBonusAt: null, legacyScore: null, legacyXp: 0, legacyCompleted: false } as const;
  const readOnly = resolveContentState({ ...base, readStatus: "READ" }, 12);
  assert.equal(readOnly.read, "READ");
  assert.equal(readOnly.exercisesAnswered, 0);
  assert.equal(readOnly.done, false);
  const both = resolveContentState({ ...base, readStatus: "READ", exerciseAnswered: 12, rewardCorrect: 9 }, 12);
  assert.equal(both.done, true);
  assert.equal(both.exerciseScore, 75);
  // Zonder vragen is lezen genoeg.
  assert.equal(resolveContentState({ ...base, readStatus: "READ" }, 0).done, true);
  assert.equal(resolveContentState(null, 12).read, "UNREAD");
});
