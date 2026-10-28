// Beheerflow "Schriftbronnen bijwerken" (docs/CONTENTBEHEER.md): controleren en voorbereiden schrijven niets, publiceren voert alleen
// het voorbereide plan uit, audio wordt alleen aangemerkt (nooit verwijderd) en beheerinstellingen van collecties blijven staan.
// Draait alleen met LEARNING_TEST_DATABASE_URL (een wegwerpdatabase).
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npx tsx --test tests/content-update.integration.test.ts
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  const check = await L.update.checkScriptures(L.db, { prepare: false, adminId: admin, log: quiet, sources, otb: null });
  assert.equal(check.status, "OK");
  assert.equal(check.planHash, null, "controleren geeft geen handtekening");
  assert.equal(check.upToDate, false);
  const prepare = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources, otb: null });
  assert.match(prepare.planHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(prepare.results[0].counts?.changedChapters, 1);
  assert.deepEqual(await snapshot(), before, "geen enkel vers of oefening is aangeraakt");
  assert.equal(await L.db.chapterAudioCheck.count({ where: { chapter: { book: { contentCollectionId: collectionId } }, status: "NEEDS_REVIEW" } }), 0, "een droogloop merkt geen audio aan");
});

test("een ongewijzigde bron is up-to-date en geeft een stabiele handtekening", { skip }, async () => {
  const a = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources: sourceWith(), otb: null });
  const b = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources: sourceWith(), otb: null });
  assert.equal(a.upToDate, true);
  assert.equal(a.planHash, b.planHash);
});

test("publiceren weigert een onbekende of verouderde handtekening", { skip }, async () => {
  await assert.rejects(L.update.publishScriptures(L.db, { planHash: "a".repeat(64), adminId: admin, log: quiet, sources: sourceWith(), otb: null }), (e: Error) => e.name === "PlanMismatchError" && (e as { reason?: string }).reason === "NO_PREPARED_PLAN");

  const changed = sourceWith({ index: 5, text: "Weer een andere tekst voor het zesde vers, die inhoudelijk afwijkt van de oorspronkelijke." });
  const prepared = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources: changed, otb: null });
  // De bron verandert nog een keer na het voorbereiden: het voorbereide plan klopt niet meer.
  const changedAgain = sourceWith({ index: 6, text: "Nog een andere tekst voor het zevende vers, die ook inhoudelijk afwijkt van de oorspronkelijke." });
  const before = await snapshot();
  await assert.rejects(L.update.publishScriptures(L.db, { planHash: prepared.planHash!, adminId: admin, log: quiet, sources: changedAgain, otb: null }), (e: Error) => (e as { reason?: string }).reason === "PLAN_CHANGED");
  assert.deepEqual(await snapshot(), before, "bij een afgewezen publicatie is niets geschreven");
  const run = await L.db.contentUpdateRun.findFirstOrThrow({ where: { kind: "SCRIPTURE_PUBLISH", createdById: admin }, orderBy: { startedAt: "desc" } });
  assert.equal(run.status, "FAILED");
});

test("publiceren voert het voorbereide plan uit, markeert alleen het gewijzigde hoofdstuk en laat audio en beheerinstellingen staan", { skip }, async () => {
  const text = "Een gewijzigde tekst voor vers vier van het eerste hoofdstuk, ruim lang genoeg om anders te zijn.";
  const sources = sourceWith({ index: 3, text });
  const prepared = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources, otb: null });
  const outcome = await L.update.publishScriptures(L.db, { planHash: prepared.planHash!, adminId: admin, log: quiet, sources, otb: null });
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
  const again = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources, otb: null });
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
    await assert.rejects(L.update.checkScriptures(L.db, { prepare: false, adminId: admin, log: quiet, sources: sourceWith(), otb: null }), (e: Error) => e.name === "ContentImportBusyError");
    const run = await L.db.contentUpdateRun.findFirstOrThrow({ where: { kind: "SCRIPTURE_CHECK", createdById: admin }, orderBy: { startedAt: "desc" } });
    assert.equal(run.status, "FAILED");
  } finally {
    await holder.query("SELECT pg_advisory_unlock(726540101)").catch(() => undefined);
    await holder.end();
  }
});

// ---- Contentgebonden handtekening, OTB in de Schriftflow en gescheiden normale update ----

test("de handtekening is inhoudsgebonden: dezelfde aantallen maar andere broninhoud maakt het plan ongeldig", { skip }, async () => {
  const textA = "Variant A van vers negen, met precies evenveel wijzigingen als variant B maar met andere woorden erin.";
  const textB = "Variant B van vers negen, met precies evenveel wijzigingen als variant A maar met andere woorden erin.";
  const prepared = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources: sourceWith({ index: 8, text: textA }), otb: null });
  const other = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources: sourceWith({ index: 8, text: textB }), otb: null });
  assert.deepEqual(prepared.results[0].counts, other.results[0].counts, "de tellingen zijn gelijk");
  assert.notEqual(prepared.planHash, other.planHash, "de handtekening verschilt toch");
  const before = await snapshot();
  await assert.rejects(L.update.publishScriptures(L.db, { planHash: prepared.planHash!, adminId: admin, log: quiet, sources: sourceWith({ index: 8, text: textB }), otb: null }), (e: Error) => (e as { reason?: string }).reason === "PLAN_CHANGED");
  assert.deepEqual(await snapshot(), before);
});

test("de handtekening is gebonden aan de databasestand: een wijziging buiten de tekstvergelijking maakt het plan ongeldig", { skip }, async () => {
  const sources = sourceWith({ index: 9, text: "Weer een nieuwe tekst voor vers tien, lang genoeg om als inhoudelijke wijziging te tellen." });
  const prepared = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources, otb: null });
  const verse = await L.db.verse.findFirstOrThrow({ where: { chapter: { book: { contentCollectionId: collectionId }, number: 2 }, number: 1 } });
  const original = verse.audioStart;
  await L.db.verse.update({ where: { id: verse.id }, data: { audioStart: (original ?? 0) + 0.5 } });
  try {
    await assert.rejects(L.update.publishScriptures(L.db, { planHash: prepared.planHash!, adminId: admin, log: quiet, sources, otb: null }), (e: Error) => (e as { reason?: string }).reason === "PLAN_CHANGED");
  } finally {
    await L.db.verse.update({ where: { id: verse.id }, data: { audioStart: original } });
  }
});

// Een volledige, synthetische OTB-bron (alle 5 locales, 66 boeken, 1 hoofdstuk, 1 vers) met de gepinde commit als marker.
async function makeOtbFixture(verseText: (locale: string, book: number) => string): Promise<string> {
  const lock = JSON.parse(await readFile("scripts/otb/source-lock.json", "utf8")) as { upstreamCommit: string };
  const root = await mkdtemp(join(tmpdir(), "otb-fixture-"));
  await writeFile(join(root, ".otb-upstream-commit"), `${lock.upstreamCommit}\n`);
  const { OTB_BOOKS, OTB_LOCALES } = await import("../scripts/otb/bookMapping");
  for (const locale of OTB_LOCALES) {
    for (const [number, key] of OTB_BOOKS) {
      const jsonRoot = join(root, "lang", locale, `${String(number).padStart(2, "0")}.${key}`, "json");
      await mkdir(jsonRoot, { recursive: true });
      await writeFile(join(jsonRoot, `${key}-01.json`), JSON.stringify({ book: key, chapter: 1, verses: [{ verse: 1, text: [verseText(locale, number)] }] }));
    }
  }
  return root;
}
const otbBookCount = () => L.db.book.count({ where: { slug: { contains: "-otb-" } } });

test("de OTB-bijbel zit in de Schriftcontrole: droogloop schrijft niets, bron wordt alleen bij voorbereiden gedownload", { skip }, async () => {
  if ((await otbBookCount()) > 0) return; // alleen in een wegwerpdatabase zonder Bijbel
  const root = await makeOtbFixture((locale, book) => `Tekst ${locale} ${book} versie een`);
  const calls: boolean[] = [];
  const provider = { resolve: async (download: boolean) => { calls.push(download); return root; } };
  try {
    const sources: never[] = [];
    const check = await L.update.checkScriptures(L.db, { prepare: false, adminId: admin, log: quiet, sources, otb: provider });
    const otb = check.results.find((r) => r.key === "otb")!;
    assert.equal(otb.status, "ok");
    assert.equal(otb.counts?.chaptersCreated, 330, "5 locales x 66 boeken zijn nieuw");
    assert.equal(await otbBookCount(), 0, "controleren schrijft niets");
    await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources, otb: provider });
    assert.deepEqual(calls, [false, true], "alleen voorbereiden mag downloaden");
    // Zonder voorbereide bron meldt de controle dat eerlijk, zonder te downloaden.
    const missing = await L.update.checkScriptures(L.db, { prepare: false, adminId: admin, log: quiet, sources, otb: { resolve: async () => null } });
    assert.deepEqual([missing.results[0].status, missing.results[0].message], ["skipped", "otbNotPrepared"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("een verandering in de OTB-bron maakt een voorbereide publicatie ongeldig, en publiceren schrijft de Bijbel en behoudt de beheerinstellingen", { skip }, async () => {
  if ((await otbBookCount()) > 0) return;
  const v1 = await makeOtbFixture((locale, book) => `Tekst ${locale} ${book} versie een`);
  const v2 = await makeOtbFixture((locale, book) => `Tekst ${locale} ${book} versie twee`);
  const sources: never[] = [];
  const ids = (await import("../scripts/otb/trialConfig")).OTB_COLLECTIONS.map((c) => c.id);
  const settingsBefore = await L.db.contentCollection.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, enabled: true, visibleToUsers: true, publicationState: true, name: true, order: true } });
  try {
    const prepared = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources, otb: { resolve: async () => v1 } });
    await assert.rejects(L.update.publishScriptures(L.db, { planHash: prepared.planHash!, adminId: admin, log: quiet, sources, otb: { resolve: async () => v2 } }), (e: Error) => (e as { reason?: string }).reason === "PLAN_CHANGED");
    assert.equal(await otbBookCount(), 0);
    const outcome = await L.update.publishScriptures(L.db, { planHash: prepared.planHash!, adminId: admin, log: quiet, sources, otb: { resolve: async () => v1 } });
    assert.equal(outcome.status, "OK");
    assert.equal(await otbBookCount(), 330);
    const settingsAfter = await L.db.contentCollection.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, enabled: true, visibleToUsers: true, publicationState: true, name: true, order: true } });
    assert.deepEqual(settingsAfter.filter((c) => settingsBefore.some((b) => b.id === c.id)), settingsBefore, "bestaande beheerinstellingen blijven staan");
    const again = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, log: quiet, sources, otb: { resolve: async () => v1 } });
    assert.equal(again.upToDate, true, "een tweede identieke update heeft niets te doen");
  } finally {
    await L.db.book.deleteMany({ where: { slug: { contains: "-otb-" } } });
    const created = ids.filter((id) => !settingsBefore.some((b) => b.id === id));
    await L.db.contentCollection.deleteMany({ where: { id: { in: created } } });
    await rm(v1, { recursive: true, force: true });
    await rm(v2, { recursive: true, force: true });
  }
});

test("een normale contentupdate raakt OTB en audiospiegeling niet: beide staan alleen in het Schriftpad van runSeed", { skip }, async () => {
  const lines = (await readFile("src/lib/seed.ts", "utf8")).split("\n");
  for (const needle of ["preparePinnedOtbSource(log)", "mirrorChapterAudio(client, log)"]) {
    const at = lines.findIndex((line) => line.includes(needle));
    assert.ok(at > 0, `${needle} staat in seed.ts`);
    let opener = at;
    while (opener > 0 && !(lines[opener].trim() !== "" && lines[opener].search(/\S/) <= 2)) opener--;
    assert.equal(lines[opener].trim(), "if (scriptures) {", `${needle} hoort binnen if (scriptures)`);
  }
  const job = await readFile("src/lib/reseedJob.ts", "utf8");
  assert.match(job, /\{ scriptures: false \}/, "de beheerkaart Nieuwe content ophalen draait zonder Schriften");
});

test("een door een herstart onderbroken run blijft niet eeuwig bezig", { skip }, async () => {
  const stale = await L.db.contentUpdateRun.create({ data: { kind: "SCRIPTURE_PUBLISH", createdById: admin, startedAt: new Date(Date.now() - 60_000) } });
  assert.ok((await L.update.markInterruptedRuns(L.db)) >= 1);
  const row = await L.db.contentUpdateRun.findUniqueOrThrow({ where: { id: stale.id } });
  assert.deepEqual([row.status, row.error], ["FAILED", "INTERRUPTED"]);
});


test("een actieve logrij op een ander Node-proces blijft bezig; procesuitval maakt herstel en retry mogelijk", { skip, timeout: 30_000 }, async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { prisma } from './src/lib/db.ts';
    import { withContentUpdateRun } from './src/lib/contentUpdateRun.ts';
    await withContentUpdateRun(prisma, { kind: 'SCRIPTURE_PREPARE', createdById: ${JSON.stringify(admin)} }, async (run) => {
      await prisma.contentUpdateRun.update({ where: { id: run.id }, data: { startedAt: new Date(Date.now() - 60_000) } });
      process.send({ id: run.id });
      await new Promise(() => {});
    });
  `], { env: process.env, stdio: ["ignore", "ignore", "inherit", "ipc"] });
  let runId: string | undefined;
  try {
    const [message] = await once(child, "message");
    runId = (message as { id: string }).id;
    await L.update.markInterruptedRuns(L.db);
    assert.equal((await L.db.contentUpdateRun.findUniqueOrThrow({ where: { id: runId } })).status, "RUNNING", "bronvoorbereiding is ook zonder de algemene importlock actief");
  } finally {
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
  }
  // PostgreSQL verwerkt het verbreken van de eigenaarsverbinding asynchroon.
  for (let i = 0; i < 50; i++) {
    await L.update.markInterruptedRuns(L.db);
    if ((await L.db.contentUpdateRun.findUniqueOrThrow({ where: { id: runId } })).status === "FAILED") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const abandoned = await L.db.contentUpdateRun.findUniqueOrThrow({ where: { id: runId } });
  assert.deepEqual([abandoned.status, abandoned.error], ["FAILED", "INTERRUPTED"]);
  const retried = await L.update.checkScriptures(L.db, { prepare: true, adminId: admin, sources: sourceWith(), otb: null });
  assert.equal(retried.status, "OK");
  assert.notEqual(retried.runId, runId);
  assert.equal((await L.db.contentUpdateRun.findUniqueOrThrow({ where: { id: runId } })).status, "FAILED", "retry wist het eerdere auditspoor niet");
});

test("een onschrijfbaar beheerlogboek blokkeert de import voordat contentwerk start", { skip }, async () => {
  const { withContentUpdateRun } = await import("../src/lib/contentUpdateRun");
  let executed = false;
  await L.db.$executeRawUnsafe(`CREATE FUNCTION content_log_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."createdById" = 'log-failure-test' THEN RAISE EXCEPTION 'synthetische logboekfout'; END IF; RETURN NEW; END $$`);
  await L.db.$executeRawUnsafe(`CREATE TRIGGER content_log_test_failure BEFORE INSERT ON "ContentUpdateRun" FOR EACH ROW EXECUTE FUNCTION content_log_test_failure()`);
  const before = await snapshot();
  try {
    await assert.rejects(withContentUpdateRun(L.db, { kind: "CONTENT_UPDATE", createdById: "log-failure-test" }, async () => { executed = true; }), /synthetische logboekfout/);
    assert.equal(executed, false);
    assert.deepEqual(await snapshot(), before);
  } finally {
    await L.db.$executeRawUnsafe(`DROP TRIGGER content_log_test_failure ON "ContentUpdateRun"`);
    await L.db.$executeRawUnsafe(`DROP FUNCTION content_log_test_failure()`);
  }
});
