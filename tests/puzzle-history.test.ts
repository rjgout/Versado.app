import test from "node:test";
import assert from "node:assert/strict";
import { HISTORY_MAX_PAGE_SIZE, compareHistory, cursorOf, decodeCursor, encodeCursor, pageOfHistory, type HistoryItem } from "../src/lib/puzzle/history";
import { classifyPuzzleRoute, HISTORY_ROUTE, JIGSAW_ROUTE } from "../src/lib/puzzle/navigation";
import { shellModeForRoute } from "../src/lib/focusMode";

// Afgeronde geschiedenis zonder database: volgorde, cursor en pagina's, plus de route.

const item = (kind: "COOP" | "MATCH", id: string, at: string): HistoryItem => ({ key: `${kind === "COOP" ? "coop" : "match"}:${id}`, kind, id, finishedAt: at, pieceCount: 24, players: ["A"] });

test("volgorde: nieuwste eerst, bij gelijke tijd de wedstrijd vóór samen en dan het grootste id", () => {
  const list = [item("COOP", "a", "2026-01-01T10:00:00.000Z"), item("MATCH", "b", "2026-01-01T10:00:00.000Z"), item("COOP", "z", "2026-01-01T10:00:00.000Z"), item("MATCH", "c", "2026-02-01T00:00:00.000Z")];
  assert.deepEqual(pageOfHistory(list, 10).items.map((i) => i.id), ["c", "b", "z", "a"]);
  assert.deepEqual(pageOfHistory([...list].reverse(), 10).items.map((i) => i.id), ["c", "b", "z", "a"], "onafhankelijk van de invoervolgorde");
  assert.ok(compareHistory({ t: 2, r: 0, id: "a" }, { t: 1, r: 1, id: "z" }) < 0);
});

test("pagina: nooit meer dan de limiet en nextCursor precies als er meer is", () => {
  const list = Array.from({ length: 5 }, (_, i) => item("COOP", `id${i}`, new Date(2026, 0, 1 + i).toISOString()));
  const page = pageOfHistory(list, 3); assert.equal(page.items.length, 3); assert.ok(page.nextCursor);
  assert.equal(pageOfHistory(list, 5).nextCursor, null); assert.equal(pageOfHistory([], 5).nextCursor, null);
  assert.deepEqual(decodeCursor(page.nextCursor), cursorOf(page.items[2]), "de cursor wijst naar het laatste getoonde item");
  assert.ok(HISTORY_MAX_PAGE_SIZE <= 100);
});

test("cursor: heen en terug, en elke ongeldige of geknoeide waarde wordt geweigerd", () => {
  const cursor = { t: 1_700_000_000_000, r: 1 as const, id: "abc" };
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  const bad = ["", "xyz", "!!!", encodeCursor({ ...cursor, id: "" }), Buffer.from("{}").toString("base64url"), Buffer.from(JSON.stringify([1, 2, "x"])).toString("base64url"), Buffer.from(JSON.stringify(["a", 0, "x"])).toString("base64url"), Buffer.from(JSON.stringify([1, 0, 5])).toString("base64url"), "a".repeat(300)];
  for (const value of bad) assert.equal(decodeCursor(value), null, value.slice(0, 20));
  assert.equal(decodeCursor(null), null); assert.equal(decodeCursor(undefined), null);
});

test("route: de geschiedenis is een eigen pagina onder het overzicht, in de normale shell", () => {
  assert.deepEqual(classifyPuzzleRoute(HISTORY_ROUTE), { kind: "history", parent: JIGSAW_ROUTE });
  assert.equal(shellModeForRoute(HISTORY_ROUTE), "normal");
  assert.equal(shellModeForRoute(JIGSAW_ROUTE), "focus", "de hub blijft Focus");
});
