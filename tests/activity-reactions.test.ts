import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_REACTION_BATCH_WINDOW_MS, uniqueReactionNames } from "../src/lib/activityReactionNotifications";

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
