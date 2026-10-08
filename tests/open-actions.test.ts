import assert from "node:assert/strict";
import test from "node:test";
import { compactOpenActions, type OpenActionsData } from "@/lib/openActions";

function action(index: number) {
  return { key: `game-turn-${index}`, tab: "required" as const, kind: "game-turn" as const, at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, person: null, subject: "Spel", href: "/spel" };
}

test("compact overzicht houdt de werkelijke teller bij", () => {
  const items = Array.from({ length: 20 }, (_, index) => action(index));
  const data: OpenActionsData = {
    items: { required: items, continue: [], waiting: [] },
    counts: { required: 20, continue: 0, waiting: 0 },
    activeContentCollectionId: "content",
  };
  const compact = compactOpenActions(data, "required");
  assert.equal(compact.actions.length, 3);
  assert.equal(compact.total, 20);
});

test("leeg overzicht heeft geen acties", () => {
  const data: OpenActionsData = { items: { required: [], continue: [], waiting: [] }, counts: { required: 0, continue: 0, waiting: 0 }, activeContentCollectionId: "content" };
  assert.deepEqual(compactOpenActions(data, "required"), { actions: [], total: 0 });
});
