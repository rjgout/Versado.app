// Echte browser: expliciete puzzelnavigatie (geen browsergeschiedenis) en de wedstrijdflow na voltooien.
//   DATABASE_URL=$LEARNING_TEST_DATABASE_URL SESSION_SECRET=... PUZZLE_TEST_BASE_URL=http://localhost:3107 \
//   PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs npx tsx tests/puzzle-navigation.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { jigsawCatalog } from "../src/lib/jigsawGame.ts";
import { createCoopSession, respondToCoopInvite } from "../src/lib/puzzle/coop.ts";
import { createMatch, respondToMatchInvite, beginMatchAttempt, resumeMatchPuzzle, applyMatchAction } from "../src/lib/puzzle/match.ts";
import { cachedPuzzleGeometry } from "../src/lib/puzzle/geometryCache.ts";
import { jigsawQuestionsForStory } from "../src/lib/jigsawQuestions.ts";

if (!process.env.LEARNING_TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Een expliciete geïsoleerde testdatabase is verplicht");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const users = [];
try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", jigsawEnabled: true }, update: { jigsawEnabled: true } });
  const person = async () => {
    const user = await prisma.user.create({ data: { email: `nav-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Nv${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), timeZone: "Europe/Amsterdam" } });
    users.push(user.id); return user;
  };
  const open = async (user, path, viewport = { width: 1000, height: 800 }) => {
    const context = await browser.newContext({ viewport, serviceWorkers: "block" });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + path, { waitUntil: "networkidle" });
    return { context, page, errors };
  };
  const barCount = (page) => page.locator("[data-subpage-back-bar]").count();
  const clickBack = (page) => page.getByRole("button", { name: /Terug|Back/ }).first().click();
  const historyLength = (page) => page.evaluate(() => history.length);
  const [a, b, c] = [await person(), await person(), await person()];
  await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
  await prisma.friendship.create({ data: { senderId: a.id, receiverId: c.id, status: "ACCEPTED" } });

  // 1. De catalogus gaat altijd naar Spelen, ook zonder geschiedenis.
  const catalog = await open(a, "/jigsaw");
  assert.equal(await barCount(catalog.page), 1, "precies één terugbalk");
  await clickBack(catalog.page); await catalog.page.waitForURL(/\/live$/, { timeout: 15000 });

  // 2. Samen: rechtstreeks geopende werktafel → terug naar het overzicht, zonder de puzzel te verlaten of een extra geschiedenisitem.
  const sessionId = await createCoopSession(a.id, jigsawCatalog[0].url, 24, "ADVENTURER", [b.id]);
  const invite = await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId, toUserId: b.id } });
  await respondToCoopInvite(b.id, invite.id, true);
  const coop = await open(a, `/jigsaw/samen/${sessionId}`);
  assert.equal(await barCount(coop.page), 1, "de werktafel heeft de terugbalk");
  const before = await historyLength(coop.page);
  await clickBack(coop.page); await coop.page.waitForURL(/\/jigsaw$/, { timeout: 15000 });
  assert.ok(await historyLength(coop.page) <= before, "terug voegt geen geschiedenisitem toe");
  assert.equal(await prisma.puzzleSessionParticipant.count({ where: { sessionId, userId: a.id } }), 1, "terug verlaat de gezamenlijke puzzel niet");
  assert.equal((await prisma.puzzleSession.findUniqueOrThrow({ where: { id: sessionId } })).status, "ACTIVE");
  // Het overzicht toont de actieve puzzel met "Verder puzzelen".
  await coop.page.getByRole("link", { name: "Verder puzzelen" }).first().waitFor({ timeout: 15000 });

  // 3. Wedstrijd: uitnodiging → terug naar het overzicht.
  const matchId = await createMatch(a.id, jigsawCatalog[1].url, 6, "ADVENTURER", [b.id, c.id], "ASYNC");
  const invited = await open(b, `/jigsaw/wedstrijd/${matchId}`, { width: 360, height: 700 });
  assert.equal(await barCount(invited.page), 1);
  await clickBack(invited.page); await invited.page.waitForURL(/\/jigsaw$/, { timeout: 15000 });
  assert.equal((await prisma.puzzleMatchParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId: b.id } } })).status, "INVITED", "terug wijst een uitnodiging niet af");
  await respondToMatchInvite(b.id, matchId, true); await respondToMatchInvite(c.id, matchId, true);
  await beginMatchAttempt(a.id, matchId); await beginMatchAttempt(b.id, matchId);

  // 4. Wedstrijdwerktafel → terug naar het overzicht; de klok loopt door en de poging is niet gereset.
  const play = await open(b, `/jigsaw/wedstrijd/${matchId}`, { width: 360, height: 700 });
  await play.page.waitForSelector("canvas", { timeout: 20000 });
  assert.equal(await barCount(play.page), 1, "ook de werktafel houdt de terugbalk");
  const startedBefore = (await prisma.puzzleMatchParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId: b.id } } })).startedAt;
  await clickBack(play.page); await play.page.waitForURL(/\/jigsaw$/, { timeout: 15000 });
  const rowB = await prisma.puzzleMatchParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId: b.id } } });
  assert.equal(rowB.status, "PLAYING"); assert.equal(rowB.startedAt.getTime(), startedBefore.getTime(), "geen nieuwe poging of klokreset");

  // 5. A legt de puzzel (server) en kiest bewust een fout antwoord later; zijn tijd moet geldig blijven.
  const solve = async (user) => {
    let state = await resumeMatchPuzzle(user.id, matchId, "nl");
    const geometry = cachedPuzzleGeometry(state.pieceCount, state.seed, state.geometryVersion);
    for (const piece of geometry.pieces) state = await applyMatchAction(user.id, matchId, state.version, randomUUID(), { kind: "move", groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row }, "nl");
    for (const [x, y] of [[0, 1], [1, 2], [0, 3], [3, 4], [4, 5]]) state = await applyMatchAction(user.id, matchId, state.version, randomUUID(), { kind: "connect", a: x, b: y }, "nl");
    return state;
  };
  await solve(a);
  const done = await open(a, `/jigsaw/wedstrijd/${matchId}`, { width: 360, height: 700 });
  await done.page.locator("[data-official-time]").first().waitFor({ timeout: 15000 });
  assert.equal(await done.page.getByText("Verder puzzelen").count(), 0, "afgerond: geen 'verder puzzelen'");
  const official = (await prisma.puzzleMatchParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId: a.id } } })).elapsedMs;
  // De vraag staat los: openen → voltooide afbeelding met officiële tijd → vraag → terug → afbeelding → terug → overzicht.
  await done.page.getByRole("button", { name: "Beantwoord de vraag" }).click();
  await done.page.locator("[data-official-time]").first().waitFor({ timeout: 15000 });
  await done.page.reload({ waitUntil: "networkidle" });
  await done.page.locator("[data-official-time]").first().waitFor({ timeout: 15000 });
  await done.page.getByRole("button", { name: /Doorgaan|Verder/ }).last().click();
  await done.page.getByRole("heading", { name: "Nog één vraag" }).waitFor({ timeout: 15000 });
  await clickBack(done.page);
  await done.page.locator("[data-official-time]").first().waitFor({ timeout: 15000 });
  await done.page.getByRole("button", { name: /Doorgaan|Verder/ }).last().click();
  const question = jigsawQuestionsForStory((await prisma.puzzleSession.findFirstOrThrow({ where: { matchId, ownerId: a.id }, include: { variant: { include: { definition: true } } } })).variant.definition.storyNumber).find((q) => true);
  const state = await resumeMatchPuzzle(a.id, matchId, "nl");
  const q = jigsawQuestionsForStory(state.story).find((item) => item.text.nl === state.question.text);
  const wrongText = state.question.options.find((text) => text !== q.options.nl[0]);
  await done.page.getByRole("button", { name: wrongText, exact: true }).click();
  await done.page.getByRole("button", { name: /Antwoord bevestigen|Bevestig/ }).click();
  await done.page.locator("[data-question-status]").waitFor({ timeout: 15000 });
  assert.match(await done.page.locator("[data-question-status]").innerText(), /Niet het juiste antwoord/);
  const after = await prisma.puzzleMatchParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId: a.id } } });
  assert.equal(after.status, "FINISHED", "een fout antwoord maakt de puzzel niet ongeldig");
  assert.equal(after.elapsedMs, official, "de officiële tijd blijft gelijk");
  assert.ok(await done.page.locator("[data-official-time]").count() >= 1);
  void question;

  // 6. Overzicht: klaar-maar-wachten staat bij Wachten zonder 'Verder puzzelen'; afgerond bij Afgerond.
  const overview = await open(a, "/jigsaw");
  await overview.page.getByText("Wachten op anderen").first().waitFor({ timeout: 15000 });
  assert.equal(await overview.page.locator("a", { hasText: "Verder puzzelen" }).count(), 1, "alleen de lopende gezamenlijke puzzel is hervatbaar");
  await beginMatchAttempt(c.id, matchId); await solve(b); await solve(c);
  await overview.page.reload({ waitUntil: "networkidle" });
  await overview.page.getByText("Afgerond", { exact: true }).first().waitFor({ timeout: 15000 });
  await overview.page.getByRole("link", { name: /Bekijk resultaat|Vraag beantwoorden/ }).first().waitFor();
  // 7. Een realtime statusupdate (deelnemer wordt FINISHED) haalt de lopende werktafel/voltooiingsstap niet weg.
  const second = await createMatch(a.id, jigsawCatalog[2].url, 6, "ADVENTURER", [b.id], "ASYNC");
  await respondToMatchInvite(b.id, second, true); await beginMatchAttempt(a.id, second); await beginMatchAttempt(b.id, second);
  const live = await open(a, `/jigsaw/wedstrijd/${second}`, { width: 360, height: 700 });
  await live.page.waitForSelector("canvas", { timeout: 20000 });
  let state2 = await resumeMatchPuzzle(a.id, second, "nl");
  const geometry2 = cachedPuzzleGeometry(state2.pieceCount, state2.seed, state2.geometryVersion);
  for (const piece of geometry2.pieces) state2 = await applyMatchAction(a.id, second, state2.version, randomUUID(), { kind: "move", groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row }, "nl");
  for (const [x, y] of [[0, 1], [1, 2], [0, 3], [3, 4], [4, 5]]) state2 = await applyMatchAction(a.id, second, state2.version, randomUUID(), { kind: "connect", a: x, b: y }, "nl");
  assert.equal((await prisma.puzzleMatchParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId: second, userId: a.id } } })).status, "FINISHED");
  await live.page.waitForTimeout(3000);
  assert.ok(await live.page.locator("canvas").count() >= 1, "de werktafel blijft staan na de statusupdate");
  assert.equal(await live.page.locator("[data-question-status]").count(), 0);
  assert.deepEqual([...catalog.errors, ...coop.errors, ...invited.errors, ...play.errors, ...done.errors, ...overview.errors, ...live.errors], []);
  console.log(JSON.stringify({ navigatie: "ok", officieleTijdMs: official }));
} finally {
  await browser.close();
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
}
