// Regressietests voor de identiteit van de leescursussen (src/lib/courses.ts, courseIntegrity.ts, courseRepair.ts): het Boek van Mormon
// is de vaste standaardcollectie, een andere collectie met dezelfde `order` of een wijziging van `enabled` maakt geen duplicaten,
// en bestaande duplicaten worden alleen veilig samengevoegd. Draait alleen met LEARNING_TEST_DATABASE_URL (een wegwerpdatabase).
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npx tsx --test tests/course-identity.integration.test.ts
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "testsleutel-voor-cursusidentiteit-0123456789";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  courses: await import("../src/lib/courses"),
  integrity: await import("../src/lib/courseIntegrity"),
  repair: await import("../src/lib/courseRepair"),
  ids: await import("../src/lib/contentCollectionIds"),
});
let L: Awaited<ReturnType<typeof load>>;

const stamp = `${Date.now()}`;
const TYPES = ["FREE_CHOICE", "FRONT_TO_BACK", "READING_LESSONS"] as const;
const BOM_SLUGS = { FREE_CHOICE: "vrije-keuze", FRONT_TO_BACK: "voor-naar-achter", READING_LESSONS: "lezen-van-voor-naar-achter" } as const;
const otherId = `identity-other-${stamp}`;
const otherSlug = `identity-other-${stamp}`;
const emails: string[] = [];
const bomBookIds: string[] = [];
const bomChapterIds: string[] = [];
let preexistingBomCourses = 0;

const bomCourses = (type?: string) => L.db.course.findMany({ where: { contentCollectionId: L.ids.BOM_COLLECTION_ID, type: type ? (type as never) : { in: [...TYPES] } }, orderBy: { slug: "asc" } });
const snapshot = async () => (await L.db.course.findMany({ where: { type: { in: [...TYPES] } }, orderBy: { slug: "asc" }, select: { id: true, slug: true, type: true, contentCollectionId: true } }));
async function makeUser(): Promise<string> {
  const email = `identity-${stamp}-${emails.length}@test.invalid`;
  emails.push(email);
  return (await L.db.user.create({ data: { email, passwordHash: "x", handle: `Id${emails.length}`, discriminator: "22" } })).id;
}

before(async () => {
  if (skip) return;
  L = await load();
  preexistingBomCourses = await L.db.course.count({ where: { contentCollectionId: L.ids.BOM_COLLECTION_ID, type: { in: [...TYPES] } } });
  // Een Boek van Mormon met twee hoofdstukken van 12 verzen (twee stappen per hoofdstuk).
  const book = await L.db.book.create({ data: { slug: `identity-bom-${stamp}`, name: "Identiteitsboek", order: 999, contentCollectionId: L.ids.BOM_COLLECTION_ID } });
  bomBookIds.push(book.id);
  for (let i = 0; i < 2; i++) {
    const chapter = await L.db.chapter.create({ data: { bookId: book.id, number: i + 1, order: i } });
    bomChapterIds.push(chapter.id);
    for (let v = 1; v <= 12; v++) await L.db.verse.create({ data: { chapterId: chapter.id, number: v, text: `vers ${v}` } });
  }
  // Een tweede schriftcollectie met dezelfde `order` als het Boek van Mormon (0): de oorzaak van de duplicaten.
  await L.db.contentWork.create({ data: { key: otherId, kind: "OTHER" } });
  await L.db.contentCollection.create({ data: { id: otherId, slug: otherSlug, name: "Andere schrift", icon: "book", work: otherId, language: "nl", order: 0 } });
  const otherBook = await L.db.book.create({ data: { slug: `${otherId}-b`, name: "Ander boek", order: 0, contentCollectionId: otherId } });
  const otherChapter = await L.db.chapter.create({ data: { bookId: otherBook.id, number: 1, order: 0 } });
  for (let v = 1; v <= 12; v++) await L.db.verse.create({ data: { chapterId: otherChapter.id, number: v, text: `vers ${v}` } });
});

after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { email: { in: emails } } });
  await L.db.course.deleteMany({ where: { contentCollectionId: otherId } });
  if (preexistingBomCourses === 0) await L.db.course.deleteMany({ where: { contentCollectionId: L.ids.BOM_COLLECTION_ID, type: { in: [...TYPES] } } });
  await L.db.book.deleteMany({ where: { contentCollectionId: otherId } });
  await L.db.book.deleteMany({ where: { id: { in: bomBookIds } } });
  await L.db.contentCollection.deleteMany({ where: { id: otherId } });
  await L.db.contentWork.deleteMany({ where: { key: otherId } });
  await L.db.$disconnect();
});

test("een verse synchronisatie geeft het Boek van Mormon precies drie leeswijzen met de historische slugs", { skip }, async () => {
  await L.courses.syncCourses(L.db);
  const bom = await bomCourses();
  assert.deepEqual(bom.map((c) => c.type).sort(), [...TYPES].sort());
  for (const course of bom) assert.equal(course.slug, BOM_SLUGS[course.type as keyof typeof BOM_SLUGS]);
  assert.deepEqual(await L.integrity.findDuplicateReadingCourses(L.db), []);
  // KIDS en INTRO blijven één keer, in het Boek van Mormon.
  assert.equal(await L.db.course.count({ where: { type: "KIDS" } }), 1);
  assert.equal(await L.db.course.count({ where: { type: "INTRO" } }), 1);
});

test("tweemaal synchroniseren verandert niets: dezelfde id's, geen duplicaten", { skip }, async () => {
  const first = await snapshot();
  await L.courses.syncCourses(L.db);
  await L.courses.syncCourses(L.db);
  assert.deepEqual(await snapshot(), first);
});

test("een andere collectie met dezelfde order als het Boek van Mormon, in elke volgorde, wijzigt de cursusidentiteit niet", { skip }, async () => {
  const before = await snapshot();
  for (const order of [0, -5, 0, 7]) {
    await L.db.contentCollection.update({ where: { id: otherId }, data: { order } });
    await L.courses.syncCourses(L.db);
  }
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await L.integrity.findDuplicateReadingCourses(L.db), []);
  // De andere collectie heeft zijn eigen, collectiegebonden cursussen.
  const other = await L.db.course.findMany({ where: { contentCollectionId: otherId, type: { in: [...TYPES] } } });
  assert.deepEqual(other.map((c) => c.slug).sort(), TYPES.map((t) => `${BOM_SLUGS[t]}-${otherSlug}`).sort());
});

test("een collectie in- of uitschakelen (ook het Boek van Mormon zelf) maakt geen andere collectie tot standaard", { skip }, async () => {
  const before = await snapshot();
  await L.db.contentCollection.update({ where: { id: otherId }, data: { enabled: false } });
  await L.courses.syncCourses(L.db);
  await L.db.contentCollection.update({ where: { id: otherId }, data: { enabled: true } });
  await L.db.contentCollection.update({ where: { id: L.ids.BOM_COLLECTION_ID }, data: { enabled: false } });
  await L.courses.syncCourses(L.db);
  await L.db.contentCollection.update({ where: { id: L.ids.BOM_COLLECTION_ID }, data: { enabled: true } });
  await L.courses.syncCourses(L.db);
  assert.deepEqual(await snapshot(), before);
});

test("een gewijzigde collectieslug maakt geen tweede set cursussen voor die collectie (één bestaand record per soort wordt overgenomen)", { skip }, async () => {
  const before = await snapshot();
  const renamed = `${otherSlug}-nieuw`;
  await L.db.contentCollection.update({ where: { id: otherId }, data: { slug: renamed } });
  await L.courses.syncCourses(L.db);
  const after = await snapshot();
  assert.equal(after.length, before.length, "geen extra cursussen");
  assert.deepEqual(after.map((c) => c.id).sort(), before.map((c) => c.id).sort(), "dezelfde records");
  assert.ok(after.filter((c) => c.contentCollectionId === otherId).every((c) => c.slug.endsWith(renamed)), "de slug is rechtgezet");
  await L.db.contentCollection.update({ where: { id: otherId }, data: { slug: otherSlug } });
  await L.courses.syncCourses(L.db);
  assert.deepEqual((await snapshot()).map((c) => c.id).sort(), before.map((c) => c.id).sort());
  // Twee bestaande kandidaten (al dubbel) worden nooit willekeurig overgenomen en leiden niet tot nog een extra record per sync.
  const stillThere = await L.db.course.count({ where: { contentCollectionId: otherId, type: { in: [...TYPES] } } });
  await L.courses.syncCourses(L.db);
  assert.equal(await L.db.course.count({ where: { contentCollectionId: otherId, type: { in: [...TYPES] } } }), stillThere);
});

test("meerdere bestaande cursussen van hetzelfde soort onder eigen slugs (fixture) laten de synchronisatie idempotent", { skip }, async () => {
  const extra = [];
  for (const slug of [`identity-fx-a-${stamp}`, `identity-fx-b-${stamp}`]) extra.push(await L.db.course.create({ data: { slug, type: "READING_LESSONS", name: slug, order: 2, contentCollectionId: otherId } }));
  const lessonsOf = async () => (await L.db.courseLesson.findMany({ orderBy: [{ courseId: "asc" }, { order: "asc" }], select: { id: true, courseId: true, order: true, chapterId: true, startVerse: true } }));
  await L.courses.syncCourses(L.db);
  const first = await lessonsOf();
  const firstCourses = await snapshot();
  await L.courses.syncCourses(L.db);
  await L.courses.syncCourses(L.db);
  assert.deepEqual(await lessonsOf(), first, "geen willekeurige overname van een van de bestaande cursussen");
  assert.deepEqual(await snapshot(), firstCourses);
  await L.db.course.deleteMany({ where: { id: { in: extra.map((c) => c.id) } } });
});

test("abonnementen, hoofdstukvoortgang, lesvoortgang, scores en XP blijven bewaard na herhaalde synchronisatie", { skip }, async () => {
  const userId = await makeUser();
  const free = (await bomCourses("FREE_CHOICE"))[0];
  const steps = (await bomCourses("READING_LESSONS"))[0];
  const lessons = await L.db.courseLesson.findMany({ where: { courseId: steps.id }, orderBy: { order: "asc" } });
  assert.ok(lessons.length >= 2);
  await L.db.userCourseProgress.create({ data: { userId, courseId: free.id, currentChapterId: bomChapterIds[1], subscribed: true } });
  await L.db.userCourseProgress.create({ data: { userId, courseId: steps.id, currentLessonId: lessons[1].id, subscribed: true } });
  await L.db.userCourseLessonProgress.create({ data: { userId, lessonId: lessons[0].id, completed: true, bestScore: 87, xpEarned: 40, completedAt: new Date() } });
  await L.db.user.update({ where: { id: userId }, data: { activeCourseId: steps.id } });
  await L.courses.syncCourses(L.db);
  await L.courses.syncCourses(L.db);
  assert.equal((await L.db.userCourseProgress.findUniqueOrThrow({ where: { userId_courseId: { userId, courseId: free.id } } })).currentChapterId, bomChapterIds[1]);
  const stepsProgress = await L.db.userCourseProgress.findUniqueOrThrow({ where: { userId_courseId: { userId, courseId: steps.id } } });
  assert.equal(stepsProgress.currentLessonId, lessons[1].id);
  assert.equal(stepsProgress.subscribed, true);
  const done = await L.db.userCourseLessonProgress.findUniqueOrThrow({ where: { userId_lessonId: { userId, lessonId: lessons[0].id } } });
  assert.deepEqual([done.completed, done.bestScore, done.xpEarned], [true, 87, 40]);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: userId } })).activeCourseId, steps.id);
});

test("een Boek van Mormon zonder hoofdstukken laat bestaande lessen en cursussen ongemoeid (geen leeg lessenplan)", { skip }, async () => {
  const stepsBefore = (await bomCourses("READING_LESSONS"))[0];
  const lessonsBefore = await L.db.courseLesson.count({ where: { courseId: stepsBefore.id } });
  // Hoofdstukken tijdelijk loskoppelen is destructief; in plaats daarvan het gedrag van de bewaker direct testen via een lege collectie.
  const emptyId = `identity-empty-${stamp}`;
  await L.db.contentWork.create({ data: { key: emptyId, kind: "OTHER" } });
  await L.db.contentCollection.create({ data: { id: emptyId, slug: emptyId, name: "Leeg", icon: "book", work: emptyId, language: "nl", order: 0 } });
  await L.db.book.create({ data: { slug: `${emptyId}-b`, name: "Leeg boek", order: 0, contentCollectionId: emptyId } });
  await L.courses.syncCourses(L.db);
  assert.equal(await L.db.course.count({ where: { contentCollectionId: emptyId } }), 0, "zonder hoofdstukken worden er geen cursussen aangemaakt");
  assert.equal(await L.db.courseLesson.count({ where: { courseId: stepsBefore.id } }), lessonsBefore);
  await L.db.book.deleteMany({ where: { contentCollectionId: emptyId } });
  await L.db.contentCollection.delete({ where: { id: emptyId } });
  await L.db.contentWork.delete({ where: { key: emptyId } });
});

// --- Herstel van bestaande duplicaten -----------------------------------------------------------------------------------------------

async function makeDuplicates() {
  // De situatie uit productie: dezelfde drie leeswijzen nog eens onder de slug van de collectie.
  const duplicates = [];
  for (const type of TYPES) {
    const canonical = (await bomCourses(type))[0];
    duplicates.push(await L.db.course.create({ data: { slug: `${BOM_SLUGS[type]}-boek-van-mormon`, type, name: canonical.name, order: canonical.order, contentCollectionId: L.ids.BOM_COLLECTION_ID } }));
  }
  return duplicates;
}

test("een gesimuleerde database met dubbele cursussen wordt herkend; de API-bron toont daarna één cursus per leeswijze", { skip }, async () => {
  const duplicates = await makeDuplicates();
  const found = await L.integrity.findDuplicateReadingCourses(L.db);
  assert.equal(found.length, 3);
  for (const group of found) {
    assert.equal(group.contentCollectionId, L.ids.BOM_COLLECTION_ID);
    assert.equal(group.courses.filter((c) => c.canonical).length, 1);
  }
  // Een normale synchronisatie voegt geen derde set toe en raakt de duplicaten niet aan.
  await L.courses.syncCourses(L.db);
  assert.equal((await bomCourses()).length, 6);
  const plans = await L.repair.planDuplicateRepair(L.db);
  assert.equal(plans.length, 3);
  assert.ok(plans.every((p) => p.verdict === "merge" && p.duplicateIds.length === 1));
  assert.deepEqual(new Set(plans.flatMap((p) => p.duplicateIds)), new Set(duplicates.map((d) => d.id)));
  for (const plan of plans) assert.ok(plan.inventory.every((inv) => typeof inv.usersWithProgress === "number"));
});

test("het herstel voegt voortgang veilig samen, verhuist verwijzingen en is herhaalbaar zonder gegevensverlies", { skip }, async () => {
  const canonicalSteps = (await bomCourses("READING_LESSONS")).find((c) => !c.slug.endsWith("-boek-van-mormon"))!;
  const duplicateSteps = (await bomCourses("READING_LESSONS")).find((c) => c.slug.endsWith("-boek-van-mormon"))!;
  const canonicalFree = (await bomCourses("FREE_CHOICE")).find((c) => !c.slug.endsWith("-boek-van-mormon"))!;
  const duplicateFree = (await bomCourses("FREE_CHOICE")).find((c) => c.slug.endsWith("-boek-van-mormon"))!;
  // De dubbele Stap-voor-stap-cursus krijgt dezelfde lessen (zelfde hoofdstuk + beginvers) als de canonieke.
  const canonicalLessons = await L.db.courseLesson.findMany({ where: { courseId: canonicalSteps.id }, orderBy: { order: "asc" } });
  for (const lesson of canonicalLessons)
    await L.db.courseLesson.create({ data: { courseId: duplicateSteps.id, chapterId: lesson.chapterId, startVerse: lesson.startVerse, endVerse: lesson.endVerse, order: lesson.order } });
  const dupLessons = await L.db.courseLesson.findMany({ where: { courseId: duplicateSteps.id }, orderBy: { order: "asc" } });

  const both = await makeUser(); // voortgang in beide cursussen
  const onlyDup = await makeUser(); // alleen in de dubbele cursus
  const onlyCanonical = await makeUser();
  // `both`: canonieke les 0 voltooid met score 50; dubbele les 0 voltooid met 90 en XP 70; dubbele les 1 voltooid.
  await L.db.userCourseLessonProgress.create({ data: { userId: both, lessonId: canonicalLessons[0].id, completed: false, bestScore: 50, xpEarned: 20 } });
  await L.db.userCourseLessonProgress.create({ data: { userId: both, lessonId: dupLessons[0].id, completed: true, bestScore: 90, xpEarned: 70, completedAt: new Date() } });
  await L.db.userCourseLessonProgress.create({ data: { userId: both, lessonId: dupLessons[1].id, completed: true, bestScore: 60, xpEarned: 30, completedAt: new Date() } });
  const older = new Date(Date.now() - 86_400_000);
  await L.db.userCourseProgress.create({ data: { userId: both, courseId: canonicalSteps.id, currentLessonId: canonicalLessons[0].id, subscribed: false, lastActivityAt: older } });
  await L.db.userCourseProgress.create({ data: { userId: both, courseId: duplicateSteps.id, currentLessonId: dupLessons[2]?.id ?? dupLessons[1].id, subscribed: true, lastActivityAt: new Date() } });
  await L.db.userCourseProgress.create({ data: { userId: onlyDup, courseId: duplicateSteps.id, currentLessonId: dupLessons[1].id, subscribed: true } });
  await L.db.userCourseLessonProgress.create({ data: { userId: onlyDup, lessonId: dupLessons[1].id, completed: true, bestScore: 77, xpEarned: 55, completedAt: new Date() } });
  await L.db.user.update({ where: { id: onlyDup }, data: { activeCourseId: duplicateSteps.id } });
  await L.db.userCourseProgress.create({ data: { userId: onlyCanonical, courseId: canonicalFree.id, currentChapterId: bomChapterIds[0], subscribed: true } });
  await L.db.userCourseProgress.create({ data: { userId: both, courseId: duplicateFree.id, currentChapterId: bomChapterIds[1], subscribed: true } });
  await L.db.userListOrder.create({ data: { userId: onlyDup, listKey: "courses", itemKey: duplicateFree.id, order: 3, hidden: false } });
  await L.db.userListOrder.create({ data: { userId: both, listKey: "courses", itemKey: canonicalFree.id, order: 1, hidden: true } });
  await L.db.userListOrder.create({ data: { userId: both, listKey: "courses", itemKey: duplicateFree.id, order: 2, hidden: true } });
  const session = await L.db.exerciseSession.create({ data: { userId: onlyDup, chapterId: bomChapterIds[0], contentKey: `identity:${stamp}`, exerciseIds: "[]", courseLessonId: dupLessons[1].id } });

  const xpBefore = await L.db.userCourseLessonProgress.aggregate({ _sum: { xpEarned: true }, where: { userId: { in: [both, onlyDup] } } });
  const plans = await L.repair.planDuplicateRepair(L.db);
  assert.ok(plans.every((p) => p.verdict === "merge"), JSON.stringify(plans.map((p) => p.notes)));
  const result = await L.repair.applyDuplicateRepair(L.db, plans);
  assert.equal(result.blocked.length, 0);
  assert.equal(result.merged.length, 3);

  assert.deepEqual(await L.integrity.findDuplicateReadingCourses(L.db), []);
  assert.equal((await bomCourses()).length, 3);
  assert.equal(await L.db.course.count({ where: { id: { in: [duplicateSteps.id, duplicateFree.id] } } }), 0);

  // Lesvoortgang: nooit minder; maximum van score en XP, voltooid als één van beide voltooid is.
  const merged0 = await L.db.userCourseLessonProgress.findUniqueOrThrow({ where: { userId_lessonId: { userId: both, lessonId: canonicalLessons[0].id } } });
  assert.deepEqual([merged0.completed, merged0.bestScore, merged0.xpEarned], [true, 90, 70]);
  const merged1 = await L.db.userCourseLessonProgress.findUniqueOrThrow({ where: { userId_lessonId: { userId: both, lessonId: canonicalLessons[1].id } } });
  assert.deepEqual([merged1.completed, merged1.bestScore, merged1.xpEarned], [true, 60, 30]);
  const moved = await L.db.userCourseLessonProgress.findUniqueOrThrow({ where: { userId_lessonId: { userId: onlyDup, lessonId: canonicalLessons[1].id } } });
  assert.deepEqual([moved.completed, moved.bestScore, moved.xpEarned], [true, 77, 55]);
  const xpAfter = await L.db.userCourseLessonProgress.aggregate({ _sum: { xpEarned: true }, where: { userId: { in: [both, onlyDup] } } });
  assert.ok((xpAfter._sum.xpEarned ?? 0) >= 70 + 30 + 55, "verdiende XP blijft behouden");
  assert.ok((xpAfter._sum.xpEarned ?? 0) <= (xpBefore._sum.xpEarned ?? 0), "XP wordt niet dubbel geteld");

  // Cursusvoortgang: abonnement blijft, de plek volgt de recentste activiteit, gebruikers met alleen de dubbele cursus verhuizen mee.
  const bothProgress = await L.db.userCourseProgress.findUniqueOrThrow({ where: { userId_courseId: { userId: both, courseId: canonicalSteps.id } } });
  assert.equal(bothProgress.subscribed, true);
  assert.ok(bothProgress.currentLessonId, "plek blijft bewaard (de nieuwere activiteit)");
  const dupOnlyProgress = await L.db.userCourseProgress.findUniqueOrThrow({ where: { userId_courseId: { userId: onlyDup, courseId: canonicalSteps.id } } });
  assert.equal(dupOnlyProgress.currentLessonId, canonicalLessons[1].id);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: onlyDup } })).activeCourseId, canonicalSteps.id);
  const freeProgress = await L.db.userCourseProgress.findUniqueOrThrow({ where: { userId_courseId: { userId: both, courseId: canonicalFree.id } } });
  assert.equal(freeProgress.currentChapterId, bomChapterIds[1]);
  assert.equal((await L.db.userCourseProgress.findUniqueOrThrow({ where: { userId_courseId: { userId: onlyCanonical, courseId: canonicalFree.id } } })).currentChapterId, bomChapterIds[0]);
  // Persoonlijke volgorde: de dubbele rij verhuist of voegt samen met de canonieke.
  assert.equal(await L.db.userListOrder.count({ where: { itemKey: { in: [duplicateSteps.id, duplicateFree.id] } } }), 0);
  assert.equal((await L.db.userListOrder.findUniqueOrThrow({ where: { userId_listKey_itemKey: { userId: onlyDup, listKey: "courses", itemKey: canonicalFree.id } } })).order, 3);
  assert.equal((await L.db.userListOrder.findUniqueOrThrow({ where: { userId_listKey_itemKey: { userId: both, listKey: "courses", itemKey: canonicalFree.id } } })).hidden, true);
  assert.equal((await L.db.exerciseSession.findUniqueOrThrow({ where: { id: session.id } })).courseLessonId, canonicalLessons[1].id, "oefensessie verhuist mee");

  // De bron van /api/courses en de cursuskaarten (ingeschakelde cursussen van de collectie): één cursus per leeswijze.
  const listed = await L.db.course.findMany({ where: { enabled: true, contentCollectionId: L.ids.BOM_COLLECTION_ID, type: { in: [...TYPES] } } });
  assert.deepEqual(listed.map((c) => c.type).sort(), [...TYPES].sort());

  // Tweede run: niets meer te doen, niets gewijzigd.
  const snapshotBefore = JSON.stringify(await L.db.userCourseLessonProgress.findMany({ where: { userId: { in: [both, onlyDup] } }, orderBy: [{ userId: "asc" }, { lessonId: "asc" }] }));
  assert.deepEqual(await L.repair.planDuplicateRepair(L.db), []);
  const again = await L.repair.applyDuplicateRepair(L.db);
  assert.deepEqual(again, { merged: [], blocked: [] });
  assert.equal(JSON.stringify(await L.db.userCourseLessonProgress.findMany({ where: { userId: { in: [both, onlyDup] } }, orderBy: [{ userId: "asc" }, { lessonId: "asc" }] })), snapshotBefore);
  // Een synchronisatie na het herstel maakt geen nieuwe duplicaten.
  await L.courses.syncCourses(L.db);
  assert.deepEqual(await L.integrity.findDuplicateReadingCourses(L.db), []);
});

test("een voortgangsconflict dat niet veilig samen te voegen is, blokkeert de groep en overschrijft niets", { skip }, async () => {
  const [duplicate] = await Promise.all([(async () => {
    const canonical = (await bomCourses("READING_LESSONS"))[0];
    return L.db.course.create({ data: { slug: "lezen-van-voor-naar-achter-boek-van-mormon", type: "READING_LESSONS", name: canonical.name, order: canonical.order, contentCollectionId: L.ids.BOM_COLLECTION_ID } });
  })()]);
  // Een les in de dubbele cursus die in de canonieke niet bestaat (ander beginvers), met gebruikersvoortgang.
  const orphan = await L.db.courseLesson.create({ data: { courseId: duplicate.id, chapterId: bomChapterIds[0], startVerse: 3, endVerse: 4, order: 0 } });
  const userId = await makeUser();
  await L.db.userCourseLessonProgress.create({ data: { userId, lessonId: orphan.id, completed: true, bestScore: 99, xpEarned: 80, completedAt: new Date() } });
  await L.db.userCourseProgress.create({ data: { userId, courseId: duplicate.id, currentLessonId: orphan.id, subscribed: true } });
  const plans = await L.repair.planDuplicateRepair(L.db);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].verdict, "blocked");
  assert.match(plans[0].notes.join(" "), /gelijkwaardige les/);
  const result = await L.repair.applyDuplicateRepair(L.db);
  assert.deepEqual(result.merged, []);
  assert.equal(result.blocked.length, 1);
  // Niets is aangeraakt: de dubbele cursus en alle voortgang bestaan nog.
  assert.ok(await L.db.course.findUnique({ where: { id: duplicate.id } }));
  assert.equal((await L.db.userCourseLessonProgress.findUniqueOrThrow({ where: { userId_lessonId: { userId, lessonId: orphan.id } } })).bestScore, 99);
  assert.equal((await L.db.userCourseProgress.findUniqueOrThrow({ where: { userId_courseId: { userId, courseId: duplicate.id } } })).subscribed, true);
  // Opruimen zodat de volgende tests een schone toestand hebben.
  await L.db.userCourseProgress.deleteMany({ where: { userId } });
  await L.db.courseLesson.deleteMany({ where: { id: orphan.id } });
  await L.db.course.delete({ where: { id: duplicate.id } });
});

test("andere cursussoorten (podcasts, kinderen, introductie) tellen niet mee in de invariant", { skip }, async () => {
  assert.equal(await L.db.course.count({ where: { type: "PODCAST" } }) >= 2, true, "meerdere podcastcursussen per collectie zijn toegestaan");
  assert.deepEqual(await L.integrity.findDuplicateReadingCourses(L.db), []);
});
