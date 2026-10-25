// Contentimport V2 (zie docs/CONTENTBEHEER.md): een normale (her)import verandert niets aan wat niet gewijzigd is, behoudt oefen-id's,
// antwoordopties, lessen, voortgang, uitgedeelde oefensets, XP-bijschrijvingen en alle beheerinstellingen van collecties, en gewijzigde
// vragen worden veilig geversioneerd. Draait alleen met LEARNING_TEST_DATABASE_URL (een wegwerpdatabase).
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npx tsx --test tests/content-import.integration.test.ts
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "testsleutel-voor-contentimport-0123456789";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  importer: await import("../prisma/importContent"),
  progress: await import("../src/lib/learning/contentProgress"),
  lock: await import("../src/lib/contentImportLock"),
  otb: await import("../scripts/otb/import-core"),
  otbConfig: await import("../scripts/otb/trialConfig"),
  podcast: await import("../prisma/importPodcast"),
  kids: await import("../prisma/importKids"),
  intro: await import("../prisma/importIntro"),
  podcasts: await import("../src/lib/podcasts"),
});
let L: Awaited<ReturnType<typeof load>>;

const stamp = `${Date.now()}`;
const collectionId = `contentimport-${stamp}`;
const emails: string[] = [];
const quiet = () => {};

const sentence = (n: number) =>
  `In de dagen van de profeet nummer ${n} kwam het volk samen om te bidden voor vrede en om dankbaar te zijn voor de zegeningen van de Heer`;
const verses = (count: number, change?: { index: number; text: string }) =>
  Array.from({ length: count }, (_, i) => (change && change.index === i ? change.text : sentence(i + 1)));
const seedBook = (change?: { index: number; text: string }) => ({
  slug: `${collectionId}-boek`,
  name: "Testboek",
  chapters: [
    { number: 1, heading: "Eerste", verses: verses(12, change) },
    { number: 2, heading: "Tweede", verses: verses(8) },
  ],
});

async function makeUser(): Promise<string> {
  const email = `contentimport-${stamp}-${emails.length}@test.invalid`;
  emails.push(email);
  return (await L.db.user.create({ data: { email, passwordHash: "x", handle: `Ci${emails.length}${stamp.slice(-4)}`, discriminator: "31" } })).id;
}
const exerciseIds = async () => (await L.db.exercise.findMany({ where: { chapter: { book: { contentCollectionId: collectionId } } }, orderBy: [{ chapterId: "asc" }, { order: "asc" }], select: { id: true, status: true } }));
const optionIds = async () => (await L.db.questionOption.findMany({ where: { exercise: { chapter: { book: { contentCollectionId: collectionId } } } }, select: { id: true }, orderBy: { id: "asc" } })).map((o) => o.id);
const verseRows = async () => (await L.db.verse.findMany({ where: { chapter: { book: { contentCollectionId: collectionId } } }, orderBy: [{ chapterId: "asc" }, { number: "asc" }], select: { id: true, text: true } }));
const lessonIds = async () => (await L.db.courseLesson.findMany({ where: { course: { contentCollectionId: collectionId } }, orderBy: [{ courseId: "asc" }, { order: "asc" }], select: { id: true } })).map((l) => l.id);
const firstChapter = () => L.db.chapter.findFirstOrThrow({ where: { book: { contentCollectionId: collectionId }, number: 1 } });
const answersFor = (exercises: { id: string }[]) => exercises.map((e) => ({ exerciseId: e.id, given: ["onbekend"] }));

before(async () => {
  if (skip) return;
  L = await load();
  await L.db.contentWork.create({ data: { key: collectionId, kind: "OTHER" } });
  await L.db.contentCollection.create({ data: { id: collectionId, slug: collectionId, name: collectionId, icon: "book", work: collectionId, language: "nl", order: 904, enabled: true, visibleToUsers: true, publicationState: "PUBLISHED" } });
});

after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { email: { in: emails } } });
  await L.db.course.deleteMany({ where: { contentCollectionId: collectionId } });
  await L.db.book.deleteMany({ where: { contentCollectionId: collectionId } });
  await L.db.contentCollection.deleteMany({ where: { id: collectionId } });
  await L.db.contentWork.deleteMany({ where: { key: collectionId } });
  await L.db.podcastEpisode.deleteMany({ where: { number: { in: [9001, 9002] } } });
  await L.db.kidsStory.deleteMany({ where: { number: 9001 } });
  await L.db.introLesson.deleteMany({ where: { slug: `contentimport-${stamp}` } });
  await L.db.$disconnect();
});

test("een tweede identieke import wijzigt niets: geen verzen, geen oefeningen, geen opties, geen lessen", { skip }, async () => {
  const first = await L.importer.importBooks(L.db, [seedBook()], quiet, collectionId);
  assert.ok(first.exercises.created > 0 && first.verses.created === 20);
  const before = { verses: await verseRows(), exercises: await exerciseIds(), options: await optionIds(), lessons: await lessonIds() };
  assert.ok(before.lessons.length > 0, "de cursussen zijn gesynchroniseerd");

  const second = await L.importer.importBooks(L.db, [seedBook()], quiet, collectionId);
  assert.deepEqual(second.exercises, { kept: first.exercises.created, updated: 0, created: 0, retired: 0, deleted: 0 }, "geen enkele oefening geraakt");
  assert.deepEqual(second.verses, { created: 0, updated: 0, deleted: 0 }, "Schriftteksten ongewijzigd");
  assert.deepEqual(second.chapters, { created: 0, updated: 0 });
  assert.deepEqual({ verses: await verseRows(), exercises: await exerciseIds(), options: await optionIds(), lessons: await lessonIds() }, before, "dezelfde verzen, oefen-id's, antwoordopties en les-id's");
});

test("een uitgedeelde oefenset blijft na een herimport beantwoordbaar, en XP wordt precies één keer bijgeschreven", { skip }, async () => {
  const userId = await makeUser();
  const chapter = await firstChapter();
  const issued = await L.progress.issueExerciseSession(userId, chapter.id);
  assert.ok(issued.sessionId && issued.exercises.length > 0);

  await L.importer.importBooks(L.db, [seedBook()], quiet, collectionId); // de reload tijdens het leren
  const result = await L.progress.submitExerciseSession(userId, issued.sessionId!, answersFor(issued.exercises));
  assert.equal(result.results.length, issued.exercises.length, "de set is na de import gewoon af te ronden");
  await assert.rejects(() => L.progress.submitExerciseSession(userId, issued.sessionId!, answersFor(issued.exercises)), /ALREADY_SUBMITTED/, "opnieuw insturen geeft niets extra");

  const credits = await L.db.contentExerciseCredit.findMany({ where: { userId } });
  assert.equal(credits.length, issued.exercises.length);
  await L.importer.importBooks(L.db, [seedBook()], quiet, collectionId);
  assert.equal(await L.db.contentExerciseCredit.count({ where: { userId } }), credits.length, "de bijschrijvingen en antwoordgeschiedenis overleven de import");
  assert.equal(await L.db.exerciseAttempt.count({ where: { userId } }), issued.exercises.length);
});

test("de gebruiker rondt een cursus af terwijl er tegelijk geïmporteerd wordt", { skip }, async () => {
  const userId = await makeUser();
  const chapter = await firstChapter();
  const issued = await L.progress.issueExerciseSession(userId, chapter.id);
  const [imported, submitted] = await Promise.all([
    L.importer.importBooks(L.db, [seedBook()], quiet, collectionId),
    L.progress.submitExerciseSession(userId, issued.sessionId!, answersFor(issued.exercises)),
  ]);
  assert.equal(imported.exercises.created, 0);
  assert.equal(submitted.results.length, issued.exercises.length);
});

test("een inhoudelijk gewijzigde vraag wordt veilig geversioneerd: oude blijft voor wie haar kreeg, ongewijzigde behouden hun id", { skip }, async () => {
  const userId = await makeUser();
  const chapter = await firstChapter();
  const before = await L.db.exercise.findMany({ where: { chapterId: chapter.id }, include: { sourceVerse: { select: { number: true } } }, orderBy: { order: "asc" } });
  const totalBefore = (await exerciseIds()).filter((e) => e.status === "APPROVED").length;
  const aboutVerse1 = before.filter((e) => e.sourceVerse?.number === 1);
  assert.ok(aboutVerse1.length >= 1 && aboutVerse1.length < before.length);
  // De gebruiker heeft een set met één vraag over vers 1 gekregen.
  const sessionIssued = await L.db.exerciseSession.create({ data: { userId, chapterId: chapter.id, contentKey: `test:${collectionId}`, exerciseIds: JSON.stringify([aboutVerse1[0].id]) } });
  // Eerdere tests lieten gebruikers vragen beantwoorden: die vragen (en alleen die) moeten bewaard blijven.
  const usedIds = new Set([
    ...(await L.db.exerciseAttempt.findMany({ where: { exerciseId: { in: aboutVerse1.map((e) => e.id) } }, select: { exerciseId: true } })).map((r) => r.exerciseId),
    ...(await L.db.contentExerciseCredit.findMany({ where: { exerciseId: { in: aboutVerse1.map((e) => e.id) } }, select: { exerciseId: true } })).map((r) => r.exerciseId),
    aboutVerse1[0].id,
  ]);
  const expectedRetired = aboutVerse1.filter((e) => usedIds.has(e.id)).map((e) => e.id);
  const unusedOnes = aboutVerse1.filter((e) => !usedIds.has(e.id)).map((e) => e.id);

  // Vers 1 verandert inhoudelijk.
  const changed = await L.importer.importBooks(L.db, [seedBook({ index: 0, text: "Een geheel nieuwe tekst over een andere gebeurtenis waarbij het volk samenkwam in de tempel van de stad" })], quiet, collectionId);
  assert.equal(changed.verses.updated, 1);
  assert.equal(changed.exercises.retired, expectedRetired.length, "gebruikte vragen (ook de uitgedeelde) zijn buiten gebruik gesteld, niet gewist");
  assert.equal(changed.exercises.deleted, unusedOnes.length, "ongebruikte, gewijzigde vragen zijn veilig verwijderd");
  assert.ok(changed.exercises.created >= aboutVerse1.length);
  assert.equal(changed.exercises.kept, totalBefore - aboutVerse1.length, "alle vragen over andere verzen behouden hun id");
  assert.equal((await L.db.exercise.findUniqueOrThrow({ where: { id: aboutVerse1[0].id } })).status, "RETIRED");
  assert.equal(await L.db.exercise.count({ where: { id: { in: unusedOnes } } }), 0);
  assert.equal(await L.db.exercise.count({ where: { id: { in: expectedRetired }, status: "RETIRED" } }), expectedRetired.length, "de antwoordgeschiedenis blijft aan bestaande rijen hangen");

  // De oude vraag blijft onveranderlijk en kan door wie haar kreeg nog worden afgerond.
  const submitted = await L.progress.submitExerciseSession(userId, sessionIssued.id, [{ exerciseId: aboutVerse1[0].id, given: ["x"] }]);
  assert.equal(submitted.results.length, 1);
  assert.equal(await L.db.contentExerciseCredit.count({ where: { userId, exerciseId: aboutVerse1[0].id } }), 1);

  // Nieuwe sets bevatten nooit een buiten gebruik gestelde vraag.
  L.progress.clearExercisePlanCache();
  const next = await L.progress.issueExerciseSession(await makeUser(), chapter.id);
  assert.ok(next.exercises.length > 0 && next.exercises.every((e) => e.id !== aboutVerse1[0].id));
});

test("een mislukte import (bron niet bruikbaar) laat bestaande content en instellingen staan", { skip }, async () => {
  const before = { verses: await verseRows(), exercises: await exerciseIds(), collection: await L.db.contentCollection.findUniqueOrThrow({ where: { id: collectionId } }) };
  await assert.rejects(() => L.importer.importBooks(L.db, [seedBook()], quiet, `bestaat-niet-${stamp}`), /bestaat niet/);
  const after = { verses: await verseRows(), exercises: await exerciseIds(), collection: await L.db.contentCollection.findUniqueOrThrow({ where: { id: collectionId } }) };
  assert.deepEqual(after, before);
});

test("een import schakelt een vrijgegeven collectie nooit uit of verbergt haar: de Bijbel en de contentkeuze blijven zoals ingesteld", { skip }, async () => {
  const id = `content_old_testament_otb_nl`;
  // De echte OTB-collectie (aangemaakt door een migratie) of een testkopie met dezelfde id.
  const existing = await L.db.contentCollection.findUnique({ where: { id } });
  const original = existing ?? await L.db.contentCollection.create({ data: { id, slug: "old-testament-otb-nl", name: "Test OT", icon: "📖", order: 1000, work: "old-testament", editionKey: "otb", language: "nl", enabled: true, visibleToUsers: true, publicationState: "PUBLISHED" } });
  await L.db.contentCollection.update({ where: { id }, data: { visibleToUsers: true, enabled: true, publicationState: "PUBLISHED", name: "Aangepaste naam", order: 4242, icon: "📚" } });
  const userId = await makeUser();
  await L.db.user.update({ where: { id: userId }, data: { activeContentCollectionId: id, contentLanguage: "nl" } });

  const config = L.otbConfig.OTB_COLLECTIONS.find((c) => c.id === id)!;
  await L.otb.upsertOtbCollection(L.db, config, "https://example.test/bron", "CC0", "https://example.test/licentie");
  const after = await L.db.contentCollection.findUniqueOrThrow({ where: { id } });
  assert.equal(after.visibleToUsers, true, "zichtbaar voor gebruikers blijft aan");
  assert.equal(after.enabled, true);
  assert.equal(after.publicationState, "PUBLISHED");
  assert.deepEqual([after.name, after.order, after.icon], ["Aangepaste naam", 4242, "📚"], "beheerinstellingen zijn niet overschreven");
  assert.equal(after.sourceUrl, "https://example.test/bron", "alleen de bronvermelding is bijgewerkt");
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: userId } })).activeContentCollectionId, id, "de actieve contentkeuze blijft behouden");

  // En omgekeerd: een bewust verborgen collectie blijft verborgen.
  await L.db.contentCollection.update({ where: { id }, data: { visibleToUsers: false, enabled: false } });
  await L.otb.upsertOtbCollection(L.db, config, "https://example.test/bron", "CC0", "https://example.test/licentie");
  const hidden = await L.db.contentCollection.findUniqueOrThrow({ where: { id } });
  assert.deepEqual([hidden.visibleToUsers, hidden.enabled], [false, false]);
  if (!existing) await L.db.contentCollection.delete({ where: { id } }); else await L.db.contentCollection.update({ where: { id }, data: { visibleToUsers: original.visibleToUsers, enabled: original.enabled, publicationState: original.publicationState, name: original.name, order: original.order, icon: original.icon } });
});

test("twee gelijktijdige importaanvragen: één loopt, de ander wordt netjes geweigerd; daarna is de lock weer vrij", { skip }, async () => {
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const first = L.lock.withContentImportLock(async () => { await hold; return "klaar"; });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await assert.rejects(() => L.lock.withContentImportLock(async () => "niet bereikt"), L.lock.ContentImportBusyError);
  release();
  assert.equal(await first, "klaar");
  assert.equal(await L.lock.withContentImportLock(async () => "weer vrij"), "weer vrij");
});

test("podcast-, kinder- en introductieoefeningen behouden hun id's bij een herimport; een bestaande titel wordt niet door een plaatshouder vervangen", { skip }, async () => {
  const podcastId = L.podcasts.GJDO_PODCAST_ID;
  const episode = { number: 9001, title: "Aflevering 9001", summary: "Wordt bijgewerkt vanuit de podcastfeed.", listenUrl: "", content: [{ type: "TRUE_FALSE" as const, prompt: "Dit is een stelling.", answer: true }, { type: "MULTIPLE_CHOICE" as const, prompt: "Een vraag?", options: ["goed", "fout", "ook fout"], correctIndex: 0 }], bomConnection: [] };
  await L.podcast.importPodcastEpisodes(L.db, podcastId, [episode as never], quiet);
  const row = await L.db.podcastEpisode.findFirstOrThrow({ where: { podcastId, number: 9001 } });
  await L.db.podcastEpisode.update({ where: { id: row.id }, data: { title: "Echte titel uit de feed" } });
  const before = (await L.db.podcastExercise.findMany({ where: { episodeId: row.id }, orderBy: { order: "asc" }, select: { id: true } })).map((e) => e.id);
  const optionsBefore = await L.db.podcastExerciseOption.count({ where: { exercise: { episodeId: row.id } } });
  assert.ok(before.length === 2 && optionsBefore > 0);
  await L.podcast.importPodcastEpisodes(L.db, podcastId, [episode as never], quiet);
  assert.deepEqual((await L.db.podcastExercise.findMany({ where: { episodeId: row.id }, orderBy: { order: "asc" }, select: { id: true } })).map((e) => e.id), before);
  assert.equal(await L.db.podcastExerciseOption.count({ where: { exercise: { episodeId: row.id } } }), optionsBefore);
  assert.equal((await L.db.podcastEpisode.findUniqueOrThrow({ where: { id: row.id } })).title, "Echte titel uit de feed");

  const intro = { number: 9001, slug: `contentimport-${stamp}`, title: "Testles", summary: "s", blocks: [], exercises: [{ type: "MULTIPLE_CHOICE" as const, prompt: "Vraag?", answers: ["a"], options: [{ label: "a", isCorrect: true }, { label: "b", isCorrect: false }] }] };
  await L.intro.importIntroLessons(L.db, [intro as never], quiet);
  const lesson = await L.db.introLesson.findUniqueOrThrow({ where: { slug: intro.slug } });
  const introBefore = (await L.db.introExercise.findMany({ where: { lessonId: lesson.id }, select: { id: true } })).map((e) => e.id);
  await L.intro.importIntroLessons(L.db, [intro as never], quiet);
  assert.deepEqual((await L.db.introExercise.findMany({ where: { lessonId: lesson.id }, select: { id: true } })).map((e) => e.id), introBefore);
});

test("een buiten gebruik gestelde oefening blijft voor wie haar in een open set heeft bereikbaar voor check en hint, en voor niemand anders", { skip }, async () => {
  const access = await import("../src/lib/learning/exerciseAccess");
  const userId = await makeUser(); const other = await makeUser();
  const chapter = await firstChapter();
  const exercise = await L.db.exercise.findFirstOrThrow({ where: { chapterId: chapter.id, status: "APPROVED" } });
  await L.db.exerciseSession.create({ data: { userId, chapterId: chapter.id, contentKey: `test:${collectionId}`, exerciseIds: JSON.stringify([exercise.id]) } });
  await L.db.exercise.update({ where: { id: exercise.id }, data: { status: "RETIRED" } });
  assert.ok(await L.db.exercise.findFirst({ where: await access.exerciseAccessWhere(userId, exercise.id, {}) }), "wie de set heeft, ziet de oefening nog");
  assert.equal(await L.db.exercise.findFirst({ where: await access.exerciseAccessWhere(other, exercise.id, {}) }), null, "een ander ziet een buiten gebruik gestelde oefening niet");
  await L.db.exercise.update({ where: { id: exercise.id }, data: { status: "APPROVED" } });
});

test("een buiten gebruik gestelde oefening wordt nooit uitgedeeld, ook niet uit een verouderd plan in het geheugen", { skip }, async () => {
  const chapter = await firstChapter();
  L.progress.clearExercisePlanCache();
  const warm = await L.progress.issueExerciseSession(await makeUser(), chapter.id); // vult de plancache
  assert.ok(warm.exercises.length > 0);
  const victim = warm.exercises[0].id;
  await L.db.exercise.update({ where: { id: victim }, data: { status: "RETIRED" } });
  try {
    for (let i = 0; i < 15; i++) {
      const next = await L.progress.issueExerciseSession(await makeUser(), chapter.id);
      assert.ok(next.exercises.every((e) => e.id !== victim), "de verouderde cache deelt haar niet meer uit");
    }
  } finally { await L.db.exercise.update({ where: { id: victim }, data: { status: "APPROVED" } }); L.progress.clearExercisePlanCache(); }
});

test("een wegvallende lockverbinding laat het proces niet crashen", { skip }, async () => {
  const crashes: unknown[] = []; const trap = (error: unknown) => { crashes.push(error); }; process.on("uncaughtException", trap);
  try {
    const running = L.lock.withContentImportLock(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); return "klaar"; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await L.db.$executeRawUnsafe(`SELECT pg_terminate_backend(l.pid) FROM pg_locks l WHERE l.locktype = 'advisory' AND l.objid = 726540101 AND l.pid <> pg_backend_pid()`);
    // Het werk loopt door; de verbinding is weg maar dat is geen crash.
    await running.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(crashes, [], "geen uncaught exception");
    assert.equal(await L.lock.withContentImportLock(async () => "vrij"), "vrij", "de lock is daarna weer te nemen");
  } finally { process.off("uncaughtException", trap); }
});
