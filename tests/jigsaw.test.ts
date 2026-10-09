import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import manifest from "../prisma/kidsManifest.json";

process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
process.env.DATABASE_URL ??= "postgresql://geen:geen@localhost:5432/geen";

import {
  JIGSAW_OPTION_COUNT,
  JIGSAW_QUESTION_LANGUAGES,
  jigsawQuestions,
  jigsawQuestionsForStory,
} from "../src/lib/jigsawQuestions";
import { jigsawCatalog, jigsawImages, placeJigsawPiece, resumeJigsaw, startJigsaw } from "../src/lib/jigsawGame";
import { jigsawGrid, JIGSAW_LEVELS, type JigsawState } from "../src/lib/jigsaw";

// --- Koppeling afbeelding -> verhaal -------------------------------------------

test("elke puzzelafbeelding hoort bij precies één verhaal uit het manifest", () => {
  const owner = new Map<string, number>();
  for (const story of manifest) {
    for (const url of story.images) {
      assert.ok(!owner.has(url) || owner.get(url) === story.number, `${url} hoort bij twee verhalen`);
      owner.set(url, story.number);
    }
  }
  assert.equal(jigsawCatalog.length, owner.size);
  for (const image of jigsawCatalog) assert.equal(owner.get(image.url), image.story);
  assert.deepEqual(jigsawImages, jigsawCatalog.map((image) => image.url));
});

// --- Vragenbank ----------------------------------------------------------------

test("elk verhaal heeft minstens drie vragen, in alle vijf de talen", () => {
  for (const story of manifest) {
    assert.ok(jigsawQuestionsForStory(story.number).length >= 3, `verhaal ${story.number} heeft te weinig vragen`);
  }
  assert.deepEqual([...new Set(jigsawQuestions.map((q) => q.story))].sort((a, b) => a - b), manifest.map((s) => s.number));
});

test("vragen zijn volledig en eenduidig: drie verschillende opties en een uniek id", () => {
  const ids = new Set<string>();
  for (const question of jigsawQuestions) {
    assert.ok(!ids.has(question.id), `dubbel id ${question.id}`);
    ids.add(question.id);
    for (const lang of JIGSAW_QUESTION_LANGUAGES) {
      assert.ok(question.text[lang]?.trim().endsWith("?"), `${question.id}/${lang}: vraagtekst`);
      const options = question.options[lang];
      assert.equal(options.length, JIGSAW_OPTION_COUNT, `${question.id}/${lang}: aantal opties`);
      assert.equal(new Set(options.map((o) => o.trim().toLowerCase())).size, JIGSAW_OPTION_COUNT, `${question.id}/${lang}: dubbele opties`);
      for (const option of options) assert.ok(option.trim().length > 0, `${question.id}/${lang}: lege optie`);
    }
  }
});

test("de vragenbank noemt geen vraag twee keer binnen een verhaal", () => {
  for (const story of manifest) {
    const texts = jigsawQuestionsForStory(story.number).map((q) => q.text.nl);
    assert.equal(new Set(texts).size, texts.length, `verhaal ${story.number}`);
  }
});

test("cijfers en eigennamen in het juiste antwoord komen terug in het verhaal", () => {
  // Vangnet tegen een verkeerd feit: het goede antwoord van de vraag moet,
  // voor zover het uit één woord of getal bestaat, in de brontekst staan.
  const text = new Map(manifest.map((s) => [s.number, s.text.toLowerCase()]));
  const exceptions = new Set(["Veertien jaar", "Tweeduizend", "Zestien jaar", "Twaalf dagen", "Vijfduizend vierhonderd", "Drieëndertig jaar", "Tweehonderd jaar", "Vier jaar", "Eén", "Vier", "Negen", "Drie dagen", "Twee dagen en nachten"]);
  for (const question of jigsawQuestions) {
    const correct = question.options.nl[0];
    if (exceptions.has(correct) || /\s/.test(correct)) continue;
    assert.ok(text.get(question.story)!.includes(correct.toLowerCase().replace(/[’']s$/, "")), `${question.id}: "${correct}" niet in verhaal ${question.story}`);
  }
});

// --- Spelverloop ---------------------------------------------------------------

async function solve(state: JigsawState, language = "nl") {
  const { columns, rows } = jigsawGrid(state.pieces);
  let current = state;
  for (const piece of state.order) {
    const placed = await placeJigsawPiece("u1", current.token, piece, ((piece % columns) + 0.5) / columns, (Math.floor(piece / columns) + 0.5) / rows, language);
    assert.ok(placed?.accepted);
    current = placed!;
  }
  return current;
}

test("de vraag verschijnt pas als de puzzel compleet is en bevat nooit het goede antwoord", async () => {
  const start = await startJigsaw("u1", 0, 6);
  assert.equal(start.question, undefined);
  const { columns, rows } = jigsawGrid(6);
  let current = start;
  for (const [index, piece] of start.order.entries()) {
    const placed = await placeJigsawPiece("u1", current.token, piece, ((piece % columns) + 0.5) / columns, (Math.floor(piece / columns) + 0.5) / rows, "nl");
    current = placed!;
    if (index < start.order.length - 1) assert.equal(current.question, undefined, "te vroeg een vraag");
  }
  assert.ok(current.complete);
  assert.ok(current.question);
  assert.equal(current.question!.options.length, JIGSAW_OPTION_COUNT);
  const serialized = JSON.stringify(current);
  assert.ok(!/correct|answer|antwoord/i.test(serialized.replace(current.question!.text, "").replace(JSON.stringify(current.question!.options), "")), "goede antwoord in respons");
});

test("een foute plaatsing vult de puzzel niet en geeft geen vraag", async () => {
  const start = await startJigsaw("u1", 3, 12);
  const result = await placeJigsawPiece("u1", start.token, start.order[0], 0.99, 0.99, "nl");
  assert.equal(result!.accepted, start.order[0] === 11);
  assert.equal(result!.question, undefined);
});

test("verversen geeft dezelfde vraag, in de taal van de speler", async () => {
  const start = await startJigsaw("u1", 10, 6);
  const done = await solve(start, "nl");
  const again = await resumeJigsaw("u1", done.token, "nl");
  assert.deepEqual(again!.question, done.question);
  const english = await resumeJigsaw("u1", done.token, "en");
  assert.equal(english!.question!.options.length, JIGSAW_OPTION_COUNT);
  assert.notEqual(english!.question!.text, done.question!.text);
  // Een onbekende taal valt terug op Nederlands.
  const fallback = await resumeJigsaw("u1", done.token, "xx");
  assert.deepEqual(fallback!.question, done.question);
  // Nog een plaatsing na afloop wisselt de vraag niet.
  const replay = await placeJigsawPiece("u1", done.token, done.order[0], 0.5, 0.5, "nl");
  assert.deepEqual(replay!.question, done.question);
});

test("de vraag hoort bij het verhaal van de gekozen afbeelding", async () => {
  for (const imageIndex of [0, 5, 77, jigsawCatalog.length - 1]) {
    const done = await solve(await startJigsaw("u1", imageIndex, 6));
    const storyQuestions = jigsawQuestionsForStory(jigsawCatalog[imageIndex].story).map((q) => q.text.nl);
    assert.ok(storyQuestions.includes(done.question!.text), `afbeelding ${imageIndex}`);
  }
});

test("een token van een andere gebruiker of een gewijzigd token wordt geweigerd", async () => {
  const start = await startJigsaw("u1", 0, 6);
  assert.equal(await resumeJigsaw("u2", start.token, "nl"), null);
  assert.equal(await resumeJigsaw("u1", start.token + "x", "nl"), null);
});

test("6 en 48 stukjes volgen dezelfde regels: alleen het aantal stukjes verschilt", async () => {
  for (const pieces of [6, 48] as const) {
    const done = await solve(await startJigsaw("u1", 1, pieces));
    assert.ok(done.complete && done.question, `${pieces} stukjes`);
  }
  assert.deepEqual([...JIGSAW_LEVELS], [6, 12, 24, 48]);
});

// --- Contract met reeks, XP en Woordzoeker ---------------------------------------

test("de puzzel geeft geen XP en de reeks loopt uitsluitend via completeJigsaw", () => {
  const game = readFileSync("src/lib/jigsawGame.ts", "utf8");
  const streak = readFileSync("src/lib/streak.ts", "utf8");
  assert.ok(!/awardXp|awardCompetitionXp/.test(game), "de puzzel kent geen XP");
  assert.ok(!/currentStreak\s*[+]{2}|currentStreak:\s*\{\s*increment/.test(game));
  const block = streak.slice(streak.indexOf("export async function completeJigsaw"));
  assert.ok(block.includes("jigsaw:${attemptId}") && block.includes("finishActivity(") && block.includes("null,"), "geen XP-bedrag");
});

test("Woordzoeker blijft een tijdelijke uitzondering: geen reeks-aanroep", () => {
  const game = readFileSync("src/lib/wordSearch/game.ts", "utf8");
  assert.ok(!/recordLearningActivity|completeJigsaw|finishActivity/.test(game));
});
