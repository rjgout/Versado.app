// Integratietests voor de Genees-vragen van Vliegende Versado (runs.ts +
// reviveSelection.ts) tegen een echte database. Draait alleen met
// LEARNING_TEST_DATABASE_URL.
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npm run test:snelle-zendeling
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "testsleutel-voor-geneestests-0123456789";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  runs: await import("../src/lib/snelleZendeling/runs"),
});
let L: Awaited<ReturnType<typeof load>>;

const run = `${Date.now()}`;
const emails: string[] = [];
let seq = 0;

/** Chapters van de testuitgave, in echte volgorde, met het aantal varianten. */
const LAYOUT = [
  { book: "Eerste", chapters: [3, 1, 0] },
  { book: "Tweede", chapters: [2, 1] },
] as const;

const chapterIds: string[] = []; // in leesvolgorde
const chapterLabel = new Map<string, string>();
const questionsByChapter = new Map<string, string[]>();
let collectionId = "";
let otherCollectionId = "";

async function makeUser(activeCollection = collectionId): Promise<string> {
  const email = `genees-${run}-${++seq}@test.invalid`;
  emails.push(email);
  const user = await L.db.user.create({
    data: { email, passwordHash: "x", handle: "Genees", discriminator: String(10 + seq).slice(-2), activeContentCollectionId: activeCollection },
  });
  return user.id;
}

async function addQuestion(chapterId: string, key: string, variant: number) {
  const question = await L.db.quickMissionaryReviveQuestion.create({
    data: {
      contentKey: `test-${run}:${key}`,
      chapterId,
      variant,
      prompt: `Vraag ${key} voor de test van Genees?`,
      options: {
        create: [
          { label: "Het goede antwoord", isCorrect: true, order: 0 },
          { label: "Een foute keuze A", order: 1 },
          { label: "Een foute keuze B", order: 2 },
        ],
      },
    },
  });
  return question.id;
}

before(async () => {
  if (skip) return;
  L = await load();
  collectionId = `geneestest-${run}`;
  otherCollectionId = `geneestest-leeg-${run}`;
  for (const id of [collectionId, otherCollectionId]) {
    await L.db.contentCollection.create({ data: { id, slug: id, name: id, icon: "book", work: id, language: "nl", order: 900 } });
  }
  let bookOrder = 0;
  for (const layout of LAYOUT) {
    const book = await L.db.book.create({ data: { slug: `${collectionId}-b${bookOrder}`, name: layout.book, order: bookOrder, contentCollectionId: collectionId } });
    let chapterOrder = 0;
    for (const variants of layout.chapters) {
      const chapter = await L.db.chapter.create({ data: { bookId: book.id, number: chapterOrder + 1, order: chapterOrder } });
      chapterIds.push(chapter.id);
      chapterLabel.set(chapter.id, `${layout.book} ${chapterOrder + 1}`);
      const ids: string[] = [];
      for (let v = 1; v <= variants; v++) ids.push(await addQuestion(chapter.id, `${bookOrder}-${chapterOrder}-${v}`, v));
      questionsByChapter.set(chapter.id, ids);
      chapterOrder++;
    }
    bookOrder++;
  }
});

after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { email: { in: emails } } });
  await L.db.contentCollection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
  await L.db.$disconnect();
});

/** Een run waarin de speler sterft, met de Genees-vraag al aangevraagd. */
async function death(userId: string) {
  const { runId } = await L.runs.startQuickMissionaryRun(userId);
  await L.runs.reportDeath(runId, userId, 0);
  const view = await L.runs.requestReviveQuestion(runId, userId);
  return { runId, view };
}

async function answer(userId: string, runId: string, view: Awaited<ReturnType<typeof death>>["view"], correct: boolean) {
  assert.ok(view.reviveQuestion, "er hoort een vraag te zijn");
  const question = await L.db.quickMissionaryReviveQuestion.findUniqueOrThrow({ where: { id: view.reviveQuestion.exerciseId }, select: { options: true } });
  const wanted = question.options.find((option) => option.isCorrect === correct && view.reviveQuestion!.options.some((shown) => shown.id === option.id))!;
  return L.runs.answerReviveQuestion(runId, userId, view.reviveQuestion.exerciseId, wanted.id);
}

async function chapterOf(questionId: string): Promise<string> {
  return (await L.db.quickMissionaryReviveQuestion.findUniqueOrThrow({ where: { id: questionId }, select: { chapterId: true } })).chapterId;
}

test("de eerste Genees gaat over het eerste hoofdstuk met vragen, met hoofdstuk erbij", { skip }, async () => {
  const userId = await makeUser();
  const { view } = await death(userId);
  assert.ok(view.reviveAvailable);
  const question = view.reviveQuestion!;
  assert.equal(await chapterOf(question.exerciseId), chapterIds[0]);
  assert.deepEqual(question.context, { kind: "chapter", label: "Eerste 1" });
  assert.equal(question.options.length, 3);
});

test("de vraag is meteen als gezien geregistreerd en krijgt de uitkomst na het antwoord", { skip }, async () => {
  const userId = await makeUser();
  const { runId, view } = await death(userId);
  const rows = await L.db.quickMissionaryReviveSeen.findMany({ where: { userId } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "SHOWN");
  assert.equal(rows[0].questionId, view.reviveQuestion!.exerciseId);
  await answer(userId, runId, view, true);
  assert.equal((await L.db.quickMissionaryReviveSeen.findMany({ where: { userId } }))[0].outcome, "CORRECT");

  const second = await death(userId);
  await answer(userId, second.runId, second.view, false);
  const wrong = await L.db.quickMissionaryReviveSeen.findFirstOrThrow({ where: { userId, runId: second.runId } });
  assert.equal(wrong.outcome, "WRONG");
  assert.ok(wrong.answeredAt);
});

test("na een goed antwoord gaat de volgende Genees naar het volgende hoofdstuk, ook in een nieuwe run", { skip }, async () => {
  const userId = await makeUser();
  const visited: string[] = [];
  // hoofdstuk 3 van het eerste boek heeft geen vragen en wordt overgeslagen
  for (let i = 0; i < 4; i++) {
    const { runId, view } = await death(userId);
    visited.push(await chapterOf(view.reviveQuestion!.exerciseId));
    await answer(userId, runId, view, true);
  }
  assert.deepEqual(visited, [chapterIds[0], chapterIds[1], chapterIds[3], chapterIds[4]]);
});

test("na een fout antwoord blijft het hoofdstuk, met een andere vraag, en gaat daarna door", { skip }, async () => {
  const userId = await makeUser();
  const asked: string[] = [];
  const chapters: string[] = [];
  for (let i = 0; i < 4; i++) {
    const { runId, view } = await death(userId);
    asked.push(view.reviveQuestion!.exerciseId);
    chapters.push(await chapterOf(view.reviveQuestion!.exerciseId));
    await answer(userId, runId, view, false);
  }
  // hoofdstuk 1 heeft drie varianten: drie keer daar (nooit dezelfde), dan door
  assert.deepEqual(chapters, [chapterIds[0], chapterIds[0], chapterIds[0], chapterIds[1]]);
  assert.equal(new Set(asked).size, asked.length, "geen enkele vraag twee keer");
});

test("een vraag die ongezien was maar verlaten werd, komt niet terug", { skip }, async () => {
  const userId = await makeUser();
  const first = await death(userId);
  const abandoned = first.view.reviveQuestion!.exerciseId;
  await L.runs.finishQuickMissionaryRun(first.runId, userId, 0); // de speler gaf op zonder te antwoorden
  const seen = new Set<string>([abandoned]);
  for (let i = 0; i < 2; i++) {
    const { runId, view } = await death(userId);
    const id = view.reviveQuestion!.exerciseId;
    assert.equal(seen.has(id), false, "verlaten vraag kwam terug");
    seen.add(id);
    await L.runs.finishQuickMissionaryRun(runId, userId, 0);
  }
});

test("verversen geeft in dezelfde run dezelfde vraag en registreert niet nog een keer", { skip }, async () => {
  const userId = await makeUser();
  const { runId, view } = await death(userId);
  const again = await L.runs.requestReviveQuestion(runId, userId);
  const reread = await L.runs.getQuickMissionaryRunView(runId, userId);
  assert.equal(again.reviveQuestion!.exerciseId, view.reviveQuestion!.exerciseId);
  assert.deepEqual(reread.reviveQuestion, view.reviveQuestion);
  assert.equal(await L.db.quickMissionaryReviveSeen.count({ where: { userId } }), 1);
});

test("na de gratis Genees biedt een tweede dood zonder voorraad alleen de noodkoop aan, nooit een gratis tweede", { skip }, async () => {
  const userId = await makeUser();
  const { runId, view } = await death(userId);
  const result = await answer(userId, runId, view, true);
  assert.equal(result.correct, true);
  assert.equal(result.view.status, "REVIVE_READY");
  await L.runs.resumeAfterRevive(runId, userId);
  await L.runs.reportDeath(runId, userId, 0);
  const second = await L.runs.getQuickMissionaryRunView(runId, userId);
  assert.equal(second.status, "DEAD_AWAITING_REVIVE");
  assert.equal(second.deathOption, "buy");
  assert.equal(second.reviveUsed, true);
  // Zonder voorraad kan er geen nieuwe vraag worden uitgegeven.
  await assert.rejects(() => L.runs.requestReviveQuestion(runId, userId), /NO_GENEES/);
  assert.equal(await L.db.quickMissionaryReviveSeen.count({ where: { userId } }), 1);
});

test("een fout antwoord beëindigt de run en wijst naar het hoofdstuk zonder het antwoord te verklappen", { skip }, async () => {
  const userId = await makeUser();
  const { runId, view } = await death(userId);
  const result = await answer(userId, runId, view, false);
  assert.equal(result.correct, false);
  assert.equal(result.view.status, "FINISHED");
  assert.equal(result.view.reviveQuestion, null);
  assert.deepEqual(result.view.reviveReading, { chapterId: chapterIds[0], label: "Eerste 1" });
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /Het goede antwoord/);
  assert.doesNotMatch(json, /isCorrect/);
  // ook later (verversen) blijft het goede antwoord onzichtbaar
  const reread = JSON.stringify(await L.runs.getQuickMissionaryRunView(runId, userId));
  assert.doesNotMatch(reread, /Het goede antwoord|isCorrect/);
});

test("het getoonde vraagobject bevat alleen id en label per optie, nooit isCorrect", { skip }, async () => {
  const userId = await makeUser();
  const { view } = await death(userId);
  for (const option of view.reviveQuestion!.options) assert.deepEqual(Object.keys(option).sort(), ["id", "label"]);
  assert.doesNotMatch(JSON.stringify(view), /isCorrect|correct/i);
});

test("voortgang volgt de speler tussen runs en is niet van andere spelers", { skip }, async () => {
  const userId = await makeUser();
  const other = await makeUser();
  const first = await death(userId);
  await answer(userId, first.runId, first.view, true);
  const progress = await L.db.quickMissionaryReviveProgress.findFirstOrThrow({ where: { userId } });
  assert.equal(progress.contentCollectionId, collectionId);
  assert.deepEqual([progress.cursorBookOrder, progress.cursorChapterOrder, progress.cycle], [0, 1, 1]);
  // een andere speler begint opnieuw bij het eerste hoofdstuk
  const theirs = await death(other);
  assert.equal(await chapterOf(theirs.view.reviveQuestion!.exerciseId), chapterIds[0]);
  assert.equal(await L.db.quickMissionaryReviveProgress.count({ where: { userId: other } }), 1);
  // en de eerste speler gaat verder in een nieuwe run (ander "apparaat": alleen de server weet het)
  const next = await death(userId);
  assert.equal(await chapterOf(next.view.reviveQuestion!.exerciseId), chapterIds[1]);
});

test("na het laatste hoofdstuk komen eerst ongeziene varianten, dan een gecontroleerde nieuwe cyclus", { skip }, async () => {
  const userId = await makeUser();
  const total = [...questionsByChapter.values()].reduce((sum, ids) => sum + ids.length, 0); // 7
  const asked: string[] = [];
  for (let i = 0; i < total; i++) {
    const { runId, view } = await death(userId);
    asked.push(view.reviveQuestion!.exerciseId);
    await answer(userId, runId, view, true);
  }
  assert.equal(new Set(asked).size, total, "binnen één cyclus is elke vraag precies één keer gesteld");
  assert.equal((await L.db.quickMissionaryReviveProgress.findFirstOrThrow({ where: { userId } })).cycle, 1);

  const { view } = await death(userId); // alles gezien: nieuwe cyclus, vanaf het eerste hoofdstuk
  const progress = await L.db.quickMissionaryReviveProgress.findFirstOrThrow({ where: { userId } });
  assert.equal(progress.cycle, 2);
  assert.equal(await chapterOf(view.reviveQuestion!.exerciseId), chapterIds[0]);
  assert.notEqual(view.reviveQuestion!.exerciseId, asked[asked.length - 1]);
  assert.equal(await L.db.quickMissionaryReviveSeen.count({ where: { userId, cycle: 2 } }), 1);
  assert.equal(await L.db.quickMissionaryReviveSeen.count({ where: { userId, cycle: 1 } }), total);
});

test("zonder vragen in de actieve uitgave wordt Genees niet aangeboden", { skip }, async () => {
  const userId = await makeUser(otherCollectionId);
  const { runId } = await L.runs.startQuickMissionaryRun(userId);
  await L.runs.reportDeath(runId, userId, 0);
  const view = await L.runs.getQuickMissionaryRunView(runId, userId);
  assert.equal(view.reviveAvailable, false);
  assert.equal(view.reviveQuestion, null);
});

test("een niet-goedgekeurde vraag wordt nooit gesteld: het hoofdstuk wordt overgeslagen", { skip }, async () => {
  const userId = await makeUser();
  const chapterId = chapterIds[0];
  await L.db.quickMissionaryReviveQuestion.updateMany({ where: { chapterId }, data: { status: "DRAFT" } });
  try {
    const { view } = await death(userId);
    assert.equal(await chapterOf(view.reviveQuestion!.exerciseId), chapterIds[1]);
  } finally {
    await L.db.quickMissionaryReviveQuestion.updateMany({ where: { chapterId }, data: { status: "APPROVED" } });
  }
});

test("een lopende run van vóór de vragenbank (overgenomen vraag) blijft beantwoordbaar", { skip }, async () => {
  const userId = await makeUser();
  const { runId } = await L.runs.startQuickMissionaryRun(userId);
  await L.runs.reportDeath(runId, userId, 0);
  const legacyId = questionsByChapter.get(chapterIds[1])![0];
  const options = await L.db.quickMissionaryReviveOption.findMany({ where: { questionId: legacyId } });
  await L.db.quickMissionaryRun.update({ where: { id: runId }, data: { reviveExerciseId: legacyId, reviveOptionIds: JSON.stringify(options.map((option) => option.id)) } });
  const view = await L.runs.getQuickMissionaryRunView(runId, userId);
  assert.equal(view.reviveQuestion?.exerciseId, legacyId);
  const correct = options.find((option) => option.isCorrect)!;
  const result = await L.runs.answerReviveQuestion(runId, userId, legacyId, correct.id);
  assert.equal(result.correct, true);
});

test("een antwoord op een andere vraag of een vreemde optie wordt geweigerd", { skip }, async () => {
  const userId = await makeUser();
  const { runId, view } = await death(userId);
  const foreign = await L.db.quickMissionaryReviveOption.findFirstOrThrow({ where: { questionId: { not: view.reviveQuestion!.exerciseId } } });
  await assert.rejects(() => L.runs.answerReviveQuestion(runId, userId, view.reviveQuestion!.exerciseId, foreign.id), /INVALID_OPTION/);
  await assert.rejects(() => L.runs.answerReviveQuestion(runId, userId, foreign.questionId, foreign.id), /INVALID_STATE/);
});

test("Genees op score 700 behoudt de score en dus de difficulty van die run", { skip }, async () => {
  const { minSecondsToReachScore } = await import("../src/lib/snelleZendeling/validation");
  const { getDifficulty } = await import("../src/lib/snelleZendeling/difficulty");
  const userId = await makeUser();
  const { runId } = await L.runs.startQuickMissionaryRun(userId);
  // Een echte run van 700 punten duurt minstens zo lang als de curve toestaat.
  await L.db.quickMissionaryRun.update({ where: { id: runId }, data: { startedAt: new Date(Date.now() - (minSecondsToReachScore(700) + 5) * 1000) } });
  await L.runs.reportDeath(runId, userId, 700);
  const view = await L.runs.requestReviveQuestion(runId, userId);
  assert.equal(view.score, 700);
  const result = await answer(userId, runId, view, true);
  assert.equal(result.correct, true);
  await L.runs.resumeAfterRevive(runId, userId);
  const resumed = await L.runs.getQuickMissionaryRunView(runId, userId);
  assert.equal(resumed.score, 700, "Genees zet de score niet terug");
  assert.equal(getDifficulty(resumed.score).gapMultiplier, 0.74);
  assert.equal(getDifficulty(resumed.score).speedMultiplier, 1.04);
});
