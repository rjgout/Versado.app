// Alleen eigen wegwerpdatabase: echte uitslagberekening, API, heropenen en fullscreenpresentatie.
import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { dailyTextFixture, dailyTextTestEnvironment } from "./fixtures/daily-text.ts";
import { addDays, weekStartKey } from "../src/lib/dates.ts";
import { getWeeklyResult, acknowledgeWeeklyResult } from "../src/lib/weeklyResult.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";

const base = dailyTextTestEnvironment(), fixture = await dailyTextFixture();
const current = weekStartKey(), ended = addDays(current, -7), older = addDays(current, -21);
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const ids = [], output = "/tmp/versado-weekly-result-browser"; mkdirSync(output, { recursive: true });
const group = await prisma.leagueGroup.create({ data: { weekStart: ended, tier: "SILVER", index: randomInt(100000, 1000000), size: 30, memberCount: 30, promotePercent: 20 } });
try {
  await prisma.leagueSettings.upsert({ where: { id: "singleton" }, update: { groupSize: 30, demoteCount: 3 }, create: { id: "singleton", groupSize: 30, demoteCount: 3, activityRules: "{}" } });
  for (let i = 0; i < 30; i++) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@weekly-result.test.invalid`, passwordHash: "synthetic", handle: `Divisie${randomUUID().slice(0,8)}`, discriminator: "00", emailVerifiedAt: new Date(), onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), avatarCharacterId: "nephi", companion: i === 0 ? "VERA" : i === 29 ? "VARO" : "NOVI", activeContentCollectionId: fixture.own.id, kompasOffersEnabled: false, emailNotificationsEnabled: false, pushNotificationsEnabled: false, uiLanguage: i === 15 ? "fr" : "nl" } });
    ids.push(user.id);
    await prisma.weeklyScore.create({ data: { userId: user.id, weekStart: ended, tier: "SILVER", xp: 1000 - i, groupId: group.id } });
  }
  await prisma.weeklyScore.create({ data: { userId: ids[0], weekStart: older, tier: "BRONZE", xp: 1 } });
  await prisma.weeklyScore.create({ data: { userId: ids[0], weekStart: current, tier: "GOLD", xp: 42 } });
  const before = await prisma.weeklyScore.findMany({ where: { userId: { in: ids } }, orderBy: { id: "asc" } });
  assert.equal((await getWeeklyResult(ids[0])).outcome, "promoted");
  assert.equal((await getWeeklyResult(ids[15])).outcome, "stayed");
  assert.equal((await getWeeklyResult(ids[29])).outcome, "demoted");
  // Een langere afwezigheid verliest de laatste uitslag niet; lopende weken tellen nooit mee.
  assert.equal((await getWeeklyResult(ids[0], new Date(`${addDays(current, 28)}T12:00:00Z`))).weekStart, current);
  assert.equal(await getWeeklyResult(ids[0], new Date(`${older}T00:00:00Z`)), null);
  await acknowledgeWeeklyResult(ids[0], current);
  assert.equal((await getWeeklyResult(ids[0])).weekStart, ended);
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(`${base}/api/competition/result`)).status(), 401); await anonymous.close();
  for (const [index, title, character, state] of [[0, "Je bent gepromoveerd!", "vera", "celebrate"], [15, "Tu restes dans ta division", "novi", "success"], [29, "Je bent gedegradeerd", "varo", "encourage"]]) {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(ids[index]), url: base }]);
    const page = await context.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
    const api = await context.request.get(`${base}/api/competition/result`); assert.equal(api.status(), 200);
    assert.equal((await api.json()).result.weekStart, ended);
    if (index === 0) {
      // Alleen de leesactiviteit stelt uit; een open reeksviering blokkeert de uitslag niet.
      await prisma.user.update({ where: { id: ids[0] }, data: { currentStreak: 7, longestStreak: 7, lastStudyDate: new Date().toISOString().slice(0, 10), lastStudyTimeZone: "UTC", timeZone: "UTC" } });
      await prisma.streakDay.create({ data: { userId: ids[0], dayKey: new Date().toISOString().slice(0, 10), status: "STUDIED" } });
      await Promise.all([page.waitForResponse(response => response.url().endsWith("/api/streak/continuation")), page.goto(`${base}/scripture/${fixture.ownChapter.id}`)]);
      assert.ok(page.url().includes("/scripture/"));
      assert.equal(await page.locator("[data-weekly-result]:modal").count(), 0);
      assert.equal((await prisma.streakDay.findFirstOrThrow({ where: { userId: ids[0] } })).celebrationShownAt, null);
      await page.goto(`${base}/dashboard`);
    } else if (index === 15) {
      // De app staat al open wanneer een uitslag beschikbaar komt. Een falende
      // reeks-API mag dit onafhankelijke scherm niet tegenhouden.
      await prisma.weeklyScore.update({ where: { userId_weekStart: { userId: ids[index], weekStart: ended } }, data: { resultSeenAt: new Date() } });
      await page.route("**/api/streak/continuation", route => route.fulfill({ status: 503, json: {} }));
      await page.clock.install();
      await Promise.all([page.waitForResponse(response => response.url().endsWith("/api/competition/result")), page.goto(`${base}/dashboard`)]);
      assert.equal(await page.locator("[data-weekly-result]:modal").count(), 0);
      await page.evaluate(() => { document.body.dataset.weeklyOnlineTest = "same-page"; });
      await prisma.weeklyScore.update({ where: { userId_weekStart: { userId: ids[index], weekStart: ended } }, data: { resultSeenAt: null } });
      await Promise.all([page.waitForResponse(response => response.url().endsWith("/api/competition/result")), page.clock.fastForward(30_000)]);
      assert.equal(await page.locator("body").getAttribute("data-weekly-online-test"), "same-page");
    } else await page.goto(`${base}/dashboard`);
    const dialog = page.locator("[data-weekly-result]:modal");
    await dialog.getByRole("heading", { name: title, exact: true }).waitFor();
    assert.ok((await dialog.locator("img").evaluateAll(images => images.map(img => decodeURIComponent(img.src)))).some(src => src.includes(`${character}-${state}.webp`)));
    if (index === 29) {
      await page.reload();
      await dialog.getByRole("heading", { name: title, exact: true }).waitFor();
    }
    await page.screenshot({ path: `${output}/${index}-normal.png` });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    assert.equal(await dialog.evaluate(el => Math.abs(el.getBoundingClientRect().width - innerWidth) < 2), true);
    await page.screenshot({ path: `${output}/${index}-large-top.png` });
    await dialog.locator("footer button").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${index}-large-bottom.png` });
    await Promise.all([page.waitForResponse(response => response.url().endsWith("/api/competition/result") && response.request().method() === "POST" && response.ok()), dialog.locator("footer button").click()]);
    assert.equal(await getWeeklyResult(ids[index]), null);
    if (index === 0) {
      await page.getByRole("heading", { name: "Je reeks leeft voort", exact: true }).waitFor();
      await page.getByRole("button", { name: "Sluiten", exact: true }).click();
    }
    await Promise.all([page.waitForResponse(response => response.url().endsWith("/api/competition/result") && response.request().method() === "GET"), page.reload()]);
    assert.equal(await page.locator("[data-weekly-result]:modal").count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }
  const after = await prisma.weeklyScore.findMany({ where: { userId: { in: ids } }, orderBy: { id: "asc" } });
  const withoutSeen = rows => rows.map(({ resultSeenAt, ...row }) => row);
  assert.deepEqual(withoutSeen(after), withoutSeen(before));
  assert.equal(await prisma.leagueGroup.count({ where: { id: group.id, memberCount: 30 } }), 1);
  console.log("Divisie-uitslag: promotie, behoud, degradatie; eigen gids; onafhankelijk van reeksviering en reeks-API; beschikbaar tijdens online sessie zonder navigatie; activiteiten uitgesteld; heropenen en eenmaal sluiten; 320px/200%/Frans; XP en deelname ongewijzigd.");
} finally { await browser.close(); await prisma.user.deleteMany({ where: { id: { in: ids } } }); await prisma.leagueGroup.delete({ where: { id: group.id } }); await prisma.$disconnect(); }
