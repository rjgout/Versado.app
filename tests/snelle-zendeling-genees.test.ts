import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  REVIVE_START, comparePosition, cursorAfterAnswer, pickReviveQuestion,
  type ReviveChapterEntry, type ReviveCursor,
} from "@/lib/snelleZendeling/reviveSelection";
import {
  TARGET_VARIANTS, coverageOf, lengthHintProblem, normalizeText, parseVerseSpec, promptSimilarity, validateGeneesBank,
  type GeneesBankSeed,
} from "@/lib/snelleZendeling/reviveBank";
import { ReviveFailurePanel, ReviveQuestionPanel } from "@/components/snelleZendeling/RevivePanels";

/** Een kleine uitgave: twee boeken, één hoofdstuk zonder vragen, wisselend aantal varianten. */
function bank(): ReviveChapterEntry[] {
  return [
    { chapterId: "b0c0", bookOrder: 0, chapterOrder: 0, questionIds: [] }, // geen vraag: wordt overgeslagen
    { chapterId: "b0c1", bookOrder: 0, chapterOrder: 1, questionIds: ["b0c1a", "b0c1b", "b0c1c"] },
    { chapterId: "b0c2", bookOrder: 0, chapterOrder: 2, questionIds: ["b0c2a"] },
    { chapterId: "b1c0", bookOrder: 1, chapterOrder: 0, questionIds: ["b1c0a", "b1c0b"] },
  ];
}

/** Speelt Genees na zoals runs.ts het doet: kiezen, als gezien vastleggen, plek bijwerken. */
function player(chapters: ReviveChapterEntry[], random: () => number = () => 0) {
  let cursor: ReviveCursor = REVIVE_START;
  let seen = new Set<string>();
  let cycle = 1;
  let last: string | null = null;
  const issued: string[] = [];
  return {
    get cycle() { return cycle; },
    get cursor() { return cursor; },
    issued,
    seen: () => seen,
    next() {
      const pick = pickReviveQuestion({ chapters, seen, cursor, random, lastSeenQuestionId: last });
      if (!pick) return null;
      const chapter = chapters.find((entry) => entry.chapterId === pick.chapterId)!;
      if (pick.cycleReset) {
        cycle++;
        seen = new Set();
        cursor = { bookOrder: chapter.bookOrder, chapterOrder: chapter.chapterOrder };
      }
      seen.add(pick.questionId);
      last = pick.questionId;
      issued.push(pick.questionId);
      return { ...pick, chapter };
    },
    answer(correct: boolean, chapter: ReviveChapterEntry) {
      cursor = cursorAfterAnswer(chapter, correct);
    },
  };
}

describe("Genees: hoofdstukvolgorde en vragen", () => {
  it("begint bij het eerste hoofdstuk dat een vraag heeft", () => {
    const first = player(bank()).next()!;
    assert.equal(first.chapterId, "b0c1");
  });

  it("gaat na een goed antwoord naar het volgende hoofdstuk, ook over boekgrenzen", () => {
    const p = player(bank());
    const chapters: string[] = [];
    for (let i = 0; i < 3; i++) {
      const pick = p.next()!;
      chapters.push(pick.chapterId);
      p.answer(true, pick.chapter);
    }
    assert.deepEqual(chapters, ["b0c1", "b0c2", "b1c0"]);
  });

  it("volgt de echte volgorde, ook als de hoofdstukken door elkaar binnenkomen", () => {
    const shuffled = [...bank()].reverse();
    const p = player(shuffled);
    const order: string[] = [];
    for (let i = 0; i < 3; i++) { const pick = p.next()!; order.push(pick.chapterId); p.answer(true, pick.chapter); }
    assert.deepEqual(order, ["b0c1", "b0c2", "b1c0"]);
  });

  it("blijft na een fout antwoord bij hetzelfde hoofdstuk, met een andere vraag", () => {
    const p = player(bank());
    const first = p.next()!;
    p.answer(false, first.chapter);
    const second = p.next()!;
    assert.equal(second.chapterId, first.chapterId);
    assert.notEqual(second.questionId, first.questionId);
  });

  it("gaat door naar het volgende hoofdstuk als het huidige geen ongeziene vraag meer heeft", () => {
    const p = player(bank());
    const seenChapters: string[] = [];
    for (let i = 0; i < 4; i++) {
      const pick = p.next()!;
      seenChapters.push(pick.chapterId);
      p.answer(false, pick.chapter); // steeds fout: b0c1 levert drie vragen, dan volgt b0c2
    }
    assert.deepEqual(seenChapters, ["b0c1", "b0c1", "b0c1", "b0c2"]);
  });

  it("toont een gezien-vraag nooit opnieuw zolang er ergens een ongeziene bestaat", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      let state = seed * 7919;
      const random = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const chapters = bank();
      const total = chapters.reduce((sum, chapter) => sum + chapter.questionIds.length, 0);
      const p = player(chapters, random);
      for (let round = 0; round < 3 * total; round++) {
        const before = new Set(p.seen());
        const cycleBefore = p.cycle;
        const pick = p.next()!;
        if (p.cycle === cycleBefore) assert.equal(before.has(pick.questionId), false, "een gezien-vraag kwam terug terwijl er ongeziene waren");
        else assert.equal(before.size, total, "een reset mag alleen als alles gezien is");
        p.answer(random() < 0.5, pick.chapter);
      }
    }
  });

  it("gebruikt na het laatste hoofdstuk eerst de andere varianten, en zet pas dan het geheugen terug", () => {
    const p = player(bank());
    const total = 6;
    for (let i = 0; i < total; i++) { const pick = p.next()!; p.answer(true, pick.chapter); }
    assert.equal(p.cycle, 1, "nog geen reset: alle zes de vragen zijn net één keer gebruikt");
    assert.equal(new Set(p.issued).size, total, "elke vraag precies één keer");
    const again = p.next()!;
    assert.equal(p.cycle, 2, "alles gezien: gecontroleerde nieuwe cyclus");
    assert.equal(again.chapterId, "b0c1", "de nieuwe cyclus begint bij het eerste hoofdstuk");
    assert.equal(again.cycleReset, true);
  });

  it("slaat een volledig geziene uitgave over naar waar nog ongeziene vragen zijn (wrap zonder reset)", () => {
    const chapters = bank();
    const p = player(chapters);
    // zie alle vragen van b0c1 en b0c2, ga naar het einde
    for (let i = 0; i < 4; i++) { const pick = p.next()!; p.answer(true, pick.chapter); }
    const afterEnd = pickReviveQuestion({ chapters, seen: p.seen(), cursor: { bookOrder: 9, chapterOrder: 0 } })!;
    assert.equal(afterEnd.cycleReset, false);
    assert.ok(p.seen().has(afterEnd.questionId) === false, "wrap pakt een nog ongeziene variant");
  });

  it("vermijdt na een reset de laatst geziene vraag als er een alternatief is", () => {
    const chapters: ReviveChapterEntry[] = [{ chapterId: "x", bookOrder: 0, chapterOrder: 0, questionIds: ["a", "b"] }];
    const pick = pickReviveQuestion({ chapters, seen: new Set(["a", "b"]), cursor: REVIVE_START, lastSeenQuestionId: "b", random: () => 0.99 })!;
    assert.equal(pick.cycleReset, true);
    assert.equal(pick.questionId, "a");
  });

  it("loopt nooit vast: met één vraag in de hele uitgave begint na het zien een nieuwe cyclus", () => {
    const chapters: ReviveChapterEntry[] = [{ chapterId: "x", bookOrder: 0, chapterOrder: 0, questionIds: ["only"] }];
    const p = player(chapters);
    assert.equal(p.next()!.questionId, "only");
    const again = p.next()!;
    assert.equal(again.questionId, "only");
    assert.equal(again.cycleReset, true);
    assert.equal(p.cycle, 2);
  });

  it("geeft niets terug zonder vragen", () => {
    assert.equal(pickReviveQuestion({ chapters: [], seen: new Set(), cursor: REVIVE_START }), null);
    assert.equal(pickReviveQuestion({ chapters: [{ chapterId: "x", bookOrder: 0, chapterOrder: 0, questionIds: [] }], seen: new Set(), cursor: REVIVE_START }), null);
  });

  it("zet de plek na een antwoord goed: goed = erna, fout = zelfde hoofdstuk", () => {
    assert.deepEqual(cursorAfterAnswer({ bookOrder: 2, chapterOrder: 4 }, true), { bookOrder: 2, chapterOrder: 5 });
    assert.deepEqual(cursorAfterAnswer({ bookOrder: 2, chapterOrder: 4 }, false), { bookOrder: 2, chapterOrder: 4 });
    assert.ok(comparePosition({ bookOrder: 1, chapterOrder: 99 }, { bookOrder: 2, chapterOrder: 0 }) < 0);
  });
});

describe("Genees: schermen", () => {
  const question = { exerciseId: "q1", context: { kind: "chapter" as const, label: "1 Nephi 4" }, prompt: "Wie zegt dat de Heer de geboden voorbereidt?", options: [{ id: "o1", label: "Nephi" }, { id: "o2", label: "Laman" }, { id: "o3", label: "Lemuël" }] };

  it("toont het hoofdstuk groot en duidelijk vóór de vraag", () => {
    const html = renderToStaticMarkup(createElement(ReviveQuestionPanel, { question, onAnswer: () => {} }));
    const chapterAt = html.indexOf("data-revive-chapter");
    assert.ok(chapterAt >= 0, "hoofdstukkop ontbreekt");
    assert.match(html.slice(chapterAt), /^data-revive-chapter[^>]*>1 Nephi 4</);
    assert.ok(chapterAt < html.indexOf("data-revive-prompt"), "hoofdstuk moet vóór de vraag staan");
    assert.match(html, /Genees/);
    assert.match(html, /Beantwoord deze vraag over 1 Nephi 4 goed om verder te gaan\./);
  });

  it("verzint geen hoofdstuk als de metadata ontbreekt", () => {
    const html = renderToStaticMarkup(createElement(ReviveQuestionPanel, { question: { ...question, context: null }, onAnswer: () => {} }));
    assert.doesNotMatch(html, /data-revive-chapter/);
    assert.match(html, /Beantwoord één vraag goed om verder te gaan\./);
  });

  it("toont de antwoorden zonder enige aanwijzing welk antwoord goed is", () => {
    const html = renderToStaticMarkup(createElement(ReviveQuestionPanel, { question, onAnswer: () => {} }));
    assert.doesNotMatch(html, /isCorrect|data-correct|aria-checked/);
    assert.equal((html.match(/<button/g) ?? []).length, 3);
  });

  it("verwijst na een fout antwoord naar het hoofdstuk, met een knop naar de leesroute", () => {
    const html = renderToStaticMarkup(createElement(ReviveFailurePanel, { reading: { chapterId: "ch-123", label: "1 Nephi 4" } }));
    assert.match(html, /Niet helemaal\./);
    assert.match(html, /Lees 1 Nephi 4 om het antwoord te ontdekken\./);
    assert.match(html, /href="\/lesson\/ch-123"/);
    assert.match(html, />Lees 1 Nephi 4</);
  });

  it("verraadt na een fout antwoord het juiste antwoord niet", () => {
    const html = renderToStaticMarkup(createElement(ReviveFailurePanel, { reading: { chapterId: "ch-123", label: "1 Nephi 4" } }));
    assert.doesNotMatch(html, /het juiste antwoord (was|is)|antwoord [A-C] was|correct was/i);
    // geen antwoordopties en geen groen "goed"-merk in het foutscherm
    assert.doesNotMatch(html, /<button|emerald|green/);
  });
});

describe("Genees: vragenbank-controle", () => {
  const verses = ["Ik, Nephi, ben geboren uit goede ouders.", "Mijn vader Lehi leefde te Jeruzalem."];
  const provider = (book: string, chapter: number) => (book === "1-ne" && chapter === 1 ? verses : null);
  const sample = (override: object = {}): GeneesBankSeed => ({
    id: "test", work: "bofm", collectionId: "x",
    chapters: [{ book: "1-ne", chapter: 1, questions: [{ id: "a", verses: "1-2", prompt: "In welke stad leefde Lehi, de vader van Nephi?", correct: "In de stad Jeruzalem", wrong: ["In de stad Betlehem", "In de stad Bountiful"], check: ["Jeruzalem"], ...override }] }],
  });

  it("accepteert een goede vraag", () => {
    assert.deepEqual(validateGeneesBank(sample(), provider), []);
  });

  it("bindt elk feit aan de brontekst", () => {
    const problems = validateGeneesBank(sample({ check: ["Zarahemla"] }), provider);
    assert.ok(problems.some((problem) => /staat niet in vers/.test(problem.message)));
    assert.ok(validateGeneesBank(sample({ verses: "9" }), provider).some((problem) => /buiten het hoofdstuk/.test(problem.message)));
    assert.ok(validateGeneesBank(sample({ check: [] }), provider).some((problem) => /geen controlewoorden/.test(problem.message)));
  });

  it("weigert een antwoordlengte die het goede antwoord verraadt", () => {
    assert.match(lengthHintProblem("Een heel uitgebreid en gedetailleerd antwoord met veel woorden erin", ["Kort", "Ook kort"]) ?? "", /uiteen|langste/);
    assert.equal(lengthHintProblem("In de stad Jeruzalem", ["In de stad Betlehem", "In de stad Bountiful"]), null);
    assert.ok(validateGeneesBank(sample({ correct: "In de grote en machtige stad Jeruzalem in het land van het verbond" }), provider).length > 0);
  });

  it("eist drie verschillende antwoorden en weigert 'alle bovenstaande'", () => {
    assert.ok(validateGeneesBank(sample({ wrong: ["In de stad Jeruzalem", "In de stad Bountiful"] }), provider).some((problem) => /gelijk/.test(problem.message)));
    assert.ok(validateGeneesBank(sample({ wrong: ["In de stad Betlehem", "Alle bovenstaande"] }), provider).some((problem) => /verboden/.test(problem.message)));
    assert.ok(validateGeneesBank(sample({ prompt: "Waar leefde hij" }), provider).some((problem) => /vraagteken/.test(problem.message)));
  });

  it("weigert varianten die dezelfde vraag zijn", () => {
    const base = sample();
    base.chapters[0].questions.push({ id: "b", verses: "1-2", prompt: "In welke stad leefde Lehi, de vader van Nephi precies?", correct: "In de stad Jeruzalem", wrong: ["In de stad Gideon", "In de stad Melek"], check: ["Jeruzalem"] });
    const problems = validateGeneesBank(base, provider);
    assert.ok(problems.some((problem) => /lijken te veel op elkaar/.test(problem.message)));
    assert.ok(promptSimilarity("Wat deed Nephi in de woestijn?", "Hoeveel zonen had Lehi?") < 0.3);
  });

  it("kent verzenaanduidingen en meet de dekking", () => {
    assert.deepEqual(parseVerseSpec("1-3,7"), [1, 2, 3, 7]);
    assert.equal(parseVerseSpec("3-1"), null);
    assert.equal(parseVerseSpec("abc"), null);
    assert.equal(normalizeText("Lemuël, Zárahemla!"), "lemuel zarahemla");
    const coverage = coverageOf(sample(), [{ book: "1-ne", chapter: 1 }, { book: "1-ne", chapter: 2 }]);
    assert.deepEqual({ total: coverage.total, covered: coverage.covered, atTarget: coverage.atTarget }, { total: 2, covered: 1, atTarget: 0 });
    assert.equal(coverage.below.length, 2);
    assert.equal(TARGET_VARIANTS, 3);
  });
});
