// Regressietests voor de synchronisatie van de lessen van Stap voor stap
// (applyLessonPlan in src/lib/courses.ts): herschikken zonder unieke-constraintfout
// (CourseLesson_courseId_order_key), stabiele lesid's en behoud van voortgang.
// Draait alleen met LEARNING_TEST_DATABASE_URL (een wegwerpdatabase).
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npx tsx --test tests/course-sync.integration.test.ts
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "testsleutel-voor-cursussynchronisatie-0123456789";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  courses: await import("../src/lib/courses"),
  phase: await import("../src/lib/importPhase"),
});
let L: Awaited<ReturnType<typeof load>>;

const stamp = `${Date.now()}`;
let collectionId = "";
let courseId = "";
const chapterIds: string[] = [];
const emails: string[] = [];

type Range = { chapter: number; start: number; end: number };
// Drie hoofdstukken met elk twee stappen: volgorde 0..5.
const base: Range[] = [
  { chapter: 0, start: 1, end: 6 }, { chapter: 0, start: 7, end: 12 },
  { chapter: 1, start: 1, end: 6 }, { chapter: 1, start: 7, end: 12 },
  { chapter: 2, start: 1, end: 6 }, { chapter: 2, start: 7, end: 12 },
];

const plan = (ranges: Range[]) => ranges.map((r, order) => ({ chapterId: chapterIds[r.chapter], startVerse: r.start, endVerse: r.end, order, exerciseIds: [] as string[] }));
const apply = (ranges: Range[]) => L.db.$transaction((tx) => L.courses.applyLessonPlan(tx, courseId, plan(ranges)));
const lessons = () => L.db.courseLesson.findMany({ where: { courseId }, orderBy: { order: "asc" } });
const idsByKey = async () => new Map((await lessons()).map((lesson) => [`${lesson.chapterId}:${lesson.startVerse}`, lesson.id]));
const key = (r: Range) => `${chapterIds[r.chapter]}:${r.start}`;

async function makeUser(): Promise<string> {
  const email = `coursesync-${stamp}-${emails.length}@test.invalid`;
  emails.push(email);
  return (await L.db.user.create({ data: { email, passwordHash: "x", handle: `Cs${emails.length}`, discriminator: "21" } })).id;
}

before(async () => {
  if (skip) return;
  L = await load();
  collectionId = `coursesync-${stamp}`;
  await L.db.contentCollection.create({ data: { id: collectionId, slug: collectionId, name: collectionId, icon: "book", work: collectionId, language: "nl", order: 903 } });
  const book = await L.db.book.create({ data: { slug: `${collectionId}-b`, name: "Boek", order: 0, contentCollectionId: collectionId } });
  for (let i = 0; i < 3; i++) chapterIds.push((await L.db.chapter.create({ data: { bookId: book.id, number: i + 1, order: i } })).id);
  courseId = (await L.db.course.create({ data: { slug: `${collectionId}-stappen`, type: "READING_LESSONS", name: "Stappen", order: 0, contentCollectionId: collectionId } })).id;
});

after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { email: { in: emails } } });
  await L.db.contentCollection.deleteMany({ where: { id: collectionId } });
  await L.db.$disconnect();
});

test("een eerste en een tweede identieke synchronisatie: zelfde lessen, zelfde id's, niets gewijzigd", { skip }, async () => {
  const first = await apply(base);
  assert.equal(first.created, 6);
  const before = await lessons();
  const second = await apply(base);
  assert.deepEqual(second, { created: 0, updated: 0, reordered: 0, removed: 0, remapped: 0 });
  const after = await lessons();
  assert.deepEqual(after.map((l) => [l.id, l.order, l.chapterId, l.startVerse, l.endVerse]), before.map((l) => [l.id, l.order, l.chapterId, l.startVerse, l.endVerse]));
});

test("twee lessen wisselen van volgorde: geen unieke-constraintfout en de id's blijven bij hun les", { skip }, async () => {
  await apply(base);
  const ids = await idsByKey();
  const swapped = [...base];
  [swapped[1], swapped[4]] = [swapped[4], swapped[1]];
  const result = await apply(swapped);
  assert.equal(result.reordered, 2);
  const after = await lessons();
  assert.deepEqual(after.map((l) => `${l.chapterId}:${l.startVerse}`), swapped.map(key));
  for (const [k, id] of ids) assert.equal((await idsByKey()).get(k), id, "elk lesid blijft hetzelfde");
  await apply(base);
});

test("een nieuwe les tussen bestaande lessen invoegen schuift de rest op zonder botsing", { skip }, async () => {
  await apply(base);
  const ids = await idsByKey();
  const extra: Range = { chapter: 1, start: 13, end: 18 };
  const inserted = [...base.slice(0, 3), extra, ...base.slice(3)];
  // De nieuwe les staat midden in de rij; alles erna schuift één plek op.
  const result = await apply(inserted);
  assert.equal(result.created, 1);
  assert.equal(result.reordered, 3);
  assert.deepEqual((await lessons()).map((l) => `${l.chapterId}:${l.startVerse}`), inserted.map(key));
  for (const range of base) assert.equal((await idsByKey()).get(key(range)), ids.get(key(range)));
  // De lijst weer terug naar het basisplan: de nieuwe les verdwijnt, de rest schuift terug.
  await apply(base);
  assert.equal((await lessons()).length, 6);
});

test("een bestaande les verplaatsen (naar voren en naar achteren) behoudt zijn id", { skip }, async () => {
  await apply(base);
  const ids = await idsByKey();
  const toFront = [base[5], ...base.slice(0, 5)];
  await apply(toFront);
  assert.deepEqual((await lessons()).map((l) => `${l.chapterId}:${l.startVerse}`), toFront.map(key));
  const toBack = [...toFront.slice(1), toFront[0]];
  await apply(toBack);
  assert.deepEqual((await lessons()).map((l) => `${l.chapterId}:${l.startVerse}`), base.map(key));
  for (const range of base) assert.equal((await idsByKey()).get(key(range)), ids.get(key(range)));
});

test("gebruikersvoortgang, oefensessies en de huidige les blijven bij herschikken behouden", { skip }, async () => {
  await apply(base);
  const ids = await idsByKey();
  const user = await makeUser();
  const done = ids.get(key(base[0]))!;
  const current = ids.get(key(base[3]))!;
  await L.db.userCourseLessonProgress.create({ data: { userId: user, lessonId: done, completed: true, bestScore: 90, xpEarned: 10 } });
  await L.db.userCourseProgress.create({ data: { userId: user, courseId, currentLessonId: current } });
  await L.db.exerciseSession.create({ data: { userId: user, chapterId: chapterIds[1], contentKey: "k", exerciseIds: "[]", courseLessonId: current } });

  const reshuffled = [base[3], base[0], base[5], base[1], base[4], base[2]];
  await apply(reshuffled);
  assert.equal((await L.db.userCourseLessonProgress.findUniqueOrThrow({ where: { userId_lessonId: { userId: user, lessonId: done } } })).bestScore, 90);
  assert.equal((await L.db.userCourseProgress.findFirstOrThrow({ where: { userId: user, courseId } })).currentLessonId, current);
  assert.equal(await L.db.exerciseSession.count({ where: { userId: user, courseLessonId: current } }), 1);
  await apply(base);
});

test("een les die uit het plan verdwijnt: voortgang, sessie en huidige les gaan naar de les die dat beginvers nu dekt", { skip }, async () => {
  await apply(base);
  const ids = await idsByKey();
  const user = await makeUser();
  const gone = ids.get(key(base[1]))!; // hoofdstuk 0, verzen 7-12
  await L.db.userCourseLessonProgress.create({ data: { userId: user, lessonId: gone, completed: true, bestScore: 80 } });
  await L.db.userCourseProgress.create({ data: { userId: user, courseId, currentLessonId: gone } });
  await L.db.exerciseSession.create({ data: { userId: user, chapterId: chapterIds[0], contentKey: "k2", exerciseIds: "[]", courseLessonId: gone } });

  // Hoofdstuk 0 krijgt nu één stap van vers 1 t/m 12: de tweede stap (vers 7) bestaat niet meer.
  const changed = [{ chapter: 0, start: 1, end: 12 }, ...base.slice(2)];
  const result = await apply(changed);
  assert.equal(result.removed, 1);
  assert.ok(result.remapped >= 2);
  const target = (await idsByKey()).get(key({ chapter: 0, start: 1, end: 12 }))!;
  assert.equal(target, ids.get(key(base[0])), "de bestaande eerste stap blijft dezelfde les");
  assert.equal((await L.db.userCourseLessonProgress.findFirstOrThrow({ where: { userId: user } })).lessonId, target);
  assert.equal((await L.db.userCourseProgress.findFirstOrThrow({ where: { userId: user, courseId } })).currentLessonId, target);
  assert.equal(await L.db.exerciseSession.count({ where: { userId: user, courseLessonId: target } }), 1);
  await apply(base);
});

test("een foutief plan (dubbele volgorde of dubbele les) laat de bestaande lessen ongemoeid", { skip }, async () => {
  await apply(base);
  const before = (await lessons()).map((l) => [l.id, l.order]);
  const broken = plan(base).map((lesson, index) => ({ ...lesson, order: index === 3 ? 2 : lesson.order }));
  await assert.rejects(() => L.db.$transaction((tx) => L.courses.applyLessonPlan(tx, courseId, broken)), /dubbele of negatieve volgorde/);
  assert.deepEqual((await lessons()).map((l) => [l.id, l.order]), before);
});

test("syncCourses zelf: tweemaal achter elkaar draaien verandert geen les-id's en geeft geen constraintfout", { skip }, async () => {
  const sibling = await L.db.courseLesson.count();
  const { syncCourses } = L.courses;
  // Alleen zinvol als de testdatabase al content heeft (de seed); anders geen cursus om te vergelijken.
  if ((await L.db.contentCollection.count({ where: { enabled: true } })) === 0 || sibling === 0) return;
  const snapshot = async () => (await L.db.courseLesson.findMany({ orderBy: [{ courseId: "asc" }, { order: "asc" }], select: { id: true, courseId: true, order: true, chapterId: true, startVerse: true } })).filter((l) => l.courseId !== courseId);
  const before = await snapshot();
  await syncCourses(L.db);
  await syncCourses(L.db);
  assert.deepEqual(await snapshot(), before);
});

test("fasefouten: een cursusfout blijft een cursusfout en wordt niet als Bijbelfout gemeld", { skip }, async () => {
  const { inPhase, ImportPhaseError } = L.phase;
  await assert.rejects(() => inPhase("Bijbel (OTB)", () => inPhase("Cursussen", async () => { throw new Error("CourseLesson_courseId_order_key"); })), (error: unknown) => {
    assert.ok(error instanceof ImportPhaseError);
    assert.equal(error.phase, "Cursussen");
    assert.match(error.message, /^\[Cursussen\] CourseLesson_courseId_order_key$/);
    return true;
  });
  await assert.rejects(() => inPhase("Bijbel (OTB)", async () => { throw new Error("boem"); }), /^ImportPhaseError: \[Bijbel \(OTB\)\] boem$/);
});

test("de oorzaak: een les direct een bezette volgorde geven botst nog steeds (de unieke constraint blijft); applyLessonPlan omzeilt dat zonder hem te verwijderen", { skip }, async () => {
  await apply(base);
  const [first, second] = await lessons();
  // Dit deed de oude synchronisatie per les (upsert met order = nieuwe plek) zodra een les een bezette plek kreeg.
  await assert.rejects(() => L.db.courseLesson.update({ where: { id: second.id }, data: { order: first.order } }), (error: { code?: string }) => error.code === "P2002");
  const swapped = [base[1], base[0], ...base.slice(2)];
  await apply(swapped);
  await apply(base);
});
