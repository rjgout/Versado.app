import assert from "node:assert/strict";
import test from "node:test";
import { groupByBook, highlightWord, normalizeWord, parseRecent, pushRecent, searchWords, similarWords, startLetters, wordsStartingWith } from "../src/lib/dictionaryView";

const entries = [
  { word: "aanbidden", count: 12 }, { word: "begin", count: 40 }, { word: "geloof", count: 300 }, { word: "gelovig", count: 9 },
  { word: "gelovigen", count: 31 }, { word: "geloven", count: 77 }, { word: "ongeloof", count: 14 }, { word: "volgen", count: 5 },
];

test("zoeken: woorden die beginnen met de term staan voor woorden waar hij middenin staat; leeg geeft alles", () => {
  assert.deepEqual(searchWords(entries, "gelo").map((e) => e.word), ["geloof", "gelovig", "gelovigen", "geloven", "ongeloof"]);
  assert.deepEqual(searchWords(entries, "  GELOOF ").map((e) => e.word), ["geloof", "ongeloof"]);
  assert.equal(searchWords(entries, "").length, entries.length);
  assert.deepEqual(searchWords(entries, "zzz"), []);
});

test("zoeken: accenten en hoofdletters in de term maken niet uit", () => {
  assert.equal(normalizeWord("Él"), "el");
  assert.deepEqual(searchWords([{ word: "el", count: 1 }], "É").map((e) => e.word), ["el"]);
});

test("letters: alleen beginletters die voorkomen, en per letter de juiste woorden", () => {
  assert.deepEqual(startLetters(entries, "nl"), ["a", "b", "g", "o", "v"]);
  assert.deepEqual(wordsStartingWith(entries, "g").map((e) => e.word), ["geloof", "gelovig", "gelovigen", "geloven"]);
});

test("verwante woorden: zelfde stam, zonder het woord zelf, meest voorkomend eerst; korte woorden hebben er geen", () => {
  assert.deepEqual(similarWords(entries, "geloof").map((e) => e.word), ["geloven", "gelovigen", "gelovig"]);
  assert.deepEqual(similarWords(entries, "gelo"), [], "te kort voor een stam");
  assert.deepEqual(similarWords(entries, "volgen"), []);
  assert.equal(similarWords(Array.from({ length: 40 }, (_, i) => ({ word: `geloofx${i}`, count: i })), "geloof", 5).length, 5);
});

test("markeren: alleen het hele woord, ongeacht hoofdletter of accent, en de tekst blijft compleet", () => {
  const text = "Geloof is niet ongeloof, maar geloof.";
  const parts = highlightWord(text, "geloof");
  assert.equal(parts.map((p) => p.text).join(""), text);
  assert.deepEqual(parts.filter((p) => p.match).map((p) => p.text), ["Geloof", "geloof"]);
  assert.deepEqual(highlightWord("zonder treffer", "xyz"), [{ text: "zonder treffer", match: false }]);
});

test("groeperen per boek behoudt de volgorde", () => {
  const groups = groupByBook([{ bookName: "1 Nephi", n: 1 }, { bookName: "1 Nephi", n: 2 }, { bookName: "Alma", n: 3 }]);
  assert.deepEqual(groups.map((g) => [g.bookName, g.items.length]), [["1 Nephi", 2], ["Alma", 1]]);
});

test("onlangs bekeken: nieuwste eerst, geen dubbelen, begrensd en bestand tegen rommel", () => {
  let recent: string[] = [];
  for (const word of ["a", "b", "c", "a", "d", "e", "f", "g", "h", "i"]) recent = pushRecent(recent, word);
  assert.deepEqual(recent, ["i", "h", "g", "f", "e", "d", "a", "c"]);
  assert.deepEqual(parseRecent("kapot"), []);
  assert.deepEqual(parseRecent(JSON.stringify(["x", 3, "y"])), ["x", "y"]);
  assert.deepEqual(parseRecent(null), []);
});
