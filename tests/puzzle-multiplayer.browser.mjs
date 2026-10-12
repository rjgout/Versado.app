// Echte browser tegen een draaiende instance en een testdatabase (geen mocks).
//   LEARNING_TEST_DATABASE_URL=... DATABASE_URL=$LEARNING_TEST_DATABASE_URL PUZZLE_TEST_BASE_URL=http://localhost:3151 \
//   PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs npx tsx tests/puzzle-multiplayer.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { jigsawCatalog } from "../src/lib/jigsawGame.ts";
import { createCoopSession, respondToCoopInvite } from "../src/lib/puzzle/coop.ts";
import { createMatch, respondToMatchInvite, beginMatchAttempt } from "../src/lib/puzzle/match.ts";

if (!process.env.LEARNING_TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Een expliciete geïsoleerde testdatabase is verplicht");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3151";
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const users = [];
const report = {};
try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", jigsawEnabled: true }, update: { jigsawEnabled: true } });
  const person = async () => {
    const user = await prisma.user.create({ data: { email: `mp-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Mp${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), timeZone: "Europe/Amsterdam" } });
    users.push(user.id); return user;
  };
  const [a, b] = [await person(), await person()];
  await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
  const open = async (user, viewport, path, extra = {}) => {
    const context = await browser.newContext({ viewport, serviceWorkers: "block", ...extra });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + path, { waitUntil: "networkidle" });
    return { context, page, errors };
  };
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // --- Samen: 300 stukken, twee spelers, 320 px breed en desktop
  const sessionId = await createCoopSession(a.id, jigsawCatalog[0].url, 300, "ADVENTURER", [b.id]);
  const invite = await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId, toUserId: b.id } });
  await respondToCoopInvite(b.id, invite.id, true);
  const pa = await open(a, { width: 1200, height: 800 }, `/jigsaw/samen/${sessionId}`);
  const pb = await open(b, { width: 320, height: 640 }, `/jigsaw/samen/${sessionId}`);
  for (const p of [pa, pb]) await p.page.waitForSelector("canvas", { timeout: 20000 });
  assert.equal(await overflow(pb.page), 0, "geen horizontale overflow op 320 px");
  // A sleept een groep; B moet de lock-omtrek/aanwezigheid zien (tekst "houdt een groep vast").
  const canvas = pa.page.locator("canvas").first(); const box = await canvas.boundingBox();
  // Meet framekosten tijdens het slepen van een groep op een bord met 300 stukken.
  await pa.page.evaluate(() => { window.__frames = []; let last = performance.now(); const loop = (now) => { window.__frames.push(now - last); last = now; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
  let moved = false;
  for (let attempt = 0; attempt < 40 && !moved; attempt++) {
    const x = box.x + 20 + (attempt * 29) % (box.width - 40), y = box.y + 20 + (attempt * 47) % (box.height - 40);
    await pa.page.mouse.move(x, y); await pa.page.mouse.down();
    for (let i = 1; i <= 15; i++) await pa.page.mouse.move(x + i * 3, y + i * 2);
    const holding = await prisma.puzzleLock.count({ where: { sessionId } });
    await pa.page.mouse.up(); moved = holding > 0;
    await pa.page.waitForTimeout(150);
  }
  assert.ok(moved, "een groep pakken legt een lock vast in de database");
  await pa.page.waitForTimeout(600);
  const frames = await pa.page.evaluate(() => window.__frames.slice(5));
  frames.sort((x, y) => x - y);
  report.samen300 = { frames: frames.length, medianMs: +frames[Math.floor(frames.length / 2)].toFixed(1), p95Ms: +frames[Math.floor(frames.length * 0.95)].toFixed(1) };
  assert.equal(await prisma.puzzleLock.count({ where: { sessionId } }), 0, "na loslaten is de lock vrij");
  const version = (await prisma.puzzleSession.findUniqueOrThrow({ where: { id: sessionId } })).version;
  assert.ok(version > 1, "de sleepactie is opgeslagen");
  await pb.page.waitForTimeout(800);
  await pb.page.screenshot({ path: "/tmp/mp-samen-320.png" });
  assert.deepEqual([...pa.errors, ...pb.errors], [], "geen paginafouten");

  // --- Tegen elkaar: uitnodiging, accepteren, beginnen, klok; 320 px en 200% tekst
  const matchId = await createMatch(a.id, jigsawCatalog[1].url, 12, "ADVENTURER", [b.id], "ASYNC");
  const inv = await open(b, { width: 320, height: 640 }, `/jigsaw/wedstrijd/${matchId}`);
  await inv.page.getByRole("button", { name: /Meedoen|Join|Beitreten|Participer|Unirme|Unirse/i }).first().click();
  await inv.page.waitForTimeout(1200);
  await respondToMatchInvite(b.id, matchId, true).catch(() => {});
  await inv.page.reload({ waitUntil: "networkidle" });
  assert.equal(await overflow(inv.page), 0, "geen horizontale overflow (wedstrijd, 320 px)");
  await inv.page.addStyleTag({ content: "html{font-size:200% !important}" });
  const wide = await inv.page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 5).map((el) => `${el.tagName}.${el.className}`.slice(0, 120)));
  assert.equal(await overflow(inv.page), 0, "geen horizontale overflow bij 200% tekst: " + wide.join(" | "));
  await inv.page.screenshot({ path: "/tmp/mp-match-invite-320.png" });
  await inv.page.getByRole("button", { name: /Begin nu|Start now|Jetzt|Commencer|Empezar/i }).click();
  await inv.page.waitForSelector("canvas", { timeout: 20000 });
  await inv.page.waitForTimeout(2200);
  const clock = await inv.page.locator("p.font-mono").first().innerText();
  assert.match(clock, /^\d+:\d\d$/, "serverklok zichtbaar");
  assert.notEqual(clock, "0:00", "klok loopt");
  assert.equal(await overflow(inv.page), 0);
  await inv.page.screenshot({ path: "/tmp/mp-match-play-320.png" });
  assert.deepEqual(inv.errors, []);
  report.match = { clock };
  // --- Via de keuzepagina: een live wedstrijd aanmaken, accepteren in het overzicht, starten en spelen
  const c = await person(); const d = await person();
  await prisma.friendship.create({ data: { senderId: c.id, receiverId: d.id, status: "ACCEPTED" } });
  const host = await open(c, { width: 1200, height: 900 }, "/jigsaw");
  await host.page.getByRole("button", { name: /^Tegen elkaar/ }).click();
  await host.page.getByRole("button", { name: /^Live/ }).click();
  await host.page.getByRole("button", { name: /Vrienden kiezen/ }).click();
  await host.page.getByRole("dialog").locator("li", { hasText: d.handle }).getByRole("button", { name: "Kies" }).click();
  await host.page.getByRole("button", { name: /Sluiten|Close/ }).first().click();
  await host.page.locator('section[aria-labelledby="jigsaw-image-choice"] button[aria-pressed]').first().click();
  await host.page.screenshot({ path: "/tmp/mp-chooser.png", fullPage: true });
  await host.page.getByRole("button", { name: /Maak wedstrijd/ }).click({ timeout: 5000 });
  await host.page.waitForURL(/\/jigsaw\/wedstrijd\//, { timeout: 15000 });
  const liveId = host.page.url().split("/").pop();
  const guest = await open(d, { width: 390, height: 800 }, "/jigsaw");
  await guest.page.getByRole("button", { name: "Meedoen" }).first().click();
  await guest.page.waitForURL(/\/jigsaw\/wedstrijd\//, { timeout: 15000 });
  // De organisator ziet de geaccepteerde speler live in de lobby (realtime-signaal) en start.
  const startButton = host.page.getByRole("button", { name: "Start wedstrijd" });
  await startButton.waitFor({ timeout: 15000 });
  for (let i = 0; i < 40 && await startButton.isDisabled(); i++) await host.page.waitForTimeout(250);
  assert.equal(await startButton.isDisabled(), false, "lobby toont de geaccepteerde speler zonder verversen");
  await startButton.click();
  await Promise.all([host.page, guest.page].map((p) => p.waitForSelector("canvas", { timeout: 25000 })));
  const startRows = await prisma.puzzleMatchParticipant.findMany({ where: { matchId: liveId }, select: { status: true, startedAt: true } });
  assert.ok(startRows.every((row) => row.status === "PLAYING"), "beide spelers spelen");
  assert.equal(new Set(startRows.map((row) => row.startedAt?.getTime())).size, 1, "gezamenlijk servermoment als start");
  assert.deepEqual([...host.errors, ...guest.errors], []);
  report.liveMatch = { id: liveId, players: startRows.length };

  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
}
