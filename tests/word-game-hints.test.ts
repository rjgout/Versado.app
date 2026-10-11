import test from "node:test";
import assert from "node:assert/strict";
import bomWords from "../prisma/bomWords.json";
import { createWordGameHintPools, readWordGameHintPools, wordGameHintCounts, wordGameHintsView } from "../src/lib/wordGameHintRules";
import { serverCountdownSeconds } from "../src/lib/useServerCountdown";
import { getTopic } from "../src/lib/kompas/registry";
import { generalEntry } from "../src/lib/kompas/resolve";
import { getT, messagesFor } from "../src/lib/i18n";
import { nl } from "../src/lib/i18n/messages/nl";
import { scopesForEvent, dataEventsForSocketEvent } from "../src/lib/data/scopes";

const words = bomWords.filter((word) => word.length === 5);

test("de vijf lijsten zijn geldig, alfabetisch en echte subsets met het doelwoord", () => {
  assert.equal(new Set(words).size, 716);
  for (const target of [words[0], words[200], words.at(-1)!]) {
    const pools = createWordGameHintPools(words, target);
    assert.deepEqual(pools.lists.map((list) => list.length), [716, 180, 50, 15, 5]);
    assert.deepEqual(pools.lists[0], [...words].sort());
    pools.lists.forEach((list, index) => {
      assert.ok(list.includes(target));
      assert.deepEqual(list, [...list].sort());
      assert.ok(list.every((word) => words.includes(word)));
      if (index) assert.ok(list.every((word) => pools.lists[index - 1].includes(word)));
    });
    assert.deepEqual(readWordGameHintPools(JSON.stringify(pools), target), pools);
  }
});

test("kleinere toekomstige bronnen verkleinen echt en stoppen zodra één kandidaat overblijft", () => {
  assert.deepEqual(wordGameHintCounts(1000), [1000, 180, 50, 15, 5]);
  assert.deepEqual(wordGameHintCounts(3), [3, 2, 1]);
  assert.deepEqual(wordGameHintCounts(1), [1]);
  assert.throws(() => createWordGameHintPools(["nephi"], "ander"));
});

test("betaalde lijsten zijn bevroren en onthullen uitsluitend het vrijgegeven niveau", () => {
  const pools = JSON.stringify(createWordGameHintPools(words, "nephi"));
  const game = { word: "nephi", hintLevel: 2, hintPools: pools };
  const first = wordGameHintsView(game, null, 716);
  assert.deepEqual(wordGameHintsView(game, null, 900), first);
  assert.deepEqual(Object.keys(first).sort(), ["candidates", "level", "nextCount", "nextHintAt"]);
  assert.equal(first.candidates.length, 180);
  assert.equal(first.nextCount, 50);
  assert.deepEqual(wordGameHintsView({ word: "nephi", hintLevel: 0, hintPools: null }, null, 716).candidates, []);
  const invalid = JSON.parse(pools); invalid.lists[1][0] = "xxxxx";
  assert.throws(() => readWordGameHintPools(JSON.stringify(invalid), "nephi"));
});

test("de secondenklok gebruikt serverankers en monotone verstreken tijd", () => {
  const now = Date.parse("2026-10-11T13:47:30Z");
  const until = "2026-10-11T14:47:30Z";
  assert.equal(serverCountdownSeconds(until, now, 200, 200), 3600);
  assert.equal(serverCountdownSeconds(until, now, 200, 3_600_199), 1);
  assert.equal(serverCountdownSeconds(until, now, 200, 3_600_200), 0);
  assert.equal(serverCountdownSeconds(null, now, 200, 200), 0);
});

test("Kompas en alle talen bevatten dezelfde betaalregels en alle nieuwe teksten", () => {
  const topic = getTopic("play.word-game")!;
  assert.equal(topic.version, 2);
  for (const language of ["nl", "en", "de", "fr", "es"]) {
    const t = getT(language);
    assert.equal(generalEntry(t, topic).steps.at(-1), t("gamesHub.wordGame.rule4"));
    const own = language === "nl" ? nl : messagesFor(language);
    for (const key of Object.keys(nl.wordOfTheDay).filter((key) => key.startsWith("hint"))) {
      assert.equal(typeof (own.wordOfTheDay as Record<string, unknown>)[key], "string", `${language}:${key}`);
    }
  }
  assert.ok(scopesForEvent("hintsChanged").includes("wordGame"));
  assert.deepEqual(dataEventsForSocketEvent("hints_changed"), ["hintsChanged"]);
});
