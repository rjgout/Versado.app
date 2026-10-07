import test from "node:test";
import assert from "node:assert/strict";
import { MYSTERY_GAME } from "@/lib/mysteries/game";
import { characterCluesFor } from "@/lib/mysteries/characterClues";
import { closingQuestionFor } from "@/lib/mysteries/closingQuestions";

test("ieder speelbaar personage heeft minstens één eigen character-clue", () => {
  for (const definition of MYSTERY_GAME.puzzles) {
    for (const character of definition.characters) {
      const clues = characterCluesFor(definition, character.id);
      assert.ok(clues.length > 0, `${definition.id}/${character.id} heeft geen uitspraak`);
      for (const clue of clues) assert.notEqual(clue.textKey, "", `${definition.id}/${character.id} heeft lege tekst`);
    }
  }
});

test("elk mysterie heeft één data-driven slotvraag met precies één correct antwoord", () => {
  const seen = new Set<string>();
  for (const definition of MYSTERY_GAME.puzzles) {
    if (seen.has(definition.mysteryId)) continue;
    seen.add(definition.mysteryId);
    const question = closingQuestionFor(definition);
    assert.ok(question.optionKeys.length >= 3);
    assert.equal(question.correctOption >= 0 && question.correctOption < question.optionKeys.length, true);
    assert.ok(question.explanationKey);
    assert.ok(question.scriptureReferenceKey);
  }
  assert.deepEqual([...seen], ["mystery-001", "mystery-002", "mystery-003", "mystery-004", "mystery-005", "mystery-006"]);
});
