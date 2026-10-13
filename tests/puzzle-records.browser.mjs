// Echte browser: persoonlijke records, hintcategorieën, vriendenranglijst en privacy (fase 4).
//   DATABASE_URL=$LEARNING_TEST_DATABASE_URL SESSION_SECRET=... PUZZLE_TEST_BASE_URL=http://localhost:3107 \
//   PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs npx tsx tests/puzzle-records.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { startSoloPuzzle, applySoloAction } from "../src/lib/puzzle/solo.ts";
import { cachedPuzzleGeometry } from "../src/lib/puzzle/geometryCache.ts";
import { jigsawQuestionsForStory } from "../src/lib/jigsawQuestions.ts";
import { createMatch, respondToMatchInvite, beginMatchAttempt, resumeMatchPuzzle, applyMatchAction } from "../src/lib/puzzle/match.ts";

if (!process.env.LEARNING_TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Een expliciete geïsoleerde testdatabase is verplicht");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const users = []; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "versado:jigsaw-v2-session";
try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", jigsawEnabled: true }, update: { jigsawEnabled: true } });
  const person = async () => {
    const user = await prisma.user.create({ data: { email: `rec-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Rb${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), timeZone: "Europe/Amsterdam" } });
    users.push(user.id); return user;
  };
  const open = async (user, path, viewport = { width: 1000, height: 900 }, init) => {
    const context = await browser.newContext({ viewport, serviceWorkers: "block" });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    if (init) await context.addInitScript(init.fn, init.arg);
    const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + path, { waitUntil: "networkidle" });
    return { context, page, errors };
  };
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const [a, b] = [await person(), await person()];
  await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });

  // Solo oplossen (echte servicelaag, dezelfde code als de API) tot de vraagstap.
  const solve = async (user, { hint = false, delayMs = 0 } = {}) => {
    let state = await startSoloPuzzle(user.id, 3, 6, "ADVENTURER", "nl");
    const act = async (operation) => { state = await applySoloAction(user.id, state.id, state.version, randomUUID(), operation, "nl"); };
    if (hint) await act({ kind: "hint", hint: "PREVIEW", confirmPersonal: true });
    if (delayMs) await sleep(delayMs);
    const g = cachedPuzzleGeometry(6, state.seed, state.geometryVersion);
    for (const piece of g.pieces) await act({ kind: "move", groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row });
    for (const [x, y] of [[0, 1], [1, 2], [0, 3], [3, 4], [4, 5]]) await act({ kind: "connect", a: x, b: y });
    assert.equal(state.status, "COMPLETED");
    return state;
  };
  // De vraagstap openen en goed beantwoorden via de echte interface.
  const answerInBrowser = async (user, state) => {
    const session = await open(user, "/jigsaw", { width: 1000, height: 900 }, { fn: ({ id, key }) => { try { localStorage.setItem(key, id); localStorage.setItem(`${key}:question`, id); } catch {} }, arg: { id: state.id, key: KEY } });
    const q = jigsawQuestionsForStory(state.story).find((item) => item.text.nl === state.question.text);
    await session.page.getByRole("button", { name: q.options.nl[0], exact: true }).click();
    await session.page.getByRole("button", { name: "Antwoord bevestigen" }).click();
    await session.page.getByRole("heading", { name: "Puzzel compleet!" }).waitFor({ timeout: 20000 });
    return session;
  };

  // 1-3. Eerste Solo-puzzel zonder hints: geldige vraag → nieuw persoonlijk record getoond.
  const first = await solve(a, { delayMs: 1500 });
  const s1 = await answerInBrowser(a, first);
  await s1.page.locator("[data-record-notice]").waitFor({ timeout: 10000 });
  assert.match(await s1.page.locator("[data-record-notice]").innerText(), /Nieuw persoonlijk record!/);
  const variantId = first && (await prisma.puzzleSession.findUniqueOrThrow({ where: { id: first.id } })).variantId;
  const slowMs = (await prisma.puzzleBestRecord.findFirstOrThrow({ where: { userId: a.id, variantId, mode: "SOLO", hintCategory: "NO_HINTS" } })).elapsedMs;
  // 4-5. Sneller opnieuw: het record verbetert; een tragere poging geeft geen melding.
  const fast = await solve(a);
  const s2 = await answerInBrowser(a, fast);
  await s2.page.locator("[data-record-notice]").waitFor({ timeout: 10000 });
  const fastMs = (await prisma.puzzleBestRecord.findFirstOrThrow({ where: { userId: a.id, variantId, mode: "SOLO", hintCategory: "NO_HINTS" } })).elapsedMs;
  assert.ok(fastMs < slowMs, "de snellere tijd verving het record");
  const slower = await solve(a, { delayMs: 2500 });
  const s3 = await answerInBrowser(a, slower);
  assert.equal(await s3.page.locator("[data-record-notice]").count(), 0, "een langzamere poging wordt niet als record gevierd");
  assert.equal((await prisma.puzzleBestRecord.findFirstOrThrow({ where: { userId: a.id, variantId, mode: "SOLO", hintCategory: "NO_HINTS" } })).elapsedMs, fastMs);
  // 6-7. Met een hint: aparte categorie.
  const hinted = await solve(a, { hint: true });
  const s4 = await answerInBrowser(a, hinted);
  await s4.page.locator("[data-record-notice]").waitFor({ timeout: 10000 });
  assert.match(await s4.page.locator("[data-record-notice]").innerText(), /Met hints/);
  assert.equal(await prisma.puzzleBestRecord.count({ where: { userId: a.id, variantId, mode: "SOLO" } }), 2, "zonder en met hints zijn twee records");

  // Persoonlijk overzicht: beide categorieën, 320 px zonder overflow.
  const mine = await open(a, "/jigsaw/records", { width: 320, height: 700 });
  await mine.page.getByText("Zonder hints").first().waitFor({ timeout: 15000 });
  assert.ok(await mine.page.locator("li").count() >= 2);
  assert.equal(await overflow(mine.page), 0, "geen horizontale overflow op 320 px");
  await mine.page.addStyleTag({ content: "html{font-size:200% !important}" });
  assert.equal(await overflow(mine.page), 0, "geen horizontale overflow bij 200% tekst");
  await mine.page.getByRole("button", { name: "Met hints", exact: true }).first().click();
  await mine.page.waitForTimeout(600);
  assert.equal(await mine.page.getByText("Zonder hints").count() <= 1, true);

  // 8-12. Vriendenranglijst en privacy.
  const bs = await solve(b); const bAnswer = await answerInBrowser(b, bs);
  const lb = `/jigsaw/records/${variantId}?mode=SOLO&cat=NO_HINTS`;
  const viewer = await open(a, lb);
  await viewer.page.getByText("Vriendenranglijst").first().waitFor({ timeout: 15000 });
  assert.equal(await viewer.page.getByText(`${b.handle}`).count(), 0, "b deelt nog niet: a ziet b niet");
  assert.ok(await viewer.page.getByText("Jij").count() >= 1, "a ziet zichzelf altijd");
  assert.ok(await viewer.page.getByText("Je records zijn privé").count() >= 1, "uitleg over de eigen privacy");
  // b zet delen aan via de echte privacy-instelling.
  const bSettings = await open(b, "/profile?view=privacy");
  const toggle = bSettings.page.getByRole("switch", { name: /Puzzelrecords delen met vrienden/ });
  await toggle.waitFor({ timeout: 15000 });
  assert.equal(await toggle.isChecked(), false, "standaard uit");
  assert.equal(await bSettings.page.getByRole("switch", { name: /Prestaties delen/ }).isChecked(), false);
  await toggle.click(); await bSettings.page.waitForTimeout(800);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).sharePuzzleRecords, true);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).shareAchievements, false, "los van shareAchievements");
  await viewer.page.reload({ waitUntil: "networkidle" });
  await viewer.page.getByText(b.handle).first().waitFor({ timeout: 15000 });
  // De API geeft voor a nu b's record; een niet-bevriend account krijgt niets.
  const stranger = await person();
  const strangerPage = await open(stranger, lb);
  await strangerPage.page.getByText("Vriendenranglijst").first().waitFor({ timeout: 15000 });
  assert.equal(await strangerPage.page.getByText(b.handle).count(), 0, "een niet-vriend ziet b niet");
  // b zet delen weer uit: direct weg bij a.
  await toggle.click(); await bSettings.page.waitForTimeout(800);
  await viewer.page.reload({ waitUntil: "networkidle" });
  await viewer.page.getByText("Vriendenranglijst").first().waitFor({ timeout: 15000 });
  assert.equal(await viewer.page.getByText(b.handle).count(), 0, "uitzetten verbergt b onmiddellijk");

  // 13-15. Wedstrijd voltooien zonder de vraag; wedstrijdrecord blijft gescheiden van Solo.
  const matchId = await createMatch(a.id, 3, 6, "ADVENTURER", [b.id], "ASYNC");
  await respondToMatchInvite(b.id, matchId, true); await beginMatchAttempt(a.id, matchId); await beginMatchAttempt(b.id, matchId);
  let ms = await resumeMatchPuzzle(a.id, matchId, "nl");
  const g = cachedPuzzleGeometry(6, ms.seed, ms.geometryVersion);
  for (const piece of g.pieces) ms = await applyMatchAction(a.id, matchId, ms.version, randomUUID(), { kind: "move", groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row }, "nl");
  for (const [x, y] of [[0, 1], [1, 2], [0, 3], [3, 4], [4, 5]]) ms = await applyMatchAction(a.id, matchId, ms.version, randomUUID(), { kind: "connect", a: x, b: y }, "nl");
  const match = await open(a, `/jigsaw/wedstrijd/${matchId}`, { width: 360, height: 700 });
  await match.page.locator("[data-record-notice]").waitFor({ timeout: 15000 });
  assert.equal(await prisma.puzzleBestRecord.count({ where: { userId: a.id, variantId, mode: "MATCH", hintCategory: "NO_HINTS" } }), 1);
  assert.equal(await prisma.puzzleBestRecord.count({ where: { userId: a.id, variantId, mode: "SOLO" } }), 2, "Solo ongewijzigd");
  const mineMatch = await open(a, "/jigsaw/records");
  await mineMatch.page.getByRole("button", { name: "Tegen elkaar", exact: true }).first().click();
  await mineMatch.page.waitForTimeout(800);
  assert.equal(await mineMatch.page.locator("li").count(), 1, "alleen het wedstrijdrecord");
  assert.deepEqual([...s1.errors, ...s2.errors, ...s3.errors, ...s4.errors, ...mine.errors, ...viewer.errors, ...bSettings.errors, ...match.errors, ...mineMatch.errors], []);
  void bAnswer;
  console.log(JSON.stringify({ records: "ok", slowMs, fastMs }));
} finally {
  await browser.close();
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
}
