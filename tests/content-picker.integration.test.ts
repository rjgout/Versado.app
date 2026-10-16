import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import type { ContentPickerContext } from "../src/lib/contentPickerContract";

const dbUrl = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
const base = new URL(process.env.CONTENT_ACCESS_TEST_BASE_URL ?? "http://invalid");
if (dbUrl.hostname !== "127.0.0.1" || dbUrl.pathname !== "/versado_content_access_test" || base.hostname !== "127.0.0.1" || process.env.DATABASE_URL !== dbUrl.href) throw new Error("Uitsluitend eigen content-architecture runner");
const prefix = `picker-${randomUUID()}`;
const ids: Record<string, string> = {};
const chapters: Record<string, string> = {};
const courses: Record<string, string> = {};
let userId: string, cookie: string, adminCookie: string;
async function request(method = "GET", body?: unknown, auth: string | null = cookie, origin: string | null = base.origin, view = "?view=picker") {
  return fetch(new URL(`/api/content-context${view}`, base), { method, headers: { ...(auth ? { Cookie: auth } : {}), ...(origin ? { Origin: origin } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
}
async function context(auth = cookie) { return await (await request("GET", undefined, auth)).json() as ContentPickerContext; }
async function choose(id: string, pathname = "/dashboard", expectedSelection?: ContentPickerContext["selection"], auth = cookie, extra = {}) {
  return request("PUT", { picker: true, contentCollectionId: id, expectedSelection: expectedSelection ?? (await context(auth)).selection, location: { pathname, search: "" }, ...extra }, auth);
}
async function account(admin = false) {
  const u = await prisma.user.create({ data: { email: `${randomUUID()}@picker.test.invalid`, handle: randomUUID().slice(0,8), discriminator: "00", passwordHash: "synthetic", isAdmin: admin, uiLanguage: "de", activeContentCollectionId: ids.nl, contentLanguage: "nl", hintBalance: 8 } });
  return { id: u.id, cookie: `${SESSION_COOKIE}=${await createSessionToken(u.id)}` };
}
async function reset() { await prisma.user.update({ where: { id: userId }, data: { activeContentCollectionId: ids.nl, contentLanguage: "nl" } }); }
before(async () => {
  for (const [name, kind] of [["main", "SCRIPTURE"], ["other", "SCRIPTURE"], ["programme", "STUDY_PROGRAM"]] as const) await prisma.contentWork.create({ data: { key: `${prefix}-${name}`, kind } });
  for (const [name, work, family, language, visible, enabled, publication] of [
    ["nl", "main", "original", "nl", true, true, "PUBLISHED"],
    ["en", "main", "original", "en", true, true, "LEGACY"],
    ["alt", "main", "alternative", "fr", true, true, "PUBLISHED"],
    ["other", "other", "original", "nl", true, true, "PUBLISHED"],
    ["empty", "other", "empty", "de", true, true, "PUBLISHED"],
    ["programme", "programme", "original", "nl", true, true, "PUBLISHED"],
    ["hidden", "main", "hidden", "nl", false, true, "PUBLISHED"],
    ["disabled", "main", "disabled", "nl", true, false, "PUBLISHED"],
    ["draft", "main", "draft", "nl", true, true, "DRAFT"],
  ] as const) {
    ids[name] = `${prefix}-${name}`;
    await prisma.contentCollection.create({ data: { id: ids[name], slug: ids[name], name: `Echte testbron ${name}`, icon: "", work: `${prefix}-${work}`, editionKey: family, language, enabled, visibleToUsers: visible, publicationState: publication } });
  }
  for (const name of ["nl", "en", "other"]) {
    const book = await prisma.book.create({ data: { slug: `${prefix}-book-${name}`, key: `${prefix}/book`, name: name, order: 1, contentCollectionId: ids[name] } });
    chapters[name] = (await prisma.chapter.create({ data: { bookId: book.id, number: 1, order: 1 } })).id;
    courses[name] = (await prisma.course.create({ data: { slug: `${prefix}-course-${name}`, name: name, type: name === "other" ? "FREE_CHOICE" : "READING_LESSONS", contentCollectionId: ids[name] } })).id;
  }
  const normal = await account(); userId = normal.id; cookie = normal.cookie; adminCookie = (await account(true)).cookie;
  await prisma.userStudyContext.create({ data: { userId, workKey: "fsy", activeLessonKey: "fsy:m-fsy-1", lastActionId: randomUUID() } });
});
after(async () => { await prisma.$disconnect(); });

test("echt cataloguscontract: één werk per soort, edities/talen, podcasts OTHER en adminherkenning zonder previewselectie", async () => {
  const response = await request(); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const c = await response.json() as ContentPickerContext;
  assert.equal(new Set(c.works.map(w => w.key)).size, c.works.length);
  assert.equal(c.works.find(w => w.key === `${prefix}-main`)?.kind, "SCRIPTURE");
  assert.equal(c.works.find(w => w.key === `${prefix}-programme`)?.kind, "STUDY_PROGRAM");
  assert.equal(c.works.find(w => w.key === "podcasts")?.kind, "OTHER");
  assert.ok(!c.works.flatMap(w => w.editions).some(e => [ids.hidden,ids.disabled,ids.draft].includes(e.id)));
  const admin = await context(adminCookie); assert.equal(admin.works.flatMap(w => w.editions).find(e => e.id === ids.hidden)?.selectable, true);
  for (const auth of [cookie, adminCookie]) for (const name of ["hidden","disabled","draft"]) assert.equal((await choose(ids[name], "/dashboard", undefined, auth)).status, auth === adminCookie && name === "hidden" ? 200 : 404);
  await choose(ids.nl,"/dashboard",undefined,adminCookie);
});

test("auth, CSRF, client-userId/preview en externe redirects worden geweigerd", async () => {
  const payload = { picker: true, contentCollectionId: ids.en, expectedSelection: (await context()).selection };
  assert.equal((await request("PUT", payload, null)).status, 401);
  for (const origin of [null,"null","https://evil.test"]) assert.equal((await request("PUT", payload, cookie, origin)).status, 403);
  for (const extra of [{ userId: "m-user-1" }, { isAdmin: true }, { preview: true }]) assert.equal((await request("PUT", { ...payload,...extra })).status, 400);
  for (const pathname of ["//evil.test", "https://evil.test", "/\\evil", "/api/auth/logout"]) assert.equal((await choose(ids.en, pathname)).status, 400);
});

test("één tik: expliciete editie + taal coherent, uiLanguage onafhankelijk en equivalent hoofdstuk", async () => {
  await reset();
  const result = await choose(ids.en, `/lesson/${chapters.nl}`); assert.equal(result.status, 200);
  const body = await result.json(); assert.equal(body.applied, true); assert.equal(body.outcome.href, `/lesson/${chapters.en}`);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(u.activeContentCollectionId, ids.en); assert.equal(u.contentLanguage, "en"); assert.equal(u.uiLanguage, "de");
});

test("familie ontbreekt: geen stille substitutie; expliciete andere familie mag exact", async () => {
  await reset(); const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const response = await request("PUT", { picker: true, contentLanguage: "fr", expectedSelection: (await context()).selection, location: { pathname: "/dashboard", search: "" } });
  assert.equal(response.status, 404); assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: userId } }), before);
  assert.equal((await choose(ids.alt)).status, 200);
  assert.equal((await context()).selection.activeContentCollectionId, ids.alt); assert.equal((await context()).selection.contentLanguage, "fr");
});

test("geldig werk zonder route-equivalent krijgt direct bruikbare hub, zonder force/confirm", async () => {
  await reset(); const response = await choose(ids.other, `/courses/${courses.nl}`);
  const result = await response.json(); assert.equal(result.applied, true); assert.equal(result.outcome.href, "/courses");
  await reset(); const game = await choose(ids.other, "/jigsaw"); assert.equal((await game.json()).outcome.href, "/live");
  await reset(); const neutral = await choose(ids.en, "/profile"); assert.equal((await neutral.json()).outcome.href, "/profile");
});

test("zonder cursus of ondersteunde programmalessen: geldige bron opslaan met herstelbare status, geen fictieve les", async () => {
  for (const name of ["empty","programme"]) {
    await reset(); const response = await choose(ids[name], "/courses"); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.availability, "no-destination"); assert.equal(result.outcome.href, "/content");
    assert.equal((await context()).selection.activeContentCollectionId, ids[name]);
  }
});

test("huidige bron en dubbele identieke requests muteren niet opnieuw; twee verschillende tabs krijgen 409", async () => {
  await reset();
  const xmin = async () => (await prisma.$queryRaw<{ xmin: string }[]>`SELECT xmin::text AS xmin FROM "User" WHERE id=${userId}`)[0].xmin;
  const before = await xmin(); assert.equal((await (await choose(ids.nl)).json()).changed, false); assert.equal(await xmin(), before);
  const expected = (await context()).selection;
  const duplicate = await Promise.all([choose(ids.en, "/dashboard", expected), choose(ids.en, "/dashboard", expected)]);
  assert.deepEqual(duplicate.map(r => r.status), [200,200]);
  assert.equal((await context()).selection.activeContentCollectionId, ids.en);
  await reset(); const stale = (await context()).selection;
  const competing = await Promise.all([choose(ids.en, "/dashboard", stale), choose(ids.other, "/dashboard", stale)]);
  assert.deepEqual(competing.map(r => r.status).sort(), [200,409]);
  const retry = await choose(ids.alt, "/dashboard", stale); assert.equal(retry.status, 409);
});

test("oude gebruiker zonder expliciete bron behoudt null bij aantikken van zijn effectieve keuze", async () => {
  await prisma.user.update({ where: { id: userId }, data: { activeContentCollectionId: null, contentLanguage: "nl" } });
  const c = await context(); assert.ok(c.activeCollectionId);
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const result = await (await choose(c.activeCollectionId!)).json();
  assert.equal(result.changed, false); assert.deepEqual(result.selection, c.selection);
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: userId } }),before);
});

test("ontbrekende expliciete bron behoudt de bestaande werk-default bij een elders beschikbare taal", async () => {
  await prisma.contentCollection.update({ where: { id: ids.empty }, data: { order: -100 } });
  try {
    await prisma.user.update({ where: { id: userId }, data: { activeContentCollectionId: null, contentLanguage: "en" } });
    const c = await context();
    const legacy = await (await request("GET",undefined,cookie,base.origin,"")).json();
    assert.equal(c.activeCollectionId, legacy.active.id); assert.equal(c.activeCollectionId,ids.other);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const result = await (await choose(c.activeCollectionId!)).json();
    assert.equal(result.changed,false); assert.deepEqual(result.selection,c.selection);
    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id:userId } }),before);
  } finally { await prisma.contentCollection.update({ where: { id: ids.empty }, data: { order: 0 } }); }
});

test("alle oude gegevens, studiecontext en economie blijven gelijk; legacy API blijft bruikbaar", async () => {
  await reset();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename <> '_prisma_migrations' ORDER BY tablename`;
  const fingerprint = async () => Promise.all(tables.map(({tablename}) => {
    // Alleen de vier expliciete voorkeurwissels van deze gebruiker mogen wijzigen.
    const projection=tablename === "User" ? "(CASE WHEN t.id=$1 THEN to_jsonb(t)-'activeContentCollectionId'-'contentLanguage'-'contentSelectionVersion' ELSE to_jsonb(t) END)" : "to_jsonb(t)";
    return prisma.$queryRawUnsafe(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(${projection}::text,E'\\n' ORDER BY ${projection}::text),'')) AS hash FROM "${tablename.replaceAll('"','""')}" t`,...(tablename === "User" ? [userId] : []));
  }));
  const counterBefore=(await prisma.user.findUniqueOrThrow({where:{id:userId}})).contentSelectionVersion;
  const before = await fingerprint();
  assert.equal((await choose(ids.en)).status, 200);
  assert.equal((await choose("content_podcasts")).status, 200);
  const legacy = await request("PUT", { contentCollectionId: ids.nl }, cookie, base.origin, "");
  assert.equal(legacy.status, 200); assert.equal((await legacy.json()).active.id, ids.nl);
  const language = await request("PUT", { contentLanguage: "en" }, cookie, base.origin, ""); assert.equal(language.status, 200);
  const old = await (await request("GET", undefined, cookie, base.origin, "")).json(); assert.ok(old.active); assert.ok(old.collections); assert.ok(old.works); assert.ok(old.studyContexts);
  assert.deepEqual(await fingerprint(),before);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:userId}})).contentSelectionVersion,counterBefore+4);
});

test("lege catalogus bevat geen synthetische selecteerbare bron en bewaart voorkeuren", async () => {
  const flags = await prisma.contentCollection.findMany({ select: { id:true,enabled:true } });
  const before = await prisma.user.findUniqueOrThrow({ where: { id:userId } });
  await prisma.contentCollection.updateMany({ data: { enabled:false } });
  try {
    const c = await context(); assert.deepEqual(c.works,[]); assert.equal(c.activeCollectionId,null);
    const old = await (await request("GET",undefined,cookie,base.origin,"")).json(); assert.deepEqual(old.collections,[]); assert.deepEqual(old.works,[]);
    assert.equal((await choose("content_bom")).status,404); assert.deepEqual(await prisma.user.findUniqueOrThrow({ where:{id:userId} }),before);
  } finally { for (const flag of flags) await prisma.contentCollection.update({where:{id:flag.id},data:{enabled:flag.enabled}}); }
});
