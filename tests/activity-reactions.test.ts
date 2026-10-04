import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_REACTION_BATCH_WINDOW_MS, uniqueReactionNames } from "../src/lib/activityReactionNotifications";
import { otherReactionCount, selectReactionPreview } from "../src/lib/activityReactionPreview";

test("reactiebatch: één persoon staat maar één keer in de namenlijst", () => {
  const names = uniqueReactionNames([
    { userId: "peter", name: "Peter#02", createdAt: new Date("2026-01-01T12:02:00Z") },
    { userId: "anna", name: "Anna#01", createdAt: new Date("2026-01-01T12:01:00Z") },
    { userId: "peter", name: "Peter#02", createdAt: new Date("2026-01-01T12:03:00Z") },
  ]);
  assert.deepEqual(names, ["Anna#01", "Peter#02"]);
});

test("reactiebatch: het bundelingsvenster is vijftien minuten", () => {
  assert.equal(ACTIVITY_REACTION_BATCH_WINDOW_MS, 15 * 60 * 1000);
});

test("reactiepreview: maximaal vijf, vrienden eerst en chronologisch binnen beide groepen", () => {
  const reactions = ["a", "b", "c", "d", "e", "f", "g"].map((userId, index) => ({
    id: userId,
    userId,
    createdAt: new Date(2026, 0, 1, 12, index),
  }));
  const preview = selectReactionPreview(reactions, new Set(["f", "g"]));
  assert.deepEqual(preview.map((reaction) => reaction.userId), ["f", "g", "a", "b", "c"]);
  assert.equal(otherReactionCount(7, preview.length), 2);
});

test("reactiepreview: nul tot vijf reacties geeft geen overige teller", () => {
  for (let total = 0; total <= 5; total++) assert.equal(otherReactionCount(total, total), 0);
  assert.equal(otherReactionCount(6, 5), 1);
  assert.equal(otherReactionCount(17, 5), 12);
});
