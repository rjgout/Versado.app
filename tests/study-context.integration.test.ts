import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import { getContentContext, setContentLanguage, setActiveContentCollection } from "../src/lib/contentCollections";
import { applyContentSwitch } from "../src/lib/contentSwitch";
import { getStudyContext, setStudyContext, StudyContextError } from "../src/lib/studyContext";
import { setRealtimeServer } from "../src/lib/realtime";
import type { Server } from "socket.io";

const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
const base = new URL(process.env.CONTENT_ACCESS_TEST_BASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || base.hostname !== "127.0.0.1" || process.env.DATABASE_URL !== database.href) throw new Error("Uitsluitend eigen content-architecture runner");
const prefix = `study-${randomUUID()}`;
const lessonIds: Record<string, string> = {};
const collections: string[] = [];
const futureWork = `${prefix}-future`;
type Actor = { id: string; isAdmin: boolean; cookie: string };
let a: Actor, b: Actor, admin: Actor;
async function account(isAdmin = false): Promise<Actor> {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@study.test.invalid`, handle: randomUUID().slice(0,8), discriminator: "00", passwordHash: "synthetic-only", isAdmin, activeContentCollectionId: "content_bom", hintBalance: 8 } });
  return { id: user.id, isAdmin, cookie: `${SESSION_COOKIE}=${await createSessionToken(user.id)}` };
}
async function request(actor: Actor | null, method = "GET", body?: unknown, query = "?workKey=fsy", origin: string | null = base.origin) {
  return fetch(new URL(`/api/study-context${query}`, base), { method, headers: {
    ...(actor ? { Cookie: actor.cookie } : {}), ...(origin ? { Origin: origin } : {}),
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const action = (key: string | null, expectedVersion: number, workKey = "fsy") => ({ workKey, activeLessonKey: key, expectedVersion, actionId: randomUUID() });
async function put(actor: Actor, key: string | null, version: number) {
  const result = await request(actor, "PUT", action(key, version), "");
  assert.equal(result.status, 200, await result.clone().text());
  return result.json() as Promise<{ changed: boolean; context: { version: number; activeLessonKey: string | null } }>;
}
async function fixture(name: string, options: { enabled?: boolean; visible?: boolean; publication?: "LEGACY" | "DRAFT" | "PUBLISHED"; status?: "PUBLISHED" | "DRAFT"; blocks?: string | null; work?: string } = {}) {
  const id = `${prefix}-${name}`; collections.push(id);
  await prisma.contentCollection.create({ data: { id, slug: id, name, icon: "", work: options.work ?? "fsy", editionKey: id, language: "nl", enabled: options.enabled ?? true, visibleToUsers: options.visible ?? true, publicationState: options.publication ?? "PUBLISHED" } });
  const lesson = await prisma.fsyLesson.create({ data: { contentCollectionId: id, year: 2026, month: 10, category: "TEST", slug: name, title: "PRIVE_CONCEPT", content: '[{"type":"paragraph","text":"PRIVE_CONCEPT"}]', images: "[]", sourceUrl: `https://study.test.invalid/${id}`, sourceHash: id, status: options.status ?? "PUBLISHED", publishedContent: options.blocks === undefined ? '[{"type":"paragraph","text":"PUBLICATIE"}]' : options.blocks } });
  lessonIds[name] = `fsy:${lesson.id}`;
}
before(async () => {
  a = await account(); b = await account(); admin = await account(true);
  await prisma.contentWork.create({ data: { key: futureWork, kind: "STUDY_PROGRAM" } });
  await fixture("one"); await fixture("two", { publication: "LEGACY" });
  await fixture("hidden", { visible: false }); await fixture("disabled", { enabled: false });
  await fixture("draft-collection", { publication: "DRAFT" }); await fixture("draft", { status: "DRAFT", blocks: null });
  await fixture("draft-copy", { status: "DRAFT" }); await fixture("empty", { blocks: "[]" });
  await fixture("invalid-content", { blocks: "broken-json" }); await fixture("missing-publication", { blocks: null });
  await fixture("wrong-work", { work: "podcasts" });
});
after(async () => { await prisma.$disconnect(); });

test("oude gebruiker en GET: versie 0, geen context/backfill of accountmutatie", async () => {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
  assert.equal((await request(null)).status, 401);
  for (let i = 0; i < 3; i++) {
    const response = await request(a); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual((await response.json()).context, { workKey: "fsy", activeLessonKey: null, version: 0, updatedAt: null, available: false, lessonHref: null });
    assert.deepEqual((await getContentContext(a.id)).studyContexts, []);
  }
  assert.equal(await prisma.userStudyContext.count({ where: { userId: a.id } }), 0);
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: a.id } }), before);
  const cleared = await put(a, null, 0); assert.equal(cleared.changed, false);
  assert.equal(await prisma.userStudyContext.count({ where: { userId: a.id } }), 0);
});

test("authenticatie, strikte payload/query en Origin: geen toegang tot andermans context, ook niet als admin", async () => {
  assert.equal((await request(null, "PUT", action(lessonIds.one, 0), "")).status, 401);
  for (const origin of [null, "null", "https://evil.test"]) assert.equal((await request(a, "PUT", action(lessonIds.one, 0), "", origin)).status, 403);
  for (const extra of [{ userId: b.id }, { isAdmin: true }, { preview: true }]) {
    assert.equal((await request(admin, "PUT", { ...action(lessonIds.one, 0), ...extra }, "")).status, 400);
  }
  assert.equal((await request(admin, "GET", undefined, `?workKey=fsy&userId=${a.id}`)).status, 400);
  assert.equal((await request(a, "GET", undefined, "?workKey=fsy&workKey=fsy")).status, 400);
  await put(a, lessonIds.one, 0);
  assert.equal((await (await request(b)).json()).context.activeLessonKey, null);
  assert.equal((await (await request(admin)).json()).context.activeLessonKey, null);
  const response = await request(a, "GET", undefined, "");
  const text = await response.text(); assert.ok(!text.includes("PRIVE_CONCEPT")); assert.ok(!text.includes(a.id));
});

for (const name of ["hidden", "disabled", "draft-collection", "draft", "draft-copy", "empty", "invalid-content", "missing-publication", "wrong-work"]) test(`${name}: selectie geweigerd zonder bijeffect, adminpreview verruimt geen gewone keuze`, async () => {
  for (const actor of [b, admin]) {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    const response = await request(actor, "PUT", action(lessonIds[name], 0), "");
    assert.equal(response.status, 404); assert.ok(!(await response.text()).includes("PRIVE_CONCEPT"));
    assert.equal(await prisma.userStudyContext.count({ where: { userId: actor.id } }), 0);
    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: actor.id } }), before);
  }
});

test("ongeldig werk, podcast/Schrifturen, ontbrekende les en fictieve CFM-key worden geweigerd", async () => {
  for (const work of ["podcasts", "bofm", "missing", "cfm"]) assert.equal((await request(b, "PUT", action(lessonIds.one, 0, work), "")).status, 404);
  for (const key of ["fsy:missing", "cfm:2026-week-1", "fsy:"]) assert.equal((await request(b, "PUT", action(key, 0), "")).status, 404);
  assert.equal((await request(b, "PUT", action(lessonIds.one, 0, futureWork), "")).status, 404);
});

test("gelijktijdige eerste creaties: één rij en versie; verloren response/dubbele actionId kost geen tweede wijziging", async () => {
  const actor = await account(); const first = action(lessonIds.one, 0);
  const responses = await Promise.all([request(actor, "PUT", first, ""), request(actor, "PUT", first, "")]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  assert.equal(await prisma.userStudyContext.count({ where: { userId: actor.id } }), 1);
  assert.equal((await getStudyContext(actor, "fsy")).version, 1);
  const retry = await request(actor, "PUT", first, ""); assert.equal(retry.status, 200); assert.equal((await retry.json()).changed, false);
  const invalidReuse = await request(actor, "PUT", { ...first, activeLessonKey: lessonIds.two }, ""); assert.equal(invalidReuse.status, 400);
});

test("twee verschillende eerste acties en twee apparaten: alleen één winnaar, herstelbaar conflict", async () => {
  const actor = await account();
  const responses = await Promise.all([request(actor, "PUT", action(lessonIds.one, 0), ""), request(actor, "PUT", action(lessonIds.two, 0), "")]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const stale = responses.find(r => r.status === 409)!;
  const conflict = await stale.json(); assert.equal(conflict.code, "CONFLICT"); assert.equal(conflict.context.version, 1);
  assert.equal(await prisma.userStudyContext.count({ where: { userId: actor.id } }), 1);
  const next = await Promise.all([request(actor, "PUT", action(null, 1), ""), request(actor, "PUT", action(lessonIds.one === conflict.context.activeLessonKey ? lessonIds.two : lessonIds.one, 1), "")]);
  assert.deepEqual(next.map(r => r.status).sort(), [200, 409]); assert.equal((await getStudyContext(actor, "fsy")).version, 2);
});

test("oude retry na nieuwe keuze krijgt 409; no-op verhoogt versie niet, expliciet leegmaken wel", async () => {
  const actor = await account(); const old = action(lessonIds.one, 0);
  assert.equal((await request(actor, "PUT", old, "")).status, 200);
  await put(actor, lessonIds.two, 1);
  const response = await request(actor, "PUT", old, ""); assert.equal(response.status, 409);
  assert.equal((await response.json()).context.activeLessonKey, lessonIds.two);
  const noop = await put(actor, lessonIds.two, 2); assert.equal(noop.changed, false); assert.equal(noop.context.version, 2);
  const cleared = await put(actor, null, 2); assert.equal(cleared.context.version, 3);
  assert.equal(await prisma.userStudyContext.count({ where: { userId: actor.id } }), 1);
});

test("ingetrokken les blijft bewaard, GET en conflict geven geen verboden bestemming; bewust wissen blijft mogelijk", async () => {
  const actor = await account(); await put(actor, lessonIds.one, 0);
  await prisma.contentCollection.update({ where: { id: collections[0] }, data: { visibleToUsers: false } });
  try {
    const original = await prisma.userStudyContext.findUniqueOrThrow({ where: { userId_workKey: { userId: actor.id, workKey: "fsy" } } });
    const context = (await (await request(actor)).json()).context;
    assert.equal(context.activeLessonKey, lessonIds.one); assert.equal(context.available, false); assert.equal(context.lessonHref, null);
    assert.equal((await (await request(actor, "PUT", action(lessonIds.two, 0), "")).json()).context.lessonHref, null);
    assert.deepEqual(await prisma.userStudyContext.findUniqueOrThrow({ where: { userId_workKey: { userId: actor.id, workKey: "fsy" } } }), original);
    await put(actor, null, 1);
  } finally { await prisma.contentCollection.update({ where: { id: collections[0] }, data: { visibleToUsers: true } }); }
});

test("programma's onafhankelijk: toekomstige onbeschikbare voorkeur blijft staan bij FSY-, bron- en taalwissel", async () => {
  const actor = await account();
  // Uitsluitend synthetische bestaande rij; geen fictieve CFM-adapter of lesimport.
  const future = await prisma.userStudyContext.create({ data: { userId: actor.id, workKey: futureWork, activeLessonKey: "unavailable:synthetic-stored-key", lastActionId: randomUUID() } });
  await put(actor, lessonIds.one, 0);
  await setContentLanguage(actor.id, false, "en");
  await setActiveContentCollection(actor.id, false, "content_bom");
  await applyContentSwitch({ userId: actor.id, isAdmin: false, change: { contentLanguage: "nl" }, location: { pathname: "/dashboard", search: "" } });
  assert.equal((await getStudyContext(actor, "fsy")).activeLessonKey, lessonIds.one);
  assert.deepEqual(await prisma.userStudyContext.findUniqueOrThrow({ where: { userId_workKey: { userId: actor.id, workKey: futureWork } } }), future);
  const context = await getContentContext(actor.id); assert.equal(context.studyContexts?.length, 2); assert.ok(context.active.id); assert.ok(context.collections.length);
  const clear = await request(actor, "PUT", action(null, 1, futureWork), ""); assert.equal(clear.status, 200);
  assert.equal((await getStudyContext(actor, "fsy")).version, 1);
});

test("contextkeuze verandert geen bestaande tabellen/voortgang/economie/podcast; event uitsluitend na commit en eigen room", async () => {
  const actor = { id: "m-user-1", isAdmin: false };
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename NOT IN ('_prisma_migrations','UserStudyContext') ORDER BY tablename`;
  const fingerprint = async () => Promise.all(tables.map(async ({ tablename }) => prisma.$queryRawUnsafe(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM "${tablename.replaceAll('"','""')}" t`)));
  const before = await fingerprint(); const events: { room: string; event: string; payload: unknown }[] = [];
  setRealtimeServer({ to: (room: string) => ({ emit: (event: string, payload: unknown) => { events.push({ room, event, payload }); } }) } as unknown as Server);
  const first = action(lessonIds.one, 0);
  const saved = await setStudyContext(actor, first);
  assert.equal(saved.context.version, 1);
  assert.equal((await getStudyContext(actor, "fsy")).version, 1);
  assert.deepEqual(events, [{ room: `user:${actor.id}`, event: "data_event", payload: { event: "studyContextChanged" } }]);
  await setStudyContext(actor, first);
  await assert.rejects(setStudyContext(actor, action(lessonIds.two, 0)), (e: unknown) => e instanceof StudyContextError && e.code === "CONFLICT");
  await assert.rejects(setStudyContext(actor, action(lessonIds.hidden, 1)), (e: unknown) => e instanceof StudyContextError && e.code === "UNAVAILABLE");
  assert.equal(events.length, 1); assert.deepEqual(await fingerprint(), before);
});

test("databasefout rolt contextwijziging terug en publiceert geen event", async () => {
  const actor = { id: "m-user-2", isAdmin: false };
  await prisma.$executeRawUnsafe(`CREATE FUNCTION study_test_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_failure'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER study_test_abort BEFORE INSERT ON "UserStudyContext" FOR EACH ROW EXECUTE FUNCTION study_test_abort()`);
  try {
    const events: unknown[] = [];
    setRealtimeServer({ to: () => ({ emit: (...args: unknown[]) => events.push(args) }) } as unknown as Server);
    await assert.rejects(setStudyContext(actor, action(lessonIds.one, 0)));
    assert.equal((await getStudyContext(actor, "fsy")).version, 0); assert.deepEqual(events, []);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER study_test_abort ON "UserStudyContext"');
    await prisma.$executeRawUnsafe('DROP FUNCTION study_test_abort()');
  }
});
