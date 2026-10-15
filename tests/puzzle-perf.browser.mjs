// Renderprestaties van de gezamenlijke werktafel bij 150 en 300 stukken (headless Chromium, geen fysiek toestel).
//   DATABASE_URL=$LEARNING_TEST_DATABASE_URL SESSION_SECRET=... PUZZLE_TEST_BASE_URL=http://localhost:3107 \
//   PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs npx tsx tests/puzzle-perf.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { jigsawCatalog } from "../src/lib/jigsawGame.ts";
import { createCoopSession, respondToCoopInvite, getCoopState } from "../src/lib/puzzle/coop.ts";

if (!process.env.LEARNING_TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Een expliciete geïsoleerde testdatabase is verplicht");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const users = []; const report = [];
const q = (values, p) => { const s = [...values].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };
try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", jigsawEnabled: true }, update: { jigsawEnabled: true } });
  const person = async () => { const user = await prisma.user.create({ data: { email: `perf-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Pf${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), timeZone: "Europe/Amsterdam" } }); users.push(user.id); return user; };
  for (const pieces of [150, 300]) {
    const [a, b] = [await person(), await person()];
    await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
    const id = await createCoopSession(a.id, jigsawCatalog[5].url, pieces, "ADVENTURER", [b.id]);
    await respondToCoopInvite(b.id, (await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId: id, toUserId: b.id } })).id, true);
    const snapshotBytes = Buffer.byteLength(JSON.stringify((await getCoopState(a.id, id)).snapshot));
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: "block" });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(a.id), url: base }]);
    const page = await context.newPage(); let sent = 0, received = 0, bytesIn = 0, bytesOut = 0;
    page.on("websocket", (ws) => { ws.on("framesent", (f) => { sent++; bytesOut += (f.payload?.length ?? 0); }); ws.on("framereceived", (f) => { received++; bytesIn += (f.payload?.length ?? 0); }); });
    const t0 = Date.now(); await page.goto(`${base}/jigsaw/samen/${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas", { timeout: 30000 });
    const firstRenderMs = Date.now() - t0;
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.__frames = []; let last = performance.now(); const loop = (now) => { window.__frames.push(now - last); last = now; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    const canvas = page.locator("canvas").first(); const box = await canvas.boundingBox();
    // Een aantal sleepbewegingen (grijp, sleep, loslaten) verspreid over het bord; elke geslaagde greep legt een lock en een commit.
    let drags = 0; const dragMs = [];
    for (let attempt = 0; attempt < 40 && drags < 12; attempt++) {
      const x = box.x + 16 + (attempt * 37) % (box.width - 32), y = box.y + 16 + (attempt * 53) % (box.height - 32);
      const before = await prisma.puzzleSession.findUniqueOrThrow({ where: { id }, select: { version: true } });
      const start = Date.now();
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(x + i * 4, y + i * 3);
      await page.mouse.up(); await page.waitForTimeout(250);
      const after = await prisma.puzzleSession.findUniqueOrThrow({ where: { id }, select: { version: true } });
      if (after.version > before.version) { drags++; dragMs.push(Date.now() - start - 250); }
    }
    const frames = (await page.evaluate(() => window.__frames.slice(3)));
    const heap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
    const startReconnect = Date.now();
    await context.setOffline(true); await page.waitForTimeout(500); await context.setOffline(false);
    await page.waitForFunction(() => document.querySelector("canvas") !== null);
    const reconnectMs = Date.now() - startReconnect - 500;
    const row = { pieces, snapshotKB: +(snapshotBytes / 1024).toFixed(1), firstRenderMs, frameMedianMs: q(frames, 0.5), frameP95Ms: q(frames, 0.95), frameMaxMs: q(frames, 1), longFrames50: frames.filter((f) => f > 50).length, drags, dragRoundTripMs: dragMs.length ? { median: q(dragMs, 0.5), p95: q(dragMs, 0.95) } : null, heapMB: heap, wsFramesSent: sent, wsFramesReceived: received, wsBytesOut: bytesOut, wsBytesIn: bytesIn, reconnectMs };
    report.push(row); await context.close();
    assert.ok(drags >= 3, `minstens drie echte sleepacties (${drags})`);
  }
  console.log(JSON.stringify(report, null, 1));
} finally {
  await browser.close(); await prisma.user.deleteMany({ where: { id: { in: users } } }); await prisma.$disconnect();
}
