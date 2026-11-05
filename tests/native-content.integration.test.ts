import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { prisma } from "../src/lib/db";
import { issueNativeSession, nativeSessionIdentity } from "../src/lib/native/sessions";
import { getContentPickerContext } from "../src/lib/contentCollections";
import { nativeContentStateSchema, nativeContentResultSchema } from "../src/lib/native/contract";
import { selectNativeContent } from "../src/lib/native/content.server";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";

const database = new URL(process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || database.href !== process.env.DATABASE_URL) throw Error("Alleen eigen geïsoleerde database");
const base = process.env.NATIVE_TEST_BASE_URL!, prefix = `native-picker-${randomUUID()}`;
const ids: Record<string, string> = {}, chapters: Record<string, string> = {};
async function account() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, handle: randomUUID().slice(0, 10), discriminator: "00", passwordHash: "synthetic", emailVerifiedAt: new Date(), onboardingSeenAt: new Date(), activeContentCollectionId: ids.nl, contentLanguage: "nl", uiLanguage: "de", xpTotal: 39, hintBalance: 7 } });
  return { user, pair: await issueNativeSession(user.id, user.sessionVersion) };
}
async function call(token?: string, body?: unknown, extra = {}, host = base) {
  return fetch(`${host}/api/v1/native/content-context`, { method: body === undefined ? "GET" : "POST", headers: { Origin: "capacitor://localhost", "X-Versado-Client": "native-v1", "x-real-ip": "127.0.0.29", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function state(token: string) { const response = await call(token); assert.equal(response.status, 200); return nativeContentStateSchema.parse(await response.json()); }
const input = (s: Awaited<ReturnType<typeof state>>, id: string, location = "/dashboard") => ({ contentCollectionId: id, expectedSelection: s.picker.selection, expectedSelectionVersion: s.picker.selectionVersion, location });
before(async () => {
  await prisma.contentWork.create({ data: { key: prefix, kind: "SCRIPTURE" } });
  for (const [name, language, edition, visible, enabled, publication] of [
    ["nl", "nl", "official", true, true, "PUBLISHED"], ["en", "en", "official", true, true, "PUBLISHED"],
    ["de", "de", "official", true, true, "LEGACY"], ["fr", "fr", "official", true, true, "PUBLISHED"], ["es", "es", "official", true, true, "PUBLISHED"],
    ["alternative", "en", "alternative", true, true, "PUBLISHED"], ["hidden", "nl", "hidden", false, true, "PUBLISHED"],
    ["draft", "nl", "draft", true, true, "DRAFT"], ["disabled", "nl", "disabled", true, false, "PUBLISHED"],
  ] as const) {
    ids[name] = `${prefix}-${name}`;
    await prisma.contentCollection.create({ data: { id: ids[name], slug: ids[name], work: prefix, name: `Schriften ${name}`, icon: "", language, editionKey: edition, visibleToUsers: visible, enabled, publicationState: publication } });
    const book = await prisma.book.create({ data: { slug: `${prefix}-${name}`, contentCollectionId: ids[name], key: `${prefix}/book`, name: `Boek ${name}`, order: 1 } });
    chapters[name] = (await prisma.chapter.create({ data: { bookId: book.id, number: 1, order: 1, verses: { create: { number: 1, text: `Synthetische passage ${name}.` } } } })).id;
  }
});
after(async () => prisma.$disconnect());

test("dezelfde echte webcatalogus, vijf talen, exacte edities en GET zonder gebruikersmutaties", async () => {
  const { user, pair } = await account(), before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const response = await call(pair.accessToken), s = nativeContentStateSchema.parse(await response.json());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(s.userId, user.id); assert.deepEqual(s.picker, await getContentPickerContext(user.id));
  assert.deepEqual(s.picker.works.find(w => w.key === prefix)?.editions.map(e => e.id).sort(), ["nl", "en", "de", "fr", "es", "alternative"].map(k => ids[k]).sort());
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), before);
});

test("Bearer en actorrechten blijven verplicht; hidden/draft/disabled, vervalste actor en onveilige routes geweigerd", async () => {
  const { user, pair } = await account(), s = await state(pair.accessToken), payload = input(s, ids.en);
  assert.equal((await call(undefined, undefined, { Cookie: `${SESSION_COOKIE}=${await createSessionToken(user.id)}` })).status, 401);
  assert.equal((await call(pair.accessToken, payload, { Origin: "https://evil.invalid" })).status, 403);
  for (const extra of [{ userId: "other" }, { isAdmin: true }, { preview: true }]) assert.equal((await call(pair.accessToken, { ...payload, ...extra })).status, 400);
  for (const location of ["//evil.invalid", "https://evil.invalid", "/api/admin", "/content", "/login", "/lesson/%2e%2e"]) assert.equal((await call(pair.accessToken, { ...payload, location })).status, 400);
  for (const name of ["hidden", "draft", "disabled"]) assert.equal((await call(pair.accessToken, input(s, ids[name]))).status, 404);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).activeContentCollectionId, ids.nl);
});

test("bronwissel behoudt voortgang, ui-taal en beloningen en hervat het canonieke hoofdstukequivalent", async () => {
  const { user, pair } = await account(), s = await state(pair.accessToken);
  const prior = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const response = await call(pair.accessToken, input(s, ids.en, `/lesson/${chapters.nl}`)); assert.equal(response.status, 200);
  const result = nativeContentResultSchema.parse(await response.json()); assert.equal(result.destination, `/lesson/${chapters.en}`);
  assert.equal(result.state.picker.selection.activeContentCollectionId, ids.en); assert.equal(result.state.picker.selection.contentLanguage, "en");
  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.deepEqual({ ...after, activeContentCollectionId: prior.activeContentCollectionId, contentLanguage: prior.contentLanguage, contentSelectionVersion: prior.contentSelectionVersion }, prior);
  assert.equal(await prisma.contentProgress.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.streakActivity.count({ where: { userId: user.id } }), 0);
  const retry = await call(pair.accessToken, input(s, ids.en)); assert.equal(retry.status, 409, "Verloren antwoord veroorzaakt geen tweede wijziging");
  assert.equal((await state(pair.accessToken)).picker.selectionVersion, result.state.picker.selectionVersion);
});

test("twee beheerloze clients en web/native concurreren op één bestaande selectieteller; ABA wordt geweigerd", async () => {
  const { user, pair } = await account(), s = await state(pair.accessToken);
  const results = await Promise.all([call(pair.accessToken, input(s, ids.en)), call(pair.accessToken, input(s, ids.de), {}, process.env.NATIVE_SOCKET_TEST_B!)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const current = await state(pair.accessToken);
  const web = await fetch(`${base}/api/content-context`, { method: "PUT", headers: { Origin: base, Cookie: `${SESSION_COOKIE}=${await createSessionToken(user.id)}`, "Content-Type": "application/json" }, body: JSON.stringify({ picker: true, contentCollectionId: ids.nl, expectedSelection: current.picker.selection, location: { pathname: "/dashboard", search: "" } }) });
  assert.equal(web.status, 200);
  assert.equal((await call(pair.accessToken, input(s, ids.en))).status, 409, "Zelfde tuple na A→B→A is geen actuele versie");
  assert.equal((await state(pair.accessToken)).picker.selection.activeContentCollectionId, ids.nl);
});

test("sessie-intrekking en verloop tijdens lockwachten verhinderen de selectiecommit", async () => {
  for (const revoke of [false, true]) {
    const { user, pair } = await account(), s = await state(pair.accessToken), identity = await nativeSessionIdentity(pair.accessToken);
    const lock = new pg.Client({ connectionString: database.href }); await lock.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await lock.query("BEGIN"); await lock.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE', [user.id]);
      pending = selectNativeContent(identity.binding, input(s, ids.en));
      // Laat resolver/autoriteit de reeds geldige sessie lezen en echt op de User-lock wachten.
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        await lock.query("SELECT pg_stat_clear_snapshot()");
        const result = await lock.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%User%FOR UPDATE%' AND pid<>pg_backend_pid()");
        if (result.rowCount) { waiting = true; break; }
        await new Promise(r => setTimeout(r, 10));
      }
      assert.ok(waiting, "Echte database-lockwait bereikt");
      await lock.query(`UPDATE "NativeSession" SET ${revoke ? '"revokedAt"=NOW()' : '"createdAt"=NOW()-INTERVAL \'1 day\', "expiresAt"=NOW()-INTERVAL \'1 second\''} WHERE id=$1`, [identity.binding.sessionId]);
      await lock.query("COMMIT"); await assert.rejects(pending, /session_expired/);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).activeContentCollectionId, ids.nl);
    } finally { await lock.query("ROLLBACK"); await lock.end(); if (pending) await pending.catch(() => {}); }
  }
});


test("databasefout rolt selectie en versieteller volledig terug; geen impliciete schrijfretry", async () => {
  const { user, pair } = await account(), s = await state(pair.accessToken);
  const lock = new pg.Client({ connectionString: database.href }); await lock.connect();
  const name = `native_picker_${randomUUID().replaceAll("-", "")}`;
  try {
    await lock.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${user.id}' AND NEW."activeContentCollectionId"='${ids.en}' THEN RAISE EXCEPTION 'synthetic selection failure'; END IF; RETURN NEW; END $$`);
    await lock.query(`CREATE TRIGGER ${name} BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    const response = await call(pair.accessToken, input(s, ids.en)); assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "native_request_failed" });
    const current = await state(pair.accessToken); assert.deepEqual(current.picker.selection, s.picker.selection); assert.equal(current.picker.selectionVersion, s.picker.selectionVersion);
  } finally { await lock.query(`DROP TRIGGER IF EXISTS ${name} ON "User"`); await lock.query(`DROP FUNCTION IF EXISTS ${name}()`); await lock.end(); }
});

test("CFM blijft één permanent programma; bron kiezen maakt geen cursus, les of voortgang aan", async () => {
  const volumes = [
    { id: "content_cfm_ot_2026_nl", slug: "cfm-ot-2026-nl", work: "cfm-old-testament-2026", editionKey: "church-cfm-ot-2026" },
    { id: "content_cfm_nt_2027_nl", slug: "cfm-nt-2027-nl", work: "cfm-new-testament-2027", editionKey: "church-cfm-nt-2027" },
  ];
  for (const volume of volumes) {
    await prisma.contentWork.upsert({ where: { key: volume.work }, create: { key: volume.work, kind: "STUDY_PROGRAM" }, update: {} });
    await prisma.contentCollection.upsert({ where: { id: volume.id }, create: { ...volume, name: "Synthetisch CFM-programma", icon: "book", language: "nl", enabled: true, visibleToUsers: true, publicationState: "PUBLISHED" }, update: { enabled: true, visibleToUsers: true, publicationState: "PUBLISHED" } });
  }
  const { user, pair } = await account(), s = await state(pair.accessToken);
  const cfm = s.picker.works.flatMap(w => w.editions).filter(e => volumes.some(v => v.id === e.id));
  assert.equal(cfm.length, 1); assert.equal(cfm[0].id, volumes[0].id); assert.equal(cfm[0].name, "Kom dan en volg Mij");
  const courses = await prisma.course.count(), lessons = await prisma.studyLesson.count();
  const response = await call(pair.accessToken, input(s, cfm[0].id)); assert.equal(response.status, 200);
  const selected = nativeContentResultSchema.parse(await response.json());
  assert.equal(selected.state.picker.selection.activeContentCollectionId, volumes[0].id);
  assert.equal(selected.destination, "/content", "Nog geen lokale studielezer: herstelbare kiezer, geen dode cursusroute");
  assert.equal(await prisma.course.count(), courses); assert.equal(await prisma.studyLesson.count(), lessons);
  assert.equal(await prisma.userCourseProgress.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.contentProgress.count({ where: { userId: user.id } }), 0);
});

test("oude actieve cursus zonder expliciete bron kan geen andere tekst dan de canonieke kiezerbron aanbieden", async () => {
  const { user, pair } = await account();
  const course = await prisma.course.create({ data: { slug: `${prefix}-old-course-${randomUUID()}`, name: "Oude andere cursus", type: "FREE_CHOICE", contentCollectionId: ids.en } });
  await prisma.user.update({ where: { id: user.id }, data: { activeContentCollectionId: null, activeCourseId: course.id } });
  const s = await state(pair.accessToken), canonical = s.picker.activeCollectionId; assert.ok(canonical); assert.notEqual(canonical, ids.en);
  const previousChapters = await prisma.chapter.findMany({ where: { book: { contentCollectionId: canonical } }, select: { id: true }, orderBy: { id: "asc" } });
  const book = await prisma.book.create({ data: { slug: `${prefix}-canonical-${randomUUID()}`, key: `${prefix}/canonical`, name: "Canonieke bron", order: 0, contentCollectionId: canonical } });
  try {
    await prisma.chapter.create({ data: { bookId: book.id, number: 1, order: 1, verses: { create: { number: 1, text: "Synthetische canonieke bron." } } } });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const response = await fetch(`${base}/api/v1/native/today`, { headers: { Origin: "capacitor://localhost", "X-Versado-Client": "native-v1", Authorization: `Bearer ${pair.accessToken}` } });
    assert.equal(response.status, 200); const today = await response.json(); assert.ok(today.activity);
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: today.activity.id }, include: { book: true } });
    assert.equal(chapter.book.contentCollectionId, canonical);
    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), before, "Alleen lezen, geen impliciete cursus-/bronwissel");
  } finally {
    // Alleen het eigen tijdelijke leeshoofdstuk: de gedeelde canonieke bron is
    // ook de vragenpool van de ongewijzigde multi-instance-beloningsregressie.
    await prisma.book.delete({ where: { id: book.id } });
  }
  assert.deepEqual(await prisma.chapter.findMany({ where: { book: { contentCollectionId: canonical } }, select: { id: true }, orderBy: { id: "asc" } }), previousChapters, "De bestaande vragenpool blijft exact gelijk na de leesproef");
});
