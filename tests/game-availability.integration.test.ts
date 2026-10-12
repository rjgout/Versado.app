import { getWordSearchCandidates } from "../src/lib/wordSearch/content";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import { checkGameAvailability, canResumeLiveGame } from "../src/lib/gameAvailability";
import { canStartStudy } from "../src/lib/study/startAvailability";
import { getContentContext } from "../src/lib/contentCollections";
const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
const base = new URL(process.env.CONTENT_ACCESS_TEST_BASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || base.hostname !== "127.0.0.1" || process.env.DATABASE_URL !== database.href) throw new Error("Alleen eigen geïsoleerde content-testdatabase");
const prefix = `availability-${randomUUID()}`;
let userId: string, adminId: string, cookie: string, adminCookie: string, hiddenId: string, previewBook: string, previewChapter: string;
let flags: { id: string; enabled: boolean; visibleToUsers: boolean; publicationState: "LEGACY" | "DRAFT" | "PUBLISHED" }[];
let settings: Awaited<ReturnType<typeof prisma.gameSettings.findUnique>>;
let scopes: { gameKey: string; contentCollectionId: string }[];
async function request(path: string, method = "GET", body?: unknown, auth: string | null = cookie, origin = base.origin) {
  return fetch(new URL(path, base), { method, headers: { ...(auth ? { Cookie: auth } : {}), Origin: origin, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
}
async function account(admin = false) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@availability.test.invalid`, passwordHash: "synthetic", handle: randomUUID().slice(0,8), discriminator: "00", isAdmin: admin, activeContentCollectionId: "content_bom", contentLanguage: "nl", uiLanguage: "nl", hintBalance: 8, xpTotal: 100 } });
  return { id: user.id, cookie: `${SESSION_COOKIE}=${await createSessionToken(user.id)}` };
}
async function setSource(id: string) { await prisma.user.update({ where: { id: userId }, data: { activeContentCollectionId: id } }); }
async function scope(gameKey: string, contentCollectionId = "content_bom") { await prisma.gameContentScope.upsert({ where: { gameKey_contentCollectionId: { gameKey, contentCollectionId } }, create: { gameKey, contentCollectionId }, update: {} }); }
async function preserved(id: string) { return { user: await prisma.user.findUniqueOrThrow({ where: { id }, select: { activeContentCollectionId: true, contentLanguage: true, activeCourseId: true, xpTotal: true, hintBalance: true, currentStreak: true } }), contexts: await prisma.userStudyContext.findMany({ where: { userId: id } }), read: await prisma.readingSession.count({ where: { userId: id } }), progress: await prisma.contentProgress.count({ where: { userId: id } }), notes: await prisma.note.count({ where: { userId: id } }), xp: await prisma.xPTransaction.count({ where: { userId: id } }), streak: await prisma.streakActivity.count({ where: { userId: id } }) }; }
before(async () => {
  flags = await prisma.contentCollection.findMany({ select: { id: true, enabled: true, visibleToUsers: true, publicationState: true } });
  settings = await prisma.gameSettings.findUnique({ where: { id: "singleton" } });
  scopes = await prisma.gameContentScope.findMany({ select: { gameKey: true, contentCollectionId: true } });
  await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { enabled: true, visibleToUsers: true, publicationState: "LEGACY" } });
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", jigsawEnabled: true }, update: { jigsawEnabled: true, chapterGuessEnabled: true, wordSearchEnabled: true, wordGameEnabled: true, liveExercisesEnabled: true } });
  const user = await account(); userId = user.id; cookie = user.cookie; const admin = await account(true); adminId = admin.id; adminCookie = admin.cookie;
  for (const game of ["jigsaw", "word-search", "word-game", "chapter-guess", "live-exercises"]) await scope(game);
  hiddenId = (await prisma.contentCollection.findFirstOrThrow({ where: { work: "old-testament", editionKey: "otb", language: "nl" } })).id;
  await prisma.contentCollection.update({ where: { id: hiddenId }, data: { visibleToUsers: false, enabled: false, publicationState: "DRAFT" } });
  const book = await prisma.book.create({ data: { slug: prefix, key: prefix, name: "Synthetische preview", order: 10000, contentCollectionId: hiddenId } }); previewBook = book.key!;
  const chapter = await prisma.chapter.create({ data: { bookId: book.id, number: 1, order: 1, verses: { create: [{ number: 1, text: "ALLEEN EXPLICIETE BEHEERPREVIEW" }] } } }); previewChapter = chapter.id;
});
after(async () => {
  for (const { id, ...data } of flags) await prisma.contentCollection.update({ where: { id }, data });
  if (settings) await prisma.gameSettings.update({ where: { id: "singleton" }, data: settings });
  else await prisma.gameSettings.deleteMany({ where: { id: "singleton" } });
  await prisma.gameContentScope.deleteMany({ where: { contentCollectionId: "content_bom" } });
  await prisma.gameContentScope.createMany({ data: scopes.filter(s => s.contentCollectionId === "content_bom"), skipDuplicates: true });
  await prisma.$disconnect();
});
test("beheerinspectie: 401/403 vóór gegevens, admin ziet werkrelaties en alle flags zonder privédata", async () => {
  assert.equal((await request("/api/admin/content-inspection", "GET", undefined, null)).status, 401);
  assert.equal((await request("/api/admin/content-inspection")).status, 403);
  const before = await preserved(adminId);
  const response = await request("/api/admin/content-inspection", "GET", undefined, adminCookie); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json(); assert.equal(data.collections.length, await prisma.contentCollection.count()); assert.equal(data.works.length, await prisma.contentWork.count());
  const hidden = data.collections.find((c: { id: string }) => c.id === hiddenId); assert.equal(hidden.publicationState, "DRAFT"); assert.equal(hidden.enabled, false); assert.equal(hidden.visibleToUsers, false); assert.equal(hidden.previewHref, `/adminbackend/content-preview?collectionId=${hiddenId}`);
  assert.ok(data.collections.some((c: { work: string; managementHref: string }) => c.work === "fsy" && c.managementHref === "/adminbackend/content#fsy-management"));
  for (const key of ["passwordHash", "email", "token", "hintBalance", "DATABASE_URL", "ALLEEN EXPLICIETE"]) assert.ok(!JSON.stringify(data).includes(key));
  assert.deepEqual(await preserved(adminId), before);
});
test("exacte OTB-preview is alleen-lezen, ook DRAFT/disabled; normale read blijft geblokkeerd", async () => {
  const before = await preserved(adminId);
  const preview = await request(`/adminbackend/content-preview?collectionId=${hiddenId}&book=${previewBook}&chapter=1`, "GET", undefined, adminCookie);
  assert.equal(preview.status, 200); assert.ok((await preview.text()).includes("ALLEEN EXPLICIETE BEHEERPREVIEW"));
  assert.equal((await request(`/api/chapters/${previewChapter}`, "GET", undefined, adminCookie)).status, 404);
  const scripture = await prisma.chapter.findFirstOrThrow({ where: { book: { contentCollectionId: "content_bom" }, verses: { some: {} } }, select: { number: true, book: { select: { key: true } }, verses: { take: 1, select: { text: true } } } });
  const bom = await request(`/adminbackend/content-preview?collectionId=content_bom&book=${scripture.book.key}&chapter=${scripture.number}`, "GET", undefined, adminCookie);
  assert.equal(bom.status, 200); assert.ok((await bom.text()).includes(scripture.verses[0].text));
  const unsupported = await request("/adminbackend/content-preview?collectionId=content_fsy", "GET", undefined, adminCookie);
  assert.ok((await unsupported.text()).includes("Deze uitgave bevat nog geen beschikbare leestekst"));
  assert.deepEqual(await preserved(adminId), before);
  const denied = await request(`/adminbackend/content/inspect`); assert.ok(!(await denied.text()).includes("ALLEEN EXPLICIETE BEHEERPREVIEW"));
});
test("adminscopes: gedeelde GET/PUT adapterrestricties, CSRF, strict payload en idempotente instelling", async () => {
  const data = await (await request("/api/admin/game-scopes", "GET", undefined, adminCookie)).json();
  assert.ok(data.collections.find((c: { id: string; supportedGames: string[] }) => c.id === "content_bom").supportedGames.includes("word-search"));
  assert.ok(!data.collections.some((c: { id: string }) => c.id === "content_podcasts" || c.id === hiddenId));
  const body = { gameKey: "word-search", contentCollectionId: "content_bom", enabled: true };
  for (let i = 0; i < 2; i++) assert.equal((await request("/api/admin/game-scopes", "PUT", body, adminCookie)).status, 200);
  assert.equal(await prisma.gameContentScope.count({ where: { gameKey: "word-search", contentCollectionId: "content_bom" } }), 1);
  assert.equal((await request("/api/admin/game-scopes", "PUT", body, cookie)).status, 403);
  assert.equal((await request("/api/admin/game-scopes", "PUT", body, adminCookie, "https://evil.test")).status, 403);
  assert.equal((await request("/api/admin/game-scopes", "PUT", { ...body, userId }, adminCookie)).status, 400);
  for (const id of ["content_podcasts", hiddenId]) assert.equal((await request("/api/admin/game-scopes", "PUT", { ...body, contentCollectionId: id }, adminCookie)).status, 400);
});
test("Samen studeren: bestaande cursusadapter met echte units; lege en uitgeschakelde pools starten niets", async () => {
  const chapter = await prisma.chapter.findFirst({ where: { book: { contentCollectionId: "content_bom" }, exercises: { some: { status: "APPROVED" } } } });
  assert.ok(chapter, "Representatieve fixture heeft een echte goedgekeurde oefening");
  const empty = await prisma.course.create({ data: { slug: `${prefix}-empty`, name: "Lege cursus", type: "FREE_CHOICE", contentCollectionId: "content_bom" } });
  const full = await prisma.course.create({ data: { slug: `${prefix}-full`, name: "Bestaande cursusadapter", type: "FREE_CHOICE", contentCollectionId: "content_bom", chapters: { create: [{ chapterId: chapter.id, order: 1 }] } } });
  const before = await preserved(userId);
  assert.equal(await canStartStudy(empty.id), false); assert.equal(await canStartStudy(full.id), true);
  assert.equal((await request("/api/study/create", "POST", { courseId: empty.id })).status, 403);
  const valid = await request("/api/study/create", "POST", { courseId: full.id }); assert.equal(valid.status, 200);
  const game = await prisma.liveGame.findUniqueOrThrow({ where: { code: (await valid.json()).code }, include: { studySession: true } }); assert.equal(game.studySession?.courseId, full.id);
  await prisma.gameSettings.update({ where: { id: "singleton" }, data: { liveExercisesEnabled: false } });
  assert.equal(await canStartStudy(full.id), false); assert.equal((await request("/api/study/create", "POST", { courseId: full.id })).status, 403);
  await setSource("content_podcasts"); assert.equal(await canResumeLiveGame(game.code), true); await setSource("content_bom");
  await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { visibleToUsers: false } });
  assert.equal(await canResumeLiveGame(game.code), false);
  await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { visibleToUsers: true } });
  await prisma.gameSettings.update({ where: { id: "singleton" }, data: { liveExercisesEnabled: true } });
  assert.deepEqual(await preserved(userId), before);
});
test("Woordzoeker-pool bevat geen plaatsnamen van andere bronnen of stilzwijgende NL-metadata", async () => {
  const ownVerse = await prisma.verse.findFirstOrThrow({ where: { chapter: { book: { contentCollectionId: "content_bom" } } } });
  const foreignVerse = await prisma.verse.findFirstOrThrow({ where: { chapterId: previewChapter } });
  await prisma.place.create({ data: { slug: `${prefix}-own`, name: "QZXOWN", verses: { create: { verseId: ownVerse.id } } } });
  await prisma.place.create({ data: { slug: `${prefix}-foreign`, name: "QZXFOREIGN", verses: { create: { verseId: foreignVerse.id } } } });
  const nl = await getWordSearchCandidates("content_bom", "nl"); assert.ok(nl.some(w => w.normalized === "QZXOWN")); assert.ok(!nl.some(w => w.normalized === "QZXFOREIGN"));
  const en = await getWordSearchCandidates("content_bom_en", "en"); assert.ok(!en.some(w => ["QZXOWN","QZXFOREIGN"].includes(w.normalized)));
});
test("actieve-spellen-API leidt oorspronkelijke vaste bron niet uit gewijzigde scopes af", async () => {
  const game = await prisma.scrabbleGame.create({ data: { player1Id: userId, player2Id: adminId, status: "PENDING", board: "[]", bag: "[]", player1Rack: "[]", player2Rack: "[]" } });
  await prisma.gameContentScope.deleteMany({ where: { gameKey: "scrabble" } }); await scope("scrabble", "content_podcasts");
  await setSource("content_podcasts");
  const response = await request("/api/activity-status"); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.invitesSent.find((item: { id: string }) => item.id === game.id).contentCollectionId, "content_bom");
  await setSource("content_bom");
});
test("settings uit en ontbrekende scope: UI-contract en directe nieuwe start beide geblokkeerd, ook admins", async () => {
  const before = await preserved(userId);
  await prisma.gameSettings.update({ where: { id: "singleton" }, data: { jigsawEnabled: false } });
  assert.equal((await checkGameAvailability("jigsaw", "content_bom")).reason, "disabled");
  assert.ok(!(await getContentContext(userId)).gameKeys.includes("jigsaw"));
  for (const auth of [cookie, adminCookie]) assert.equal((await request("/api/jigsaw-v2", "POST", { action: "start", imageIndex: 0, pieceCount: 6, difficulty: "DISCOVERER" }, auth)).status, 403);
  await prisma.gameSettings.update({ where: { id: "singleton" }, data: { jigsawEnabled: true } });
  await prisma.gameContentScope.deleteMany({ where: { gameKey: "jigsaw", contentCollectionId: "content_bom" } });
  assert.equal((await checkGameAvailability("jigsaw", "content_bom")).reason, "scope");
  assert.deepEqual(await preserved(userId), before); await scope("jigsaw");
});
test("hidden/DRAFT/disabled en ongeschikte bron blokkeren alle nieuwe starts zonder fallback", async () => {
  for (const flag of [{ visibleToUsers: false }, { publicationState: "DRAFT" as const }, { enabled: false }]) {
    await prisma.contentCollection.update({ where: { id: "content_bom" }, data: flag });
    assert.equal((await checkGameAvailability("word-search", "content_bom")).reason, "content");
    assert.equal((await request("/api/word-search", "POST", { difficulty: "EASY" })).status, 403);
    await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { visibleToUsers: true, enabled: true, publicationState: "LEGACY" } });
  }
  await prisma.contentCollection.update({ where: { id: "content_podcasts" }, data: { enabled: true, visibleToUsers: true } });
  await scope("word-game", "content_podcasts"); await setSource("content_podcasts");
  assert.equal((await checkGameAvailability("word-game", "content_podcasts")).reason, "unsupported");
  const before = await preserved(userId); assert.equal((await request("/api/word-game")).status, 403); assert.deepEqual(await preserved(userId), before);
  await setSource("content_bom");
});
test("scope is geen inhoudsbewijs: lege hoofdstukpool geeft geen partij", async () => {
  const before = await prisma.chapterGuessGame.count({ where: { userId } });
  assert.equal((await checkGameAvailability("chapter-guess", "content_bom", 99999)).reason, "pool");
  const approved = await prisma.exercise.findMany({ where: { status: "APPROVED", chapter: { book: { contentCollectionId: "content_bom" } } }, select: { id: true } });
  try {
    await prisma.exercise.updateMany({ where: { id: { in: approved.map(e => e.id) } }, data: { status: "DRAFT" } });
    assert.equal((await checkGameAvailability("live-exercises", "content_bom")).reason, "pool");
    assert.ok(!(await getContentContext(userId)).gameKeys.includes("live-exercises"));
  } finally { await prisma.exercise.updateMany({ where: { id: { in: approved.map(e => e.id) } }, data: { status: "APPROVED" } }); }
  assert.equal(await prisma.chapterGuessGame.count({ where: { userId } }), before);
});
test("alle gewone start-API's weigeren een podcastbron zonder mutaties of BOM-fallback", async () => {
  await setSource("content_podcasts");
  const before = await preserved(userId);
  const rowsBefore = { live: await prisma.liveGame.count(), puzzle: await prisma.puzzleSession.count(), chapter: await prisma.chapterGuessGame.count(), word: await prisma.wordGame.count(), search: await prisma.wordSearchGame.count(), arcade: await prisma.quickMissionaryRun.count(), solo: await prisma.alleskennerSoloRun.count(), scrabble: await prisma.scrabbleGame.count(), challenge: await prisma.challenge.count() };
  for (const [path, body] of [
    ["/api/live/create", { chapterId: previewChapter }], ["/api/live/create-family-game", { minutes: 15, diceMode: "DIGITAL" }],
    ["/api/live/create-chapter-guess", { level: "BEGINNER", questionCount: 5 }], ["/api/live/create-alleskenner", {}],
    ["/api/chapter-guess/start", { level: "BEGINNER", questionCount: 5 }], ["/api/alleskenner/solo", { mode: "PRACTICE" }],
    ["/api/alleskenner/seasons", { name: "Test", joinAsPlayer: true }], ["/api/scrabble", { friendUserId: adminId }],
    ["/api/challenges", { friendUserId: adminId, chapterId: previewChapter }], ["/api/word-search", { difficulty: "EASY" }],
    ["/api/snelle-zendeling/runs", {}], ["/api/snelle-zendeling/together", {}], ["/api/mysteries/001a/progress", {}],
  ] as const) assert.equal((await request(path, "POST", body)).status, 403, path);
  assert.deepEqual({ live: await prisma.liveGame.count(), puzzle: await prisma.puzzleSession.count(), chapter: await prisma.chapterGuessGame.count(), word: await prisma.wordGame.count(), search: await prisma.wordSearchGame.count(), arcade: await prisma.quickMissionaryRun.count(), solo: await prisma.alleskennerSoloRun.count(), scrabble: await prisma.scrabbleGame.count(), challenge: await prisma.challenge.count() }, rowsBefore);
  assert.deepEqual(await preserved(userId), before); await setSource("content_bom");
});
test("geldige puzzelstart, dubbele aanvraag en hervatten na bronwissel/settings-uit behouden poging en economie", async () => {
  const before = await preserved(userId);
  const payload = { action: "start", imageIndex: 0, pieceCount: 6, difficulty: "DISCOVERER" };
  const legacySwitch = await request("/api/content-context", "PUT", { contentCollectionId: "content_bom", location: { pathname: "/jigsaw", search: "" } });
  assert.equal(legacySwitch.status, 200); assert.equal((await legacySwitch.json()).outcome.kind, "stay");
  const responses = await Promise.all([request("/api/jigsaw-v2", "POST", payload), request("/api/jigsaw-v2", "POST", payload)]);
  for (const response of responses) assert.equal(response.status, 200);
  const [a,b] = await Promise.all(responses.map(r => r.json())); assert.equal(a.id, b.id);
  await setSource("content_podcasts"); await prisma.gameSettings.update({ where: { id: "singleton" }, data: { jigsawEnabled: false } });
  const resume = await request("/api/jigsaw-v2", "POST", { action: "resume", sessionId: a.id }); assert.equal(resume.status, 200); assert.equal((await resume.json()).id, a.id);
  assert.equal((await request("/api/jigsaw-v2", "POST", { action: "resume", sessionId: a.id }, adminCookie)).status, 404);
  await setSource("content_bom"); await prisma.gameSettings.update({ where: { id: "singleton" }, data: { jigsawEnabled: true } });
  assert.deepEqual(await preserved(userId), before);
});
test("Woordzoeker: dubbele eerste creatie, oorspronkelijke collectie bij hervatten en cross-user blokkade", async () => {
  const before = await preserved(userId);
  const responses = await Promise.all([request("/api/word-search", "POST", { difficulty: "EASY" }), request("/api/word-search", "POST", { difficulty: "EASY" })]);
  for (const response of responses) assert.equal(response.status, 200);
  const [a,b] = await Promise.all(responses.map(r => r.json())); assert.equal(a.id,b.id);
  await setSource("content_podcasts");
  assert.equal((await request(`/api/word-search/${a.id}`)).status, 200);
  assert.equal((await request(`/api/word-search/${a.id}`, "GET", undefined, adminCookie)).status, 404);
  await setSource("content_bom"); assert.deepEqual(await preserved(userId), before);
});
