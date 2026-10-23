// Beheerflow "Schriftbronnen bijwerken" (docs/CONTENTBEHEER.md): controleren en voorbereiden schrijven niets, publiceren voert alleen
// het voorbereide plan uit, audio wordt alleen aangemerkt (nooit verwijderd) en beheerinstellingen van collecties blijven staan.
// Draait alleen met LEARNING_TEST_DATABASE_URL (een wegwerpdatabase).
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npx tsx --test tests/content-update.integration.test.ts
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "testsleutel-voor-contentupdate-0123456789";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  update: await import("../src/lib/contentUpdate"),
  lock: await import("../src/lib/contentImportLock"),
  audio: await import("../src/lib/audioCheck"),
  importer: await import("../prisma/importContent"),
});
let L: Awaited<ReturnType<typeof load>>;

const stamp = `${Date.now()}`;
const collectionId = `contentupdate-${stamp}`;
const quiet = () => {};
const sentence = (n: number) => `In de dagen van de profeet nummer ${n} kwam het volk samen om te bidden voor vrede en om dankbaar te zijn voor de zegeningen van de Heer`;
const verses = (count: number, change?: { index: number; text: string }) =>
  Array.from({ length: count }, (_, i) => (change && change.index === i ? change.text : sentence(i + 1)));
const books = (change?: { index: number; text: string }) => [
  { slug: `${collectionId}-boek`, name: "Testboek", chapters: [{ number: 1, heading: "Eerste", verses: verses(12, change) }, { number: 2, heading: "Tweede", verses: verses(8) }] },
];
const sourceWith = (change?: { index: number; text: string }) => [
  {
    id: collectionId,
    label: "Testbron",
    books: books(change),
    audio: [
      { book: `${collectionId}-boek`, chapter: 1, url: "https://example.invalid/1.mp3", headingStart: 0, headingEnd: 1, verseStarts: Array.from({ length: 12 }, (_, i) => 2 + i) },
      { book: `${collectionId}-boek`, chapter: 2, url: "https://example.invalid/2.mp3", headingStart: 0, headingEnd: 1, verseStarts: Array.from({ length: 8 }, (_, i) => 2 + i) },
    ],
  },
];
const snapshot = async () => ({
  verses: await L.db.verse.findMany({ where: { chapter: { book: { contentCollectionId: collectionId } } }, orderBy: [{ chapterId: "asc" }, { number: "asc" }], select: { id: true, text: true } }),
  exercises: await L.db.exercise.findMany({ where: { chapter: { book: { contentCollectionId: collectionId } } }, orderBy: { id: "asc" }, select: { id: true, status: true } }),
});

before(async () => {
  if (skip) return;
  L = await load();
  await L.db.contentWork.create({ data: { key: collectionId, kind: "OTHER" } });
  await L.db.contentCollection.create({ data: { id: collectionId, slug: collectionId, name: collectionId, icon: "book", work: collectionId, language: "nl", order: 905, enabled: true, visibleToUsers: false, publicationState: "PUBLISHED" } });
  // Beginstand: de bron staat er al, met audio.
  await L.importer.importBooks(L.db, books(), quiet, collectionId, { syncCourses: false });
  const { importChapterAudio } = await import("../prisma/importAudio");
  await importChapterAudio(L.db, sourceWith()[0].audio, collectionId, quiet);
});

after(async () => {
  if (skip) return;
  await L.db.contentUpdateRun.deleteMany({ where: { createdById: `test-${stamp}` } });
  await L.db.course.deleteMany({ where: { contentCollectionId: collectionId } });
  await L.db.book.deleteMany({ where: { contentCollectionId: collectionId } });
  await L.db.contentCollection.deleteMany({ where: { id: collectionId } });
  await L.db.contentWork.deleteMany({ where: { key: collectionId } });
  await L.db.$disconnect();
});

const admin = `test-${stamp}`;

test("controleren en voorbereiden schrijven niets naar de content en melden de wijziging", { skip }, async () => {
  const before = await snapshot();
  const sources = sourceWith({ index: 2, text: "Een volledig andere tekst voor vers drie van het eerste hoofdstuk, ruim lang genoeg." });
  const check = await L.update.checkScriptures(L.db, { prepare: false, adminId: admin, log: quiet, sources });
  assert.equal(check.status, "OK");
  assert.equal(check.planHash, null, "controleren geeft geen handtekening");
  assert.equal(check.upToDate, false);
  const prepare = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources });
  assert.match(prepare.planHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(prepare.results[0].counts?.changedChapters, 1);
  assert.deepEqual(await snapshot(), before, "geen enkel vers of oefening is aangeraakt");
  assert.equal(await L.db.chapterAudioCheck.count({ where: { chapter: { book: { contentCollectionId: collectionId } }, status: "NEEDS_REVIEW" } }), 0, "een droogloop merkt geen audio aan");
});

test("een ongewijzigde bron is up-to-date en geeft een stabiele handtekening", { skip }, async () => {
  const a = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources: sourceWith() });
  const b = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources: sourceWith() });
  assert.equal(a.upToDate, true);
  assert.equal(a.planHash, b.planHash);
});

test("publiceren weigert een onbekende of verouderde handtekening", { skip }, async () => {
  await assert.rejects(L.update.publishScriptures(L.db, { planHash: "a".repeat(64), adminId: admin, log: quiet, sources: sourceWith() }), (e: Error) => e.name === "PlanMismatchError" && (e as { reason?: string }).reason === "NO_PREPARED_PLAN");

  const changed = sourceWith({ index: 5, text: "Weer een andere tekst voor het zesde vers, die inhoudelijk afwijkt van de oorspronkelijke." });
  const prepared = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources: changed });
  // De bron verandert nog een keer na het voorbereiden: het voorbereide plan klopt niet meer.
  const changedAgain = sourceWith({ index: 6, text: "Nog een andere tekst voor het zevende vers, die ook inhoudelijk afwijkt van de oorspronkelijke." });
  const before = await snapshot();
  await assert.rejects(L.update.publishScriptures(L.db, { planHash: prepared.planHash!, adminId: admin, log: quiet, sources: changedAgain }), (e: Error) => (e as { reason?: string }).reason === "PLAN_CHANGED");
  assert.deepEqual(await snapshot(), before, "bij een afgewezen publicatie is niets geschreven");
  const run = await L.db.contentUpdateRun.findFirstOrThrow({ where: { kind: "SCRIPTURE_PUBLISH", createdById: admin }, orderBy: { startedAt: "desc" } });
  assert.equal(run.status, "FAILED");
});

test("publiceren voert het voorbereide plan uit, markeert alleen het gewijzigde hoofdstuk en laat audio en beheerinstellingen staan", { skip }, async () => {
  const text = "Een gewijzigde tekst voor vers vier van het eerste hoofdstuk, ruim lang genoeg om anders te zijn.";
  const sources = sourceWith({ index: 3, text });
  const prepared = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources });
  const outcome = await L.update.publishScriptures(L.db, { planHash: prepared.planHash!, adminId: admin, log: quiet, sources });
  assert.equal(outcome.status, "OK");
  const chapters = await L.db.chapter.findMany({ where: { book: { contentCollectionId: collectionId } }, orderBy: { number: "asc" }, select: { number: true, audioUrl: true, audioCheck: { select: { status: true } }, verses: { orderBy: { number: "asc" }, select: { text: true, audioStart: true } } } });
  assert.equal(chapters[0].verses[3].text, text);
  assert.equal(chapters[0].audioCheck?.status, "NEEDS_REVIEW");
  assert.ok(chapters[0].audioUrl, "de audio wordt nooit verwijderd");
  assert.ok(chapters[0].verses.every((v) => v.audioStart !== null), "ook de tijdcodes blijven staan");
  assert.notEqual(chapters[1].audioCheck?.status, "NEEDS_REVIEW", "een ongewijzigd hoofdstuk wordt niet aangemerkt");
  const collection = await L.db.contentCollection.findUniqueOrThrow({ where: { id: collectionId } });
  assert.deepEqual([collection.enabled, collection.visibleToUsers, collection.publicationState, collection.order, collection.name], [true, false, "PUBLISHED", 905, collectionId]);

  // Een tweede, identieke update heeft niets meer te doen.
  const again = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources });
  assert.equal(again.upToDate, true);
});

test("een beheerder bevestigt audio pas expliciet, daarna is het hoofdstuk weer in orde", { skip }, async () => {
  const chapter = await L.db.chapter.findFirstOrThrow({ where: { book: { contentCollectionId: collectionId }, number: 1 } });
  assert.equal((await L.db.chapterAudioCheck.findUniqueOrThrow({ where: { chapterId: chapter.id } })).status, "NEEDS_REVIEW");
  await L.audio.markAudioCurrent(L.db, chapter.id, admin);
  const row = await L.db.chapterAudioCheck.findUniqueOrThrow({ where: { chapterId: chapter.id } });
  assert.equal(row.status, "CURRENT");
  assert.equal(row.reviewedById, admin);
});

test("een lopende import blokkeert een controle netjes en legt de mislukte run vast", { skip }, async () => {
  const holder = new Client({ connectionString: url });
  await holder.connect();
  try {
    await holder.query("SELECT pg_advisory_lock(726540101)");
    await assert.rejects(L.update.checkScriptures(L.db, { prepare: false, adminId: admin, log: quiet, sources: sourceWith() }), (e: Error) => e.name === "ContentImportBusyError");
    const run = await L.db.contentUpdateRun.findFirstOrThrow({ where: { kind: "SCRIPTURE_CHECK", createdById: admin }, orderBy: { startedAt: "desc" } });
    assert.equal(run.status, "FAILED");
  } finally {
    await holder.query("SELECT pg_advisory_unlock(726540101)").catch(() => undefined);
    await holder.end();
  }
});
