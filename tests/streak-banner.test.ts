import test from "node:test";
import assert from "node:assert/strict";
import { earnedStreakBanner } from "../src/lib/streakBanner";
import { shouldClaimStreakCelebration } from "../src/lib/celebrationGate";
import type { StreakContinuationView } from "../src/lib/learning/streakReturnRules";

const before: StreakContinuationView = { status: "ACTIVE", currentStreak: 41, day: "2026-10-24", interruptedDay: null, completed: 0, required: 0, studiedToday: false };
const after = { ...before, currentStreak: 42, studiedToday: true };

test("een nieuwe bevestigde reeksdag geeft direct een banner terwijl de fullscreen claim wacht", () => {
  assert.deepEqual(earnedStreakBanner(before, after, false), { dayKey: after.day, streak: 42 });
  for (const pathname of ["/practice", "/jigsaw/samen/id", "/live/ABCD", "/snelle-zendeling/run/id"]) {
    assert.equal(shouldClaimStreakCelebration({ pathname, status: "ACTIVE", studiedToday: true, claiming: false }), false);
  }
});
test("openen, verversen en een tweede activiteit herhalen de banner niet", () => {
  assert.equal(earnedStreakBanner(null, after, false), null);
  assert.equal(earnedStreakBanner(after, after, false), null);
});
test("een reeks-event vóór de eerste refresh krijgt na serverbevestiging wel een banner", () => {
  assert.deepEqual(earnedStreakBanner(null, after, true), { dayKey: after.day, streak: 42 });
  assert.equal(earnedStreakBanner(null, before, true), null, "een event alleen verdient niets");
});
test("terugkeer telt pas na alle vereiste activiteiten", () => {
  const interrupted: StreakContinuationView = { ...before, status: "INTERRUPTED", required: 3, completed: 1, interruptedDay: "2026-10-20" };
  assert.equal(earnedStreakBanner(before, interrupted, false), null);
  assert.equal(earnedStreakBanner(interrupted, { ...interrupted, completed: 2 }, true), null);
  assert.deepEqual(earnedStreakBanner(interrupted, after, false), { dayKey: after.day, streak: 42 });
});
test("reizen, een dagwissel of een freeze zonder extra reeksdag geeft geen banner", () => {
  assert.equal(earnedStreakBanner(after, { ...after, day: "2026-10-25" }, false), null);
  assert.equal(earnedStreakBanner(before, { ...before, studiedToday: true }, false), null);
  assert.equal(earnedStreakBanner(before, { ...after, currentStreak: 0 }, true), null);
});
