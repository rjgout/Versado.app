import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pg from "pg";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { issueNativeSession } from "../src/lib/native/sessions.ts";
import { OTB_COLLECTIONS } from "../scripts/otb/trialConfig.ts";
import { otbCollectionName } from "../scripts/otb/collectionNames.ts";
import { importOtbFull } from "../scripts/otb/import-core.ts";
import { CONTENT_IMPORT_LOCK_KEY } from "../src/lib/contentImportLock.ts";
import { assertReferenceTestEnvironment, referenceAccount } from "./fixtures/reference-content.mjs";
const base = assertReferenceTestEnvironment(), endpoint = "/api/admin/content-switcher/publication";
const ids = OTB_COLLECTIONS.map(item => item.id);
let admin, second, ordinary, pair;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
async function call(path = endpoint, { account = admin, method = "GET", body, origin = base, cookie = true } = {}) {
  return fetch(base + path, { method, headers: { ...(cookie ? { Cookie: account.cookie } : {}), Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function state() { const r = await call(); assert.equal(r.status, 200); return (await r.json()).editions; }
async function request(selected) {
  const entries = await state();
  return { actionId: randomUUID(), confirmation: "PUBLICEREN", editions: selected.map(id => { const item = entries.find(e => e.id === id); assert.ok(item.canPublish, JSON.stringify(item)); return { id, releaseToken: item.releaseToken }; }) };
}
async function post(body, options = {}) { return call(endpoint, { method: "POST", body, ...options }); }
async function native(body) {
  return fetch(base + "/api/v1/native/content-context", { method: body ? "POST" : "GET", headers: { Origin: "capacitor://localhost", "X-Versado-Client": "native-v1", Authorization: `Bearer ${pair.accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
}
async function nativeState() { const r = await native(); assert.equal(r.status, 200, await r.clone().text()); return r.json(); }
const published = () => prisma.contentCollection.count({ where: { id: { in: ids }, publicationState: "PUBLISHED" } });
const fingerprint = async () => {
  const tables = ["Book", "Chapter", "Verse", "Course", "CourseChapter", "CourseLesson", "CourseLessonExercise", "UserCourseProgress", "UserCourseLessonProgress", "Exercise", "ContentExerciseCredit", "ExerciseSession", "ContentProgress", "ChapterProgress", "ReadingSession", "Bookmark", "Highlight", "Note", "AudioPackage", "AudioRecording", "AudioPublication", "ChapterAudioCheck", "OfficialAudioTask"];
  const out = {};
  for (const table of tables) {
    assert.ok((await db.query("SELECT to_regclass($1) AS found", [`\"${table}\"`])).rows[0].found, table);
    out[table] = (await db.query(`SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text),'')) AS hash FROM "${table}" t`)).rows[0].hash;
  }
  return out;
};

test("OTB-publicatie via echte handlers, gepinde tekst, bestaande web/nativecatalogus en onveranderde gegevens", async t => {
  await db.connect();
  try {
    admin = await referenceAccount(true); second = await referenceAccount(true); ordinary = await referenceAccount();
    await prisma.user.update({ where: { id: ordinary.user.id }, data: { emailVerifiedAt: new Date(), onboardingSeenAt: new Date(), activeContentCollectionId: "content_bom" } });
    await prisma.contentSwitcherSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", enabled: true }, update: { enabled: true } });
    pair = await issueNativeSession(ordinary.user.id, ordinary.user.sessionVersion);
    for (const key of ["old-testament", "new-testament"]) await prisma.contentWork.upsert({ where: { key }, create: { key, kind: "SCRIPTURE" }, update: {} });
    // De migratieproeven gebruiken dezelfde vaste OTB-IDs met onvolledige synthetische boeken.
    // Bewaar die rijen en voortgang in eigen verborgen fixturecollecties vóór de echte bronproef.
    await prisma.contentWork.create({ data: { key: "scripture-publication-historical-fixture", kind: "OTHER" } });
    for (const id of ids) {
      const old = await prisma.contentCollection.findUnique({ where: { id } });
      if (!old) continue;
      const retained = await prisma.contentCollection.create({ data: { ...old, id: `historical-test-${id}`, slug: `historical-test-${old.slug}`, work: "scripture-publication-historical-fixture", editionKey: old.work, enabled: false, visibleToUsers: false, publicationState: "DRAFT" } });
      await prisma.book.updateMany({ where: { contentCollectionId: id }, data: { contentCollectionId: retained.id } });
      await prisma.course.updateMany({ where: { contentCollectionId: id }, data: { contentCollectionId: retained.id } });
    }
    const source = process.env.OTB_PUBLICATION_TEST_SOURCE;
    assert.ok(source, "Geef de gepinde testbron; nooit synthetisch bewijs toelaten in de productievalidator");
    // Dezelfde parser en importer als beheer. Uitsluitend in deze gecontroleerde wegwerpdatabase.
    const imported = await importOtbFull(prisma, source, () => {});
    assert.equal(imported.changes.length, 10);
    await prisma.contentCollection.updateMany({ where: { id: { in: ids } }, data: { enabled: true, visibleToUsers: true, publicationState: "DRAFT" } });
    for (const config of OTB_COLLECTIONS) await prisma.contentCollection.update({ where: { id: config.id }, data: { name: otbCollectionName(config.work, config.language) } });
    const anchor = await prisma.chapter.findFirstOrThrow({ where: { book: { contentCollectionId: ids[9] } }, include: { book: true, verses: { orderBy: { number: "asc" }, take: 1 } } });
    await prisma.chapter.update({ where: { id: anchor.id }, data: { audioUrl: "https://audio-fixture.invalid/retained.mp3", audioHeadingStart: 1, audioHeadingEnd: 2 } });
    await prisma.verse.update({ where: { id: anchor.verses[0].id }, data: { audioStart: 3 } });
    await prisma.contentProgress.create({ data: { userId: ordinary.user.id, contentKey: `${anchor.book.key}#${anchor.number}`, lastChapterId: anchor.id, readStatus: "READING", readVerse: 2, baseXpEarned: 7 } });
    await prisma.note.create({ data: { userId: ordinary.user.id, verseId: anchor.verses[0].id, text: "Privénotitie in geïsoleerde OTB-test" } });
    const baseline = await fingerprint();
    const userBefore = await prisma.user.findUniqueOrThrow({ where: { id: ordinary.user.id } });
    await t.test("volledige broncontrole via echte backendhandlers: vijf verse, uitsluitend lezende metingen", async () => {
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now(), entries = await state();
        samples.push(Math.round(performance.now() - start));
        assert.equal(entries.length, 10); assert.ok(entries.every(item => item.verified && item.canPublish));
      }
      const sorted = [...samples].sort((a,b) => a-b);
      const plan = (await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(DISTINCT b.id)::int AS books, count(DISTINCT c.id)::int AS chapters, count(v.id)::int AS verses FROM "Book" b LEFT JOIN "Chapter" c ON c."bookId"=b.id LEFT JOIN "Verse" v ON v."chapterId"=c.id WHERE b."contentCollectionId"=$1`, [ids[0]])).rows[0]["QUERY PLAN"][0];
      const indexes = [];
      function inspect(node) { if (node["Index Name"]) indexes.push(node["Index Name"]); for (const child of node.Plans ?? []) inspect(child); }
      inspect(plan.Plan);
      console.log(JSON.stringify({publicationPreflight: {samplesMs:samples,medianMs:sorted[2],maxMs:sorted[4],editions:10,verses:155515,realHandlers:true,isolatedDatabase:true,productionMeasured:false,countQueryExecutionMs:plan["Execution Time"],indexes}}));
      assert.deepEqual(await fingerprint(), baseline, "Volledige broncontrole schrijft geen inhoud of voortgang");
      assert.equal(await published(), 0);
    });
    await t.test("geen publicatie door zichtbaarheid; tien gecontroleerde concepten zijn niet leesbaar", async () => {
      const entries = await state(); assert.equal(entries.length, 10); assert.equal(entries.filter(e => ids.includes(e.id) && e.canPublish).length, 10);
      assert.equal(await published(), 0);
      assert.equal((await call(`/api/chapters/${anchor.id}`, { account: ordinary })).status, 404);
      assert.equal((await call(`/api/chapters/${anchor.id}`, { cookie: false })).status, 401);
      const response = await call("/api/admin/content-switcher", { method: "PUT", body: { contentCollectionId: ids[0], visibleToUsers: true } }); assert.equal(response.status, 200);
      assert.equal(await published(), 0);
      const s = await nativeState(); assert.equal(s.picker.works.some(w => ["old-testament", "new-testament"].includes(w.key)), false);
    });
    await t.test("authenticatie, adminrechten, Origin, selectie, bevestiging en payload worden gecontroleerd", async () => {
      const body = await request([ids[0]]);
      assert.equal((await call(endpoint, { cookie: false })).status, 401);
      assert.equal((await call(endpoint, { account: ordinary })).status, 403);
      assert.equal((await post(body, { cookie: false })).status, 401);
      assert.equal((await post(body, { account: ordinary })).status, 403);
      assert.equal((await post(body, { origin: "https://evil.invalid" })).status, 403);
      for (const bad of [{ ...body, isAdmin: true }, { ...body, confirmation: "ja" }, { ...body, editions: [] }, { ...body, editions: [...body.editions, ...body.editions] }, { ...body, editions: [{ id: ids[0], releaseToken: "x" }] }, { ...body, huge: "x".repeat(17_000) }]) assert.equal((await post(bad)).status, 400);
      assert.equal((await post({ ...body, editions: [{ id: "content_bom", releaseToken: "0".repeat(64) }] })).status, 422);
      assert.equal((await post({ ...body, editions: [{ id: "missing", releaseToken: "0".repeat(64) }] })).status, 400);
      assert.equal(await published(), 0);
    });
    await t.test("onvolledige, gewijzigde en verkeerd geïdentificeerde bron blokkeert de gehele bulkselectie", async () => {
      const id = ids[0], good = ids[1], body = await request([id, good]);
      const verse = await prisma.verse.findFirstOrThrow({ where: { chapter: { book: { contentCollectionId: id } } } });
      await prisma.verse.delete({ where: { id: verse.id } });
      assert.equal((await post(body)).status, 422); assert.equal(await published(), 0);
      await prisma.verse.create({ data: verse });
      await prisma.verse.update({ where: { id: verse.id }, data: { text: verse.text + " changed" } });
      assert.equal((await post(body)).status, 422); assert.ok((await state()).find(e => e.id === id).reasons.includes("text"));
      await prisma.verse.update({ where: { id: verse.id }, data: { text: verse.text } });
      await prisma.chapter.update({ where: { id: verse.chapterId }, data: { heading: "Ongecontroleerde extra hoofdstukkop" } });
      assert.equal((await post(body)).status, 422);
      await prisma.chapter.update({ where: { id: verse.chapterId }, data: { heading: null } });
      const collection = await prisma.contentCollection.findUniqueOrThrow({ where: { id } });
      for (const patch of [{ sourceUrl: "https://example.invalid" }, { licenseName: "unknown" }, { work: "bofm" }, { language: "xx" }, { editionKey: "changed" }]) {
        await prisma.contentCollection.update({ where: { id }, data: patch });
        assert.equal((await post(body)).status, 422); assert.equal(await published(), 0);
        await prisma.contentCollection.update({ where: { id }, data: Object.fromEntries(Object.keys(patch).map(k => [k, collection[k]])) });
      }
    });
    await t.test("verkeerd ContentWork-type en auditfout kunnen geen gedeeltelijke publicatie veroorzaken", async () => {
      const body = await request(ids.slice(0, 2));
      await prisma.contentWork.update({ where: { key: "old-testament" }, data: { kind: "OTHER" } });
      try { assert.equal((await post(body)).status, 422); assert.equal(await published(), 0); }
      finally { await prisma.contentWork.update({ where: { key: "old-testament" }, data: { kind: "SCRIPTURE" } }); }
      await db.query(`CREATE FUNCTION publication_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated publication audit failure'; END $$`);
      await db.query(`CREATE TRIGGER publication_test_audit_failure BEFORE INSERT ON "ContentUpdateRun" FOR EACH ROW WHEN (NEW.kind = 'SCRIPTURE_RELEASE') EXECUTE FUNCTION publication_test_audit_failure()`);
      try { const r = await post(body); assert.equal(r.status, 500); assert.deepEqual(await r.json(), { error: "FAILED" }); assert.equal(await published(), 0); assert.equal(await prisma.contentUpdateRun.count({ where: { kind: "SCRIPTURE_RELEASE" } }), 0); }
      finally { await db.query('DROP TRIGGER publication_test_audit_failure ON "ContentUpdateRun"'); await db.query('DROP FUNCTION publication_test_audit_failure()'); }
    });
    await t.test("gewijzigde zichtbaarheid na voorcontrole vereist nieuwe bevestiging", async () => {
      const body = await request([ids[0]]);
      await prisma.contentCollection.update({ where: { id: ids[0] }, data: { visibleToUsers: false } });
      assert.equal((await post(body)).status, 409); assert.equal(await published(), 0);
      await prisma.contentCollection.update({ where: { id: ids[0] }, data: { visibleToUsers: true } });
    });
    await t.test("bestaande importlock en actieve tekstschrijver verhinderen publicatie", async () => {
      const body = await request([ids[0]]);
      await db.query("SELECT pg_advisory_lock($1)", [CONTENT_IMPORT_LOCK_KEY]);
      try { assert.equal((await post(body)).status, 409); } finally { await db.query("SELECT pg_advisory_unlock($1)", [CONTENT_IMPORT_LOCK_KEY]); }
      await db.query("BEGIN"); await db.query('LOCK TABLE "Verse" IN ROW EXCLUSIVE MODE');
      try { assert.equal((await post(body)).status, 409); assert.equal(await published(), 0); } finally { await db.query("ROLLBACK"); }
    });
    await t.test("actuele beheerrechten en sessieversie worden opnieuw gecontroleerd", async () => {
      const body = await request([ids[0]]);
      await prisma.user.update({ where: { id: second.user.id }, data: { isAdmin: false } });
      assert.equal((await post(body, { account: second })).status, 403);
      await prisma.user.update({ where: { id: second.user.id }, data: { isAdmin: true, sessionVersion: { increment: 1 } } });
      assert.equal((await post(body, { account: second })).status, 401);
      second.token = await createSessionToken(second.user.id); second.cookie = `${SESSION_COOKIE}=${second.token}`;
    });
    await t.test("twee beheerders: één publicatie, atomair logboek en veilige herhaling", async () => {
      const body = await request([ids[0]]);
      const responses = await Promise.all([post(body), post({ ...body, actionId: randomUUID() }, { account: second })]);
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(await published(), 1);
      const log = await prisma.contentUpdateRun.findFirstOrThrow({ where: { kind: "SCRIPTURE_RELEASE" } });
      assert.equal(await prisma.contentUpdateRun.count({ where: { kind: "SCRIPTURE_RELEASE" } }), 1);
      const winner = log.createdById === admin.user.id ? admin : second;
      const receipt = { ...body, actionId: log.id };
      const repeat = await post(receipt, { account: winner }); assert.equal(repeat.status, 200); assert.equal((await repeat.json()).replayed, true);
      assert.equal(await prisma.contentUpdateRun.count({ where: { kind: "SCRIPTURE_RELEASE" } }), 1);
      assert.equal((await post({ ...receipt, editions: [{ ...receipt.editions[0], releaseToken: "0".repeat(64) }] }, { account: winner })).status, 409);
    });
    await t.test("negen overige uitgaven in één bevestiging; verborgen en uitgeschakeld blijven zo", async () => {
      await prisma.contentCollection.update({ where: { id: ids[8] }, data: { visibleToUsers: false } });
      await prisma.contentCollection.update({ where: { id: ids[9] }, data: { enabled: false } });
      const body = await request(ids.slice(1)), start = performance.now(), r = await post(body);
      assert.equal(r.status, 200, await r.clone().text()); assert.equal((await r.json()).changed, 9);
      console.log(JSON.stringify({ atomicNinePublicationMs: Math.round(performance.now() - start), transactionLimitRaised: false }));
      assert.equal(await published(), 10);
      assert.equal((await prisma.contentCollection.findUniqueOrThrow({ where: { id: ids[8] } })).visibleToUsers, false);
      assert.equal((await prisma.contentCollection.findUniqueOrThrow({ where: { id: ids[9] } })).enabled, false);
      assert.equal((await call()).headers.get("cache-control"), "no-store, private");
      assert.deepEqual(await fingerprint(), baseline, "Geen tekst, cursussen, audio of voortgang gewijzigd");
      assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: ordinary.user.id } }), userBefore);
    });
    await t.test("web/native gebruiken dezelfde catalogus, alle vijf talen en beide Testamenten; herladen en opnieuw aanmelden", async () => {
      // Pas nu de bestaande afzonderlijke bediening toe voor de twee verborgen testuitgaven.
      for (const id of [ids[8], ids[9]]) await prisma.contentCollection.update({ where: { id }, data: { enabled: true, visibleToUsers: true } });
      const readable = await call(`/api/chapters/${anchor.id}`, { account: ordinary }); assert.equal(readable.status, 200); assert.equal((await readable.json()).verses[0].text, anchor.verses[0].text);
      const s = await nativeState();
      for (const work of ["old-testament", "new-testament"]) assert.deepEqual(s.picker.works.find(w => w.key === work).editions.map(e => e.language).sort(), ["de", "en", "es", "fr", "nl"]);
      const web = await call("/api/content-context?view=picker", { account: ordinary }); assert.equal(web.status, 200);
      const webData = await web.json(); assert.deepEqual(webData.works, s.picker.works);
      for (const id of [...ids, "content_bom"]) {
        const current = await nativeState(), response = await native({ contentCollectionId: id, expectedSelection: current.picker.selection, expectedSelectionVersion: current.picker.selectionVersion, location: "/dashboard" });
        assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).state.picker.selection.activeContentCollectionId, id);
      }
      for (const id of [...ids, "content_bom"]) {
        const current = await (await call("/api/content-context?view=picker", { account: ordinary })).json();
        const response = await call("/api/content-context", { account: ordinary, method: "PUT", body: { picker: true, contentCollectionId: id, expectedSelection: current.selection, location: { pathname: "/dashboard", search: "" } } });
        assert.equal(response.status, 200); assert.equal((await response.json()).applied, true);
        assert.equal((await nativeState()).picker.selection.activeContentCollectionId, id);
      }
      pair = await issueNativeSession(ordinary.user.id, ordinary.user.sessionVersion);
      assert.equal((await nativeState()).picker.selection.activeContentCollectionId, "content_bom");
      const hide = await call("/api/admin/content-switcher", { method: "PUT", body: { contentCollectionId: ids[0], visibleToUsers: false } }); assert.equal(hide.status, 200);
      assert.equal((await nativeState()).picker.works.flatMap(w => w.editions).some(e => e.id === ids[0]), false);
      assert.equal((await prisma.contentCollection.findUniqueOrThrow({ where: { id: ids[0] } })).publicationState, "PUBLISHED");
      await call("/api/admin/content-switcher", { method: "PUT", body: { contentCollectionId: ids[0], visibleToUsers: true } });
      assert.deepEqual(await fingerprint(), baseline);
    });
    await t.test("alle tien in één atomaire selectie binnen de bestaande transactielimiet", async () => {
      await prisma.contentCollection.updateMany({ where: { id: { in: ids } }, data: { publicationState: "DRAFT" } });
      const body = await request(ids), start = performance.now(), response = await post(body);
      assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).changed, 10);
      console.log(JSON.stringify({ atomicTenPublicationMs: Math.round(performance.now() - start), transactionLimitRaised: false }));
      assert.deepEqual(await fingerprint(), baseline);
    });
    // Laat vijf ongepubliceerde, geldige edities over voor echte bevestigings-/annuleerbrowserproeven.
    await prisma.contentCollection.updateMany({ where: { id: { in: ids.slice(0, 5) } }, data: { publicationState: "DRAFT" } });
    writeFileSync(join(dirname(process.env.CONTENT_MIGRATION_TEST_STATE), "scripture-publication-flow.json"), JSON.stringify({ adminToken: admin.token, adminId: admin.user.id, userToken: ordinary.token, userId: ordinary.user.id, draftId: ids[0] }));
  } finally { await db.end(); await prisma.$disconnect(); }
});
