import assert from "node:assert/strict";
import test from "node:test";
import { EXERCISE_FEEDBACK_OPTIONS, isExerciseFeedbackCategory } from "../src/lib/exerciseFeedback";
import { exerciseProgress } from "../src/lib/exerciseProgress";

test("cursusprogressie begint op nul en loopt alleen vooruit na controleren", () => {
  assert.deepEqual(exerciseProgress(0, 5, false), { answered: 0, total: 5, percent: 0 });
  assert.deepEqual(exerciseProgress(0, 5, true), { answered: 1, total: 5, percent: 20 });
  assert.deepEqual(exerciseProgress(4, 5, true), { answered: 5, total: 5, percent: 100 });
  assert.deepEqual(exerciseProgress(5, 5, true), { answered: 5, total: 5, percent: 100 });
});

test("vraagfeedbackcategorieën hebben een vaste volgorde en stabiele codes", () => {
  assert.deepEqual(EXERCISE_FEEDBACK_OPTIONS.map((option) => option.code), [
    "ANSWER_SHOULD_BE_ACCEPTED",
    "ANSWER_SHOULD_BE_REJECTED",
    "QUESTION_UNCLEAR",
    "ANSWERS_INCORRECT",
    "VISUAL_BROKEN",
    "OTHER",
  ]);
  assert.equal(isExerciseFeedbackCategory("QUESTION_UNCLEAR"), true);
  assert.equal(isExerciseFeedbackCategory("Mijn antwoord was goed"), false);
});
