import test from "node:test";
import assert from "node:assert/strict";
import { getT } from "../src/lib/i18n";
import { nl } from "../src/lib/i18n/messages/nl";
import { en } from "../src/lib/i18n/messages/en";
import { de } from "../src/lib/i18n/messages/de";
import { fr } from "../src/lib/i18n/messages/fr";
import { es } from "../src/lib/i18n/messages/es";
import { KOMPAS_TOPICS } from "../src/lib/kompas/registry";
import { generalEntry } from "../src/lib/kompas/resolve";

const keys = ["discovererDescription", "adventurerDescription", "expertDescription", "masterDescription", "pieceCountHelp", "useHint", "hintPanel", "hintsUnlimited", "hintsRemaining", "extraHintNotice", "hintPreview", "hintPreviewDescription", "hintLocation", "hintLocationDescription", "hintConnection", "hintConnectionDescription", "hintFilter", "hintFilterDescription", "hintCorners", "hintEdges", "hintMiddles", "hintSelectFirst", "hintActive", "closeHints", "legacyRules", "boardHelp", "hintStock", "hintPersonalCost", "hintConfirmUse", "hintEmpty", "hintShop", "hintNoConnection", "hintNoPieces", "hintInventoryFailed", "hintBack", "hintRefresh"] as const;

test("nieuwe Solo-uitleg en hintbediening zijn expliciet vertaald in alle vijf talen", () => {
  for (const messages of [nl,en,de,fr,es]) {
    const puzzle = messages.jigsaw!;
    for (const key of keys) { assert.equal(typeof puzzle[key], "string", key); assert.ok(puzzle[key]!.length > 0); }
    assert.ok(puzzle.hintsRemaining!.includes("{n}"));
    const descriptions = [puzzle.discovererDescription,puzzle.adventurerDescription,puzzle.expertDescription,puzzle.masterDescription];
    assert.equal(new Set(descriptions).size,4);
  }
});

test("Kompas toont bijgewerkte spelregels en houdt centrale vraag/reeks/geen-XP-uitleg", () => {
  const topic = KOMPAS_TOPICS.find((topic) => topic.id === "play.jigsaw")!;
  assert.equal(topic.version,4);
  for (const language of ["nl","en","de","fr","es"] as const) {
    const t = getT(language); const entry = generalEntry(t,topic);
    assert.equal(entry.steps.length,5);
    assert.ok(entry.steps[0].includes("96"));
    assert.ok(entry.steps[1].includes("3 / 2 / 1"));
    assert.ok(entry.steps[2].includes("XP"));
    assert.ok(entry.steps[3].length > 0 && entry.steps[4].length > 0, "Samen en Tegen elkaar staan in de uitleg");
  }
});
