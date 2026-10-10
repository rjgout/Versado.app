// Echte browser + API + geïsoleerde database. Geen gemockte sessieresponses.
// npm run test:puzzle:integration -- --browser
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry.ts";
import { puzzleWorktable } from "../src/lib/puzzle/worktable.ts";
import { fitCamera } from "../src/lib/puzzle/viewport.ts";
import { dayKeyInZone } from "../src/lib/timeZone.ts";
import { addDays } from "../src/lib/dates.ts";
import { jigsawCatalog } from "../src/lib/jigsawGame.ts";
import { nl } from "../src/lib/i18n/messages/nl.ts";
import { de } from "../src/lib/i18n/messages/de.ts";

if (!process.env.LEARNING_TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Een expliciete geïsoleerde testdatabase is verplicht");
const database = new URL(process.env.LEARNING_TEST_DATABASE_URL);
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_puzzle_test") throw new Error("Gebruik de lokale wegwerpdatabase van test:puzzle:integration");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
let user;
try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { jigsawEnabled: true }, update: { jigsawEnabled: true } });
  user = await prisma.user.create({ data: {
    email: `browser-puzzle-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Browser${randomUUID().slice(0, 6)}`, discriminator: "00",
    activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(),
    timeZone: "Europe/Amsterdam", currentStreak: 4, longestStreak: 4,
    lastStudyDate: addDays(dayKeyInZone(new Date(), "Europe/Amsterdam"), -1), lastStudyTimeZone: "Europe/Amsterdam",
  } });
  // Playwright kan een request achter de doorgeef-serviceworker niet afbreken.
  // Blokkeer alleen in deze test die worker zodat de transportfout echt optreedt.
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: "block" });
  await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
  const page = await context.newPage(); const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const api = async (body) => {
    const response = await context.request.post(`${base}/api/jigsaw-v2`, { data: body });
    assert.equal(response.status(), 200, await response.text()); return response.json();
  };
  const tiles = page.locator('section[aria-labelledby="jigsaw-image-choice"] button[aria-pressed]');
  const search = page.getByRole("textbox", { name: "Zoek een afbeelding" });
  const start = page.getByRole("button", { name: "Start de puzzel", exact: true });
  const canvas = page.locator("canvas");
  const back = page.locator("[data-subpage-back-bar] button");
  async function choose(number) {
    await search.fill(String(number));
    await tiles.filter({ has: page.getByText(`Afbeelding ${number}`, { exact: true }) }).click();
    await page.getByRole("button", { name: "6", exact: true }).click();
    const response = page.waitForResponse((r) => r.url().endsWith("/api/jigsaw-v2") && r.request().postDataJSON()?.action === "start");
    await start.click(); const state = await (await response).json();
    if (state.status === "ACTIVE") await canvas.waitFor();
    else await page.getByRole("img", { name: "Voltooide legpuzzel" }).waitFor();
    return state;
  }
  await page.goto(`${base}/jigsaw`); await search.waitFor();
  assert.equal(await tiles.count(), 24); assert.equal(await start.isDisabled(), true);
  const allImages = [];
  for (let i = 0; i < 9; i++) {
    allImages.push(...await tiles.locator("img").evaluateAll((images) => images.map((image) => new URL(image.src).pathname)));
    if (i < 8) await page.getByRole("button", { name: "Volgende afbeeldingen" }).click();
  }
  assert.equal(allImages.length, 216); assert.equal(new Set(allImages).size, 216);
  assert.deepEqual(allImages, jigsawCatalog.map((item) => item.url));
  assert.equal(await page.getByRole("button", { name: "Volgende afbeeldingen" }).isDisabled(), true);
  await search.fill("Kinderverhaal 1");
  assert.ok(await tiles.count() > 0);
  if (await page.getByRole("button", { name: "Volgende afbeeldingen" }).isVisible()) {
    const firstSearchPage = await tiles.allTextContents();
    await page.getByRole("button", { name: "Volgende afbeeldingen" }).click();
    const nextSearchPage = await tiles.allTextContents();
    assert.ok(nextSearchPage.every((text) => !firstSearchPage.includes(text)));
  }
  await search.fill("geen-bestaande-afbeelding"); assert.equal(await tiles.count(), 0); assert.equal(await start.isDisabled(), true);
  await search.fill("216"); assert.equal(await tiles.count(), 1); assert.equal(await start.isDisabled(), true);
  let state = await choose(216); assert.equal(state.image, jigsawCatalog[215].url);
  const firstId = state.id;
  await back.click(); await search.waitFor();
  assert.equal(new URL(page.url()).pathname, "/jigsaw");
  state = await choose(216); assert.equal(state.id, firstId, "terug vanuit bord bewaart voortgang");
  await page.getByRole("button", { name: "Puzzelbordmenu" }).click();
  await page.getByRole("button", { name: "Andere puzzel kiezen" }).click();
  await search.waitFor(); const different = await choose(30);
  assert.notEqual(different.id, firstId); assert.equal(different.image, jigsawCatalog[29].url);
  await page.getByRole("button", { name: "Puzzelbordmenu" }).click();
  await page.getByRole("button", { name: "Andere puzzel kiezen" }).click();
  state = await choose(216); assert.equal(state.id, firstId, "lopende variant wordt hervat");

  async function prepareFinalDrag(state) {
    const geometry = createPuzzleGeometry(state.pieceCount, state.seed, state.geometryVersion);
    for (const piece of geometry.pieces.filter((piece) => piece.id !== 5)) state = await api({ action: "act", sessionId: state.id, version: state.version, actionId: randomUUID(), operation: { kind: "move", groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row } });
    for (const [a, b] of [[0, 1], [1, 2], [0, 3], [3, 4]]) state = await api({ action: "act", sessionId: state.id, version: state.version, actionId: randomUUID(), operation: { kind: "connect", a, b } });
    await page.reload(); await canvas.waitFor();
    return { state, geometry };
  }
  async function finalDrag(state, geometry) {
    const bounds = await canvas.boundingBox(); assert.ok(bounds);
    // Alleen de expliciete menuactie past de hele werktafel in beeld.
    await page.getByRole("button", { name: "Puzzelbordmenu" }).click();
    await page.getByRole("button", { name: "Alles passend tonen" }).click();
    const camera = fitCamera({ width: bounds.width, height: bounds.height }, puzzleWorktable(geometry).bounds);
    const loose = state.snapshot.groups.find((group) => group.id === "p5"); assert.ok(loose);
    const point = (x, y) => ({ x: bounds.x + camera.x + x * camera.scale, y: bounds.y + camera.y + y * camera.scale });
    const from = point(loose.x + .5, loose.y + .5); const to = point(5.5, 4.5);
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up();
    await page.getByRole("img", { name: "Voltooide legpuzzel" }).waitFor();
    assert.equal(await canvas.count(), 0, "bord en contouren verdwijnen");
    await page.getByRole("button", { name: "Verder", exact: true }).waitFor();
  }
  let prepared = await prepareFinalDrag(state);
  let lostCompletion = false;
  await page.route("**/api/jigsaw-v2", async (route) => {
    if (!lostCompletion && route.request().postDataJSON()?.operation?.kind === "connect") { lostCompletion = true; await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await finalDrag(prepared.state, prepared.geometry); assert.equal(lostCompletion, true);
  await page.unroute("**/api/jigsaw-v2");
  await page.reload(); await page.getByRole("img", { name: "Voltooide legpuzzel" }).waitFor();
  await back.click(); await search.waitFor();
  state = await choose(216);
  await page.getByRole("img", { name: "Voltooide legpuzzel" }).waitFor();
  await page.getByRole("button", { name: "Verder", exact: true }).click();
  await page.getByRole("heading", { name: "Nog één vraag" }).waitFor();
  await back.click(); await page.getByRole("heading", { name: "Puzzel compleet!" }).waitFor();
  await page.getByRole("button", { name: "Verder", exact: true }).click();
  await page.getByRole("heading", { name: "Nog één vraag" }).waitFor();
  await page.reload(); await page.getByRole("heading", { name: "Nog één vraag" }).waitFor();
  const firstRow = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: firstId } });
  const correct = JSON.parse(firstRow.optionOrder).indexOf(0);
  const options = page.locator("section.card button");
  await options.nth(correct).click();
  // Eén verloren antwoordresponse: echte server commit, daarna transport afbreken.
  let dropped = false;
  await page.route("**/api/jigsaw-v2", async (route) => {
    if (!dropped && route.request().postDataJSON()?.action === "answer") { dropped = true; await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "Antwoord bevestigen" }).click();
  await page.getByRole("button", { name: "Dezelfde puzzel opnieuw spelen" }).waitFor();
  assert.equal(dropped, true, "antwoordresponse is daadwerkelijk verloren gegaan");
  assert.ok((await page.getByRole("status").allTextContents()).some((text) => text.includes("Goed!")));
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).currentStreak, 5);
  await page.unroute("**/api/jigsaw-v2");
  const replayResponse = page.waitForResponse((r) => r.url().endsWith("/api/jigsaw-v2") && r.request().postDataJSON()?.action === "start");
  await page.getByRole("button", { name: "Dezelfde puzzel opnieuw spelen" }).click();
  const replay = await (await replayResponse).json(); assert.notEqual(replay.id, firstId); assert.equal(replay.status, "ACTIVE");
  assert.equal(replay.image, state.image); assert.equal(replay.snapshot.connections.length, 0);
  await back.click(); await search.waitFor();
  state = await choose(216); assert.equal(state.id, replay.id, "terug vanuit replay hervat nieuwe poging");
  prepared = await prepareFinalDrag(replay); await finalDrag(prepared.state, prepared.geometry);
  // Historisch exact dezelfde vraag opnieuw: kies opnieuw in de nieuwe sessie.
  await prisma.puzzleSession.update({ where: { id: replay.id }, data: { questionId: firstRow.questionId, optionOrder: firstRow.optionOrder } });
  await page.reload(); await page.getByRole("button", { name: "Verder", exact: true }).click();
  await options.nth(correct).click(); await page.getByRole("button", { name: "Antwoord bevestigen" }).click();
  await page.getByRole("button", { name: "Nog een puzzel", exact: true }).waitFor();
  assert.ok((await page.getByRole("status").allTextContents()).includes(nl.jigsaw.correct));
  assert.equal(await page.getByText(/Je reeks stond vandaag al goed/).count(), 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).currentStreak, 5);
  assert.equal(await prisma.streakActivity.count({ where: { userId: user.id, key: { startsWith: "jigsaw:v2:" } } }), 2);
  mkdirSync("/tmp/versado-puzzle-browser", { recursive: true });
  await page.screenshot({ path: "/tmp/versado-puzzle-browser/result.png", fullPage: true });
  await back.click(); await search.waitFor();
  assert.equal(new URL(page.url()).pathname, "/jigsaw", "terug vanuit resultaat blijft in puzzelkeuze");
  await page.goto(`${base}/jigsaw`); await search.waitFor(); assert.equal(await canvas.count(), 0, "afgeronde lokale sessie opent de kiezer");
  await page.setViewportSize({ width: 390, height: 844 });
  await choose(31); await canvas.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "/tmp/versado-puzzle-browser/mobile-board.png", fullPage: true });
  await page.setViewportSize({ width: 320, height: 700 });
  await prisma.user.update({ where: { id: user.id }, data: { uiLanguage: "de" } });
  await page.reload(); await canvas.waitFor();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.getByRole("button", { name: de.jigsaw.boardMenu }).click();
  await page.getByRole("button", { name: de.jigsaw.chooseAnother }).click();
  await page.getByRole("textbox", { name: de.jigsaw.searchImages }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "320px / 200% / Duits zonder horizontale overflow");
  await page.screenshot({ path: "/tmp/versado-puzzle-browser/german-320-200.png", fullPage: true });
  assert.deepEqual(errors, [], "geen browser-runtimefouten");
  // Toegangsvoorwaarden via de echte API, ook voor zichtbare/selecteerbare content.
  await prisma.gameSettings.update({ where: { id: "singleton" }, data: { jigsawEnabled: false } });
  assert.equal((await context.request.post(`${base}/api/jigsaw-v2`, { data: { action: "start", imageId: jigsawCatalog[215].url, pieceCount: 6, difficulty: "ADVENTURER" } })).status(), 403);
  await prisma.gameSettings.update({ where: { id: "singleton" }, data: { jigsawEnabled: true } });
  const restricted = await prisma.contentCollection.findFirstOrThrow({ where: { gameScopes: { none: { gameKey: "jigsaw" } } } });
  await prisma.user.update({ where: { id: user.id }, data: { activeContentCollectionId: restricted.id } });
  assert.equal((await context.request.post(`${base}/api/jigsaw-v2`, { data: { action: "start", imageId: jigsawCatalog[215].url, pieceCount: 6, difficulty: "ADVENTURER" } })).status(), 403);
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.post(`${base}/api/jigsaw-v2`, { data: { action: "resume", sessionId: firstId } })).status(), 401);
  await anonymous.close();
  console.log("Browser: alle 216 paginaresultaten, zoeken+pagineren, selectie/start buiten 20, andere puzzel, hervatten, echte laatste drag, afbeelding/Verder/vraag/herladen, verloren completion- en antwoordresponses, felicitatie, replay/historische vraag, dagregels, navigatie, 390px en 320px/200%/Duits: groen.");
} finally {
  await browser.close();
  if (user) await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}
