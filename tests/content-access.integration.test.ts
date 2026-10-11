// Echte HTTP-routes en PostgreSQL; weigert iedere niet-eigen testdatabase.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import { getContentAvailability } from "../src/lib/contentAccess";

const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
const base = new URL(process.env.CONTENT_ACCESS_TEST_BASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || !["127.0.0.1", "localhost"].includes(base.hostname) || process.env.DATABASE_URL !== database.href) throw new Error("Gebruik uitsluitend scripts/content-architecture/test-isolated.mjs");
const prefix = randomUUID();
let normal: string, admin: string, cookie: string, adminCookie: string;
type Fixture = { collectionId: string; courseId: string; chapterId: string; verseId: string; exerciseId: string; draftId: string; lessonId: string };
const cases = new Map<string, Fixture>();
async function account(isAdmin: boolean) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@content-access.test.invalid`, passwordHash: "x", handle: `C${randomUUID().slice(0, 8)}`, discriminator: "00", isAdmin, hintBalance: 5, uiLanguage: "nl", timeZone: "UTC" } });
  return user.id;
}
async function request(path: string, method = "GET", body?: unknown, auth: string | null = cookie) {
  return fetch(new URL(path, base), { method, headers: { ...(auth ? { Cookie: auth } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
}
async function fixture(name: string, enabled: boolean, visibleToUsers: boolean, language = "nl") {
  const collectionId = `content-access-${prefix}-${name}`;
  await prisma.contentCollection.create({ data: { id: collectionId, slug: collectionId, name, icon: "", enabled, visibleToUsers, work: name === "english" ? null : `access-${prefix}`, editionKey: name, language } });
  const book = await prisma.book.create({ data: { slug: collectionId, name, key: collectionId, order: 1, contentCollectionId: collectionId } });
  const chapter = await prisma.chapter.create({ data: { bookId: book.id, number: 1, order: 1 } });
  const verse = await prisma.verse.create({ data: { chapterId: chapter.id, number: 1, text: `PRIVETEKST-${name}-${prefix}` } });
  const exercise = await prisma.exercise.create({ data: { chapterId: chapter.id, order: 1, type: "FILL_BLANK", status: "APPROVED", verseRef: "1:1", prompt: "Tekst ____", answers: '["antwoord"]', hint: "Bestaande hint" } });
  const draft = await prisma.exercise.create({ data: { chapterId: chapter.id, order: 2, type: "FILL_BLANK", status: "DRAFT", verseRef: "1:1", prompt: "Ongepubliceerde vraag", answers: '["geheim"]' } });
  const course = await prisma.course.create({ data: { slug: collectionId, type: "READING_LESSONS", name, contentCollectionId: collectionId } });
  const lesson = await prisma.courseLesson.create({ data: { courseId: course.id, chapterId: chapter.id, order: 1, startVerse: 1, endVerse: 1 } });
  await prisma.person.create({ data: { slug: collectionId, name, description: `PRIVETEKST-${name}-${prefix}`, contentCollectionId: collectionId } });
  const result = { collectionId, courseId: course.id, chapterId: chapter.id, verseId: verse.id, exerciseId: exercise.id, draftId: draft.id, lessonId: lesson.id };
  cases.set(name, result); return result;
}
before(async () => {
  normal = await account(false); admin = await account(true);
  cookie = `${SESSION_COOKIE}=${await createSessionToken(normal)}`;
  adminCookie = `${SESSION_COOKIE}=${await createSessionToken(admin)}`;
  await fixture("visible", true, true);
  await fixture("hidden", true, false);
  await fixture("disabled", false, true);
  await fixture("english", true, true, "en");
});
// De runner bewaart deze uitsluitend synthetische fixtures tot de dump-/herstelproef
// en verwijdert daarna zijn eigen volledige wegwerpcontainer.
after(async () => { await prisma.$disconnect(); });

test("normale legacytekst en tweede taal blijven bereikbaar; ontbrekende bronnen niet", async () => {
  for (const name of ["visible", "english"]) {
    const f = cases.get(name)!;
    assert.equal(await getContentAvailability({ isAdmin: false }, f.collectionId), true);
    const response = await request(`/api/chapters/${f.chapterId}`);
    assert.equal(response.status, 200); assert.ok(JSON.stringify(await response.json()).includes(`PRIVETEKST-${name}`));
  }
  assert.equal(await getContentAvailability({ isAdmin: true }, "missing", "admin-preview"), false);
  assert.equal(await getContentAvailability({ isAdmin: true }, null, "admin-preview"), false);
  assert.equal((await request(`/api/chapters/${cases.get("visible")!.chapterId}`, "GET", undefined, null)).status, 401);
});

for (const name of ["hidden", "disabled"]) test(`${name}: directe reads en mutations geweigerd; privégegevens blijven byte-identiek`, async () => {
  const f = cases.get(name)!;
  await prisma.bookmark.create({ data: { userId: normal, verseId: f.verseId } });
  await prisma.highlight.create({ data: { userId: normal, verseId: f.verseId, color: "yellow" } });
  await prisma.note.create({ data: { userId: normal, verseId: f.verseId, text: "Privénotitie die behouden moet blijven" } });
  const issued = await prisma.exerciseSession.create({ data: { userId: normal, chapterId: f.chapterId, contentKey: `${f.collectionId}#1`, exerciseIds: JSON.stringify([f.exerciseId]) } });
  const snapshot = async () => ({
    bookmarks: await prisma.bookmark.findMany({ where: { userId: normal, verseId: f.verseId } }),
    highlights: await prisma.highlight.findMany({ where: { userId: normal, verseId: f.verseId } }),
    notes: await prisma.note.findMany({ where: { userId: normal, verseId: f.verseId } }),
    progress: await prisma.contentProgress.findMany({ where: { userId: normal } }),
    sessions: await prisma.readingSession.count({ where: { userId: normal } }),
    issued: await prisma.exerciseSession.findMany({ where: { userId: normal } }),
    attempts: await prisma.exerciseAttempt.count({ where: { userId: normal } }),
    xp: await prisma.xPTransaction.count({ where: { userId: normal } }),
    streak: await prisma.streakActivity.count({ where: { userId: normal } }),
    hints: (await prisma.user.findUniqueOrThrow({ where: { id: normal } })).hintBalance,
  });
  const before = await snapshot();
  const probes: [string, string, unknown?][] = [
    [`/api/chapters/${f.chapterId}`, "GET"], [`/api/chapters/${f.chapterId}/audio-languages`, "GET"], [`/api/persons/${f.collectionId}`, "GET"],
    [`/api/chapters/${f.chapterId}/read`, "POST"], ["/api/reading-sessions", "POST", { chapterId: f.chapterId, isAdmin: true }],
    ["/api/live/create", "POST", { chapterId: f.chapterId, isAdmin: true }],
    [`/api/verses/${f.verseId}/bookmark`, "POST"], [`/api/verses/${f.verseId}/highlight`, "POST"],
    [`/api/verses/${f.verseId}/note`, "PUT", { text: "Gewijzigd" }], [`/api/verses/${f.verseId}/note`, "PUT", { text: "" }],
    [`/api/exercises/${f.exerciseId}/check`, "POST", { given: ["antwoord"] }], [`/api/exercises/${f.exerciseId}/hint`, "POST"],
    [`/api/chapters/${f.chapterId}/submit`, "POST", { sessionId: issued.id, answers: [{ exerciseId: f.exerciseId, given: ["antwoord"] }] }],
    ["/api/reading-lessons/submit", "POST", { lessonId: f.lessonId, sessionId: null, answers: [] }],
  ];
  for (const [path, method, body] of probes) {
    const response = await request(path, method, body); assert.equal(response.status, 404, path);
    assert.ok(!(await response.text()).includes(`PRIVETEKST-${name}`), path);
  }
  for (const path of [`/lesson/${f.chapterId}`, `/reading-lesson/${f.lessonId}`, `/courses/${f.courseId}/chapter/${f.chapterId}`]) {
    const response = await request(path);
    assert.ok(response.status < 400, path);
    const html = await response.text();
    assert.ok(response.headers.has("location") || html.includes("NEXT_REDIRECT"), `Leesroute moet navigeren: ${path}`);
    assert.ok(!html.includes(`PRIVETEKST-${name}`), path);
  }
  assert.equal((await request("/api/practice/submit", "POST", { answers: [{ exerciseId: f.exerciseId, given: ["antwoord"] }] })).status, 400);
  const bookmarks = await request("/api/bookmarks"); assert.equal(bookmarks.status, 200);
  assert.ok(!JSON.stringify(await bookmarks.json()).includes(f.verseId));
  assert.deepEqual(await snapshot(), before);
  assert.equal(await getContentAvailability({ isAdmin: false }, f.collectionId, "admin-preview"), false);
  assert.equal((await request(`/api/chapters/${f.chapterId}`, "GET", undefined, adminCookie)).status, 200);
});

test("conceptoefeningen lekken geen antwoord of betaalde hint", async () => {
  const f = cases.get("visible")!;
  const balance = (await prisma.user.findUniqueOrThrow({ where: { id: normal } })).hintBalance;
  for (const suffix of ["check", "hint"]) assert.equal((await request(`/api/exercises/${f.draftId}/${suffix}`, "POST", suffix === "check" ? { given: ["geheim"] } : undefined)).status, 404);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: normal } })).hintBalance, balance);
  const response = await request(`/api/chapters/${f.chapterId}`);
  const view = await response.json(); assert.equal(view.exercises.length, 1); assert.ok(!JSON.stringify(view).includes("geheim"));
});

test("bestaande zichtbare annotaties, bewaren en expliciet lezen blijven werken zonder extra XP", async () => {
  const f = cases.get("visible")!;
  const xpBefore = (await prisma.user.findUniqueOrThrow({ where: { id: normal } })).xpTotal;
  for (const kind of ["bookmark", "highlight"]) assert.equal((await request(`/api/verses/${f.verseId}/${kind}`, "POST")).status, 200);
  assert.equal((await request(`/api/verses/${f.verseId}/note`, "PUT", { text: "Bewaard" })).status, 200);
  assert.equal((await request("/api/reading-sessions", "POST", { chapterId: f.chapterId })).status, 200);
  for (let i = 0; i < 2; i++) assert.equal((await request(`/api/chapters/${f.chapterId}/read`, "POST")).status, 200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: normal } })).xpTotal, xpBefore);
  const progress = await prisma.contentProgress.findFirstOrThrow({ where: { userId: normal, lastChapterId: f.chapterId } });
  assert.equal(progress.contentKey, `${f.collectionId}#1`); assert.equal(progress.readStatus, "READ");
  assert.equal(await prisma.streakActivity.count({ where: { userId: normal, key: `read:${progress.contentKey}` } }), 1);
  const live = await request("/api/live/create", "POST", { chapterId: f.chapterId }); assert.equal(live.status, 200);
  const game = await prisma.liveGame.findUniqueOrThrow({ where: { code: (await live.json()).code } }); assert.equal(game.chapterId, f.chapterId);
});
