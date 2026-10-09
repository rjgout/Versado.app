// Integratietests voor de leervoortgang tegen een echte Postgres-database
// met content (bv. een kopie van een geseede database). Draait alleen met
// LEARNING_TEST_DATABASE_URL; maakt een eigen testgebruiker aan en ruimt
// die (en een tijdelijk testboek) daarna weer op.
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npm run test:learning
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

// Pas na het zetten van DATABASE_URL laden: de Prisma-client leest die bij het importeren.
const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  service: await import("../src/lib/learning/contentProgress"),
  steps: await import("../src/lib/readingLessons"),
  rewards: await import("../src/lib/learning/rewards"),
});
type Loaded = Awaited<ReturnType<typeof load>>;
let L: Loaded;
let userId = "";
const extraIds: { collection?: string } = {};

async function chapterId(bookKey: string, number: number, collection = "content_bom"): Promise<string> {
  const chapter = await L.db.chapter.findFirstOrThrow({ where: { number, book: { key: bookKey, contentCollectionId: collection } }, select: { id: true } });
  return chapter.id;
}

async function correctAnswers(ids: string[], wrong = new Set<string>()) {
  const rows = await L.db.exercise.findMany({ where: { id: { in: ids } }, select: { id: true, answers: true } });
  return rows.map((row) => ({ exerciseId: row.id, given: wrong.has(row.id) ? ["zzz-fout"] : (JSON.parse(row.answers) as string[]) }));
}

async function user() {
  return L.db.user.findUniqueOrThrow({ where: { id: userId }, select: { xpTotal: true, currentStreak: true, lastStudyDate: true } });
}

async function doFullSet(chapter: string, wrong = 0) {
  const issued = await L.service.issueExerciseSession(userId, chapter);
  assert.ok(issued.sessionId);
  const wrongIds = new Set(issued.exercises.slice(0, wrong).map((e) => e.id));
  return L.service.submitExerciseSession(userId, issued.sessionId!, await correctAnswers(issued.exercises.map((e) => e.id), wrongIds));
}

async function stepsOf(chapter: string) {
  return L.db.courseLesson.findMany({ where: { chapterId: chapter, course: { type: "READING_LESSONS" } }, orderBy: { order: "asc" } });
}

/** Rondt een stap af; null voor een stap zonder vragen (alleen lezen). */
async function doStep(lesson: { id: string; chapterId: string; startVerse: number; endVerse: number }) {
  const issued = await L.service.issueExerciseSession(userId, lesson.chapterId, { lessonId: lesson.id, startVerse: lesson.startVerse, endVerse: lesson.endVerse });
  if (!issued.sessionId) {
    await L.steps.completeReadingOnlyStep(userId, lesson.id);
    return null;
  }
  return L.steps.completeReadingLesson(userId, lesson.id, issued.sessionId, await correctAnswers(issued.exercises.map((e) => e.id)));
}

before(async () => {
  if (skip) return;
  L = await load();
  const stamp = Date.now();
  const created = await L.db.user.create({
    data: { email: `leervoortgang-${stamp}@test.invalid`, handle: `Leertest${stamp % 100000}`, discriminator: "00", passwordHash: "x" },
  });
  userId = created.id;
});

after(async () => {
  if (skip) return;
  if (userId) await L.db.user.delete({ where: { id: userId } }).catch(() => {});
  if (extraIds.collection) await L.db.contentCollection.delete({ where: { id: extraIds.collection } }).catch(() => {});
  await L.db.$disconnect();
});

test("lezen via Vrije keuze: gelezen in elke route en taal, zonder XP en zonder reeks", { skip }, async () => {
  const nl = await chapterId("bofm/1-ne", 3);
  const en = await chapterId("bofm/1-ne", 3, "content_bom_en");
  const before = await user();
  const state = await L.service.markChapterRead(userId, nl);
  assert.equal(state.read, "READ");
  assert.equal((await L.service.getChapterState(L.db, userId, en)).read, "READ", "zelfde inhoud in het Engels");
  const afterRead = await user();
  assert.equal(afterRead.xpTotal, before.xpTotal, "lezen geeft geen XP");
  assert.equal(afterRead.currentStreak, before.currentStreak, "lezen verlengt de reeks niet");
  assert.equal(afterRead.lastStudyDate, before.lastStudyDate);
  // In Stap voor stap: een gelezen maar niet geoefend hoofdstuk is niet "af".
  assert.equal(state.done, false);
});

test("lezen via Stap voor stap: gelezen in Vrije keuze zodra alle stappen gedaan zijn", { skip }, async () => {
  const chapter = await chapterId("bofm/1-ne", 4);
  await L.service.markReadingStarted(userId, chapter); // het hoofdstuk is begonnen, dus open in Stap voor stap
  const lessons = await stepsOf(chapter);
  assert.ok(lessons.length >= 2);
  await doStep(lessons[0]);
  const partial = await L.service.getChapterState(L.db, userId, chapter);
  assert.equal(partial.read, "READING");
  assert.equal(partial.readVerse, lessons[0].endVerse);
  for (const lesson of lessons.slice(1)) await doStep(lesson);
  const full = await L.service.getChapterState(L.db, userId, chapter);
  assert.equal(full.read, "READ");
  assert.equal(full.exercisesComplete, true);
  assert.equal(full.done, true);
});

test("oefeningen: correcte XP, reeks telt, en een andere route geeft geen dubbele basis-XP", { skip }, async () => {
  const chapter = await chapterId("bofm/alma", 5);
  const plan = await L.service.getExercisePlan(L.db, chapter);
  const start = await user();
  const first = await doFullSet(chapter);
  assert.equal(first.total, plan.total, "volledige set = N vragen");
  assert.equal(first.baseXp + first.bonusXp, L.rewards.maxContentBaseXp(plan.total));
  assert.equal(first.xpEarned, L.rewards.maxContentBaseXp(plan.total));
  const afterFirst = await user();
  assert.equal(afterFirst.xpTotal - start.xpTotal, first.xpEarned);
  assert.ok(afterFirst.currentStreak >= 1, "oefenen telt voor de reeks");

  // Dezelfde inhoud via Stap voor stap: wel oefenen, geen nieuwe basis-XP.
  await L.service.markReadingStarted(userId, chapter);
  for (const lesson of await stepsOf(chapter)) {
    const result = await doStep(lesson);
    if (result) assert.equal(result.baseXp + result.bonusXp, 0);
  }
  // En in een andere taal ook niet.
  const en = await chapterId("bofm/alma", 5, "content_bom_en");
  const english = await doFullSet(en);
  assert.equal(english.baseXp + english.bonusXp, 0);
  assert.ok(english.repeatXp > 0, "herhalen blijft mogelijk, met de korting");
});

test("routes zijn gelijkwaardig: Stap voor stap levert dezelfde maximale basis-XP", { skip }, async () => {
  const chapter = await chapterId("bofm/alma", 32);
  const plan = await L.service.getExercisePlan(L.db, chapter);
  await L.service.markReadingStarted(userId, chapter);
  let total = 0;
  for (const lesson of await stepsOf(chapter)) {
    const result = await doStep(lesson);
    if (result) {
      total += result.baseXp + result.bonusXp;
      const part = plan.parts.find((p) => p.startVerse === lesson.startVerse)!;
      assert.equal(result.total, part.count, "per stap de vragen van dat deel");
    }
  }
  assert.equal(total, L.rewards.maxContentBaseXp(plan.total));
});

test("gedeeltelijke voortgang blijft behouden en vult later aan", { skip }, async () => {
  const chapter = await chapterId("bofm/alma", 6);
  const plan = await L.service.getExercisePlan(L.db, chapter);
  const partial = await doFullSet(chapter, 3);
  assert.equal(partial.baseXp, (plan.total - 3) * 10);
  assert.equal(partial.bonusXp, 0);
  assert.equal(partial.content.exercisesAnswered, plan.total);
  const rest = await doFullSet(chapter);
  assert.ok(rest.baseXp <= 30);
  assert.equal(partial.baseXp + rest.baseXp + rest.bonusXp <= L.rewards.maxContentBaseXp(plan.total), true);
});

test("dubbelklik en gelijktijdige inzendingen: één keer XP", { skip }, async () => {
  const chapter = await chapterId("bofm/alma", 7);
  const plan = await L.service.getExercisePlan(L.db, chapter);
  const issued = await L.service.issueExerciseSession(userId, chapter);
  const answers = await correctAnswers(issued.exercises.map((e) => e.id));
  const results = await Promise.allSettled([
    L.service.submitExerciseSession(userId, issued.sessionId!, answers),
    L.service.submitExerciseSession(userId, issued.sessionId!, answers),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "ALREADY_SUBMITTED");

  // Twee verschillende sets over dezelfde inhoud tegelijk: samen nooit boven het maximum.
  const other = await chapterId("bofm/alma", 8);
  const otherPlan = await L.service.getExercisePlan(L.db, other);
  const [a, b] = await Promise.all([L.service.issueExerciseSession(userId, other), L.service.issueExerciseSession(userId, other)]);
  const both = await Promise.all([
    L.service.submitExerciseSession(userId, a.sessionId!, await correctAnswers(a.exercises.map((e) => e.id))),
    L.service.submitExerciseSession(userId, b.sessionId!, await correctAnswers(b.exercises.map((e) => e.id))),
  ]);
  const base = both.reduce((sum, r) => sum + r.baseXp + r.bonusXp, 0);
  assert.equal(base, L.rewards.maxContentBaseXp(otherPlan.total));
  assert.ok(plan.total > 0);
});

test("onvolledig of leeg inleveren telt niet en verbruikt de set niet", { skip }, async () => {
  const chapter = await chapterId("bofm/alma", 9);
  const issued = await L.service.issueExerciseSession(userId, chapter);
  const before = await user();
  await assert.rejects(L.service.submitExerciseSession(userId, issued.sessionId!, []), (e: { code?: string }) => e.code === "INCOMPLETE");
  const partial = (await correctAnswers(issued.exercises.map((e) => e.id))).slice(1);
  await assert.rejects(L.service.submitExerciseSession(userId, issued.sessionId!, partial), (e: { code?: string }) => e.code === "INCOMPLETE");
  // Een vraag die niet is uitgedeeld telt niet mee.
  const foreign = await L.db.exercise.findFirstOrThrow({ where: { chapterId: { not: chapter } }, select: { id: true } });
  await assert.rejects(
    L.service.submitExerciseSession(userId, issued.sessionId!, [...partial, { exerciseId: foreign.id, given: ["x"] }]),
    (e: { code?: string }) => e.code === "INCOMPLETE"
  );
  assert.deepEqual(await user(), before);
  // Daarna gewoon in te leveren.
  const ok = await L.service.submitExerciseSession(userId, issued.sessionId!, await correctAnswers(issued.exercises.map((e) => e.id)));
  assert.equal(ok.total, issued.exercises.length);
});

test("random vragen: altijd het juiste aantal", { skip }, async () => {
  const chapter = await chapterId("bofm/alma", 32);
  const plan = await L.service.getExercisePlan(L.db, chapter);
  const seen = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const issued = await L.service.issueExerciseSession(userId, chapter);
    assert.equal(issued.exercises.length, plan.total);
    issued.exercises.forEach((e) => seen.add(e.id));
  }
  assert.ok(seen.size > plan.total, "de selectie verschilt per keer");
});

test("oude voortgang (migratie) blijft geldig: geen dubbele XP, het verschil is nog te verdienen", { skip }, async () => {
  const chapter = await chapterId("bofm/alma", 10);
  const plan = await L.service.getExercisePlan(L.db, chapter);
  const key = (await L.service.getChapterState(L.db, userId, chapter)).contentKey;
  await L.db.contentProgress.create({ data: { userId, contentKey: key, lastChapterId: chapter, readStatus: "READ", legacyXp: 50, legacyCompleted: true, legacyScore: 71, exercisesCompletedAt: new Date() } });
  const state = await L.service.getChapterState(L.db, userId, chapter);
  assert.equal(state.done, true, "afgerond blijft afgerond");
  assert.equal(state.exerciseScore, 71);
  const result = await doFullSet(chapter);
  assert.equal(50 + result.baseXp + result.bonusXp, L.rewards.maxContentBaseXp(plan.total));
});

test("leesvoortgang resetten: alles op nul, maar dezelfde basis-XP komt niet terug", { skip }, async () => {
  const chapter = await chapterId("bofm/alma", 5);
  await L.db.$transaction((tx) => L.service.resetReadingProgress(tx, userId));
  const state = await L.service.getChapterState(L.db, userId, chapter);
  assert.equal(state.read, "UNREAD");
  assert.equal(state.exercisesAnswered, 0);
  const again = await doFullSet(chapter);
  assert.equal(again.baseXp + again.bonusXp, 0);
  assert.equal(again.content.exercisesAnswered, again.content.exercisesTotal, "oefenvoortgang telt weer op");
});

test("een nieuw boek zonder kerksleutel valt vanzelf onder hetzelfde systeem", { skip }, async () => {
  const id = `test_collectie_${Date.now()}`;
  extraIds.collection = id;
  await L.db.contentCollection.create({ data: { id, slug: id, name: "Testboek", icon: "x", visibleToUsers: false, work: "test-werk" } });
  const book = await L.db.book.create({ data: { slug: id, name: "Testboek", order: 999, contentCollectionId: id } });
  const chapter = await L.db.chapter.create({ data: { bookId: book.id, number: 1, order: 1 } });
  for (let v = 1; v <= 25; v++) {
    const verse = await L.db.verse.create({ data: { chapterId: chapter.id, number: v, text: `Vers ${v} van het testboek met wat woorden.` } });
    await L.db.exercise.create({
      data: { chapterId: chapter.id, order: v, type: "TRUE_FALSE", verseRef: `Testboek 1:${v}`, sourceVerseId: verse.id, prompt: `Stelling ${v}`, answers: JSON.stringify(["true"]) },
    });
  }
  const plan = await L.service.getExercisePlan(L.db, chapter.id);
  assert.deepEqual(plan.parts.map((p) => p.count), [3, 3, 3]);
  const result = await doFullSet(chapter.id);
  assert.equal(result.content.contentKey, `chapter:${chapter.id}`);
  assert.equal(result.xpEarned, L.rewards.maxContentBaseXp(9));
});

async function freshUser(tag: string) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const created = await L.db.user.create({
    data: { email: `lezen-${tag}-${stamp}@test.invalid`, handle: `Lees${stamp.slice(-8)}`, discriminator: "00", passwordHash: "x" },
  });
  return created.id;
}

test("uitdrukkelijk als gelezen markeren telt één keer als reeksactiviteit, zonder XP", { skip }, async () => {
  const id = await freshUser("hoofdstuk");
  try {
    const chapter = await chapterId("bofm/1-ne", 6);
    // Openen, beginnen en doorlezen zonder af te ronden verdient niets.
    await L.service.markReadingStarted(id, chapter);
    assert.equal((await L.db.user.findUniqueOrThrow({ where: { id } })).currentStreak, 0);
    const first = await L.service.completeChapterReading(id, chapter);
    assert.equal(first.counted, true);
    assert.equal(first.content.read, "READ");
    const afterFirst = await L.db.user.findUniqueOrThrow({ where: { id } });
    assert.equal(afterFirst.currentStreak, 1);
    assert.equal(afterFirst.xpTotal, 0, "lezen geeft geen XP");
    // Nogmaals markeren (of via een andere taal) telt niet opnieuw.
    const again = await L.service.completeChapterReading(id, chapter);
    assert.equal(again.counted, false);
    const en = await chapterId("bofm/1-ne", 6, "content_bom_en");
    assert.equal((await L.service.completeChapterReading(id, en)).counted, false);
    assert.equal((await L.db.user.findUniqueOrThrow({ where: { id } })).currentStreak, 1);
    // Een tweede hoofdstuk dezelfde dag is een activiteit, maar geen extra reeksdag.
    const second = await L.service.completeChapterReading(id, await chapterId("bofm/1-ne", 7));
    assert.equal(second.counted, true);
    assert.equal((await L.db.user.findUniqueOrThrow({ where: { id } })).currentStreak, 1);
  } finally {
    await L.db.user.delete({ where: { id } }).catch(() => {});
  }
});

test("samen lezen (markChapterRead/markStepRead) blijft zonder reeks", { skip }, async () => {
  const id = await freshUser("samen");
  try {
    const chapter = await chapterId("bofm/1-ne", 8);
    await L.service.markChapterRead(id, chapter);
    assert.equal((await L.db.user.findUniqueOrThrow({ where: { id } })).currentStreak, 0);
  } finally {
    await L.db.user.delete({ where: { id } }).catch(() => {});
  }
});

test("een leesstap zonder vragen telt na afronden eenmalig als reeksactiviteit", { skip }, async (t) => {
  const lessons = await L.db.courseLesson.findMany({ where: { course: { type: "READING_LESSONS", contentCollectionId: "content_bom" } }, orderBy: [{ chapterId: "asc" }, { order: "asc" }], take: 400 });
  const id = await freshUser("stap");
  try {
    for (const lesson of lessons) {
      const issued = await L.service.issueExerciseSession(id, lesson.chapterId, { lessonId: lesson.id, startVerse: lesson.startVerse, endVerse: lesson.endVerse });
      if (issued.sessionId) continue;
      await L.service.markReadingStarted(id, lesson.chapterId);
      const before = await L.db.user.findUniqueOrThrow({ where: { id } });
      assert.equal(before.currentStreak, 0);
      const step = await L.db.courseLesson.findFirstOrThrow({ where: { chapterId: lesson.chapterId, course: { type: "READING_LESSONS" } }, orderBy: { order: "asc" } });
      if (step.id !== lesson.id) continue; // alleen de eerste stap van een hoofdstuk is direct beschikbaar
      await L.steps.completeReadingOnlyStep(id, lesson.id);
      const after = await L.db.user.findUniqueOrThrow({ where: { id } });
      assert.equal(after.currentStreak, 1);
      assert.equal(after.xpTotal, 0);
      await L.steps.completeReadingOnlyStep(id, lesson.id);
      assert.equal((await L.db.user.findUniqueOrThrow({ where: { id } })).currentStreak, 1, "tweede keer telt niet opnieuw");
      return;
    }
    t.skip("geen beschikbare leesstap zonder vragen in de testdatabase");
  } finally {
    await L.db.user.delete({ where: { id } }).catch(() => {});
  }
});
