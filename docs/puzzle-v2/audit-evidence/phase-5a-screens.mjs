// Audit fase 5A: echte schermafbeeldingen van de startweergave (Samen 300 stukken en Solo 24 stukken) op meerdere schermen.
//   DATABASE_URL=$LEARNING_TEST_DATABASE_URL SESSION_SECRET=... PUZZLE_TEST_BASE_URL=http://localhost:3107 \
//   PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs npx tsx docs/puzzle-v2/audit-evidence/phase-5a-screens.mjs
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../../../src/lib/auth.ts";
import { jigsawCatalog } from "../../../src/lib/jigsawGame.ts";
import { createCoopSession, respondToCoopInvite } from "../../../src/lib/puzzle/coop.ts";
import { startSoloPuzzle } from "../../../src/lib/puzzle/solo.ts";
import { createMatch, respondToMatchInvite, beginMatchAttempt } from "../../../src/lib/puzzle/match.ts";
if (!process.env.LEARNING_TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Alleen een geïsoleerde testdatabase");
const require = createRequire(import.meta.url); const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107"; const out = process.env.SHOTS ?? "/tmp/audit-shots";
import { mkdirSync } from "node:fs"; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH }); const users = [];
try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
  const person = async () => { const u = await prisma.user.create({ data: { email: `au-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Au${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } }); users.push(u.id); return u; };
  const [a, b] = [await person(), await person()]; await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
  const coop = await createCoopSession(a.id, jigsawCatalog[2].url, 300, "ADVENTURER", [b.id]);
  const coop150 = await createCoopSession(a.id, jigsawCatalog[3].url, 150, "ADVENTURER", [b.id]);
  const solo = await startSoloPuzzle(a.id, 7, 24, "ADVENTURER", "nl");
  const solo96 = await startSoloPuzzle(b.id, 8, 96, "ADVENTURER", "nl");
  const matchId = await createMatch(a.id, 9, 96, "ADVENTURER", [b.id], "ASYNC");
  await respondToMatchInvite(b.id, matchId, true); await beginMatchAttempt(a.id, matchId);
  for (const [name, w, h] of [["se", 320, 568], ["android", 360, 740], ["iphone", 390, 844], ["landscape", 740, 360], ["tablet", 768, 1024]]) {
    for (const [kind, path, init, who] of [["samen300", `/jigsaw/samen/${coop}`, null, a], ["samen150", `/jigsaw/samen/${coop150}`, null, a], ["solo24", "/jigsaw", { id: solo.id }, a], ["solo96", "/jigsaw", { id: solo96.id }, b], ["wedstrijd96", `/jigsaw/wedstrijd/${matchId}`, null, a]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, serviceWorkers: "block", hasTouch: true, isMobile: w < 800 });
      await ctx.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(who.id), url: base }]);
      if (init) await ctx.addInitScript(({ id }) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, init);
      const page = await ctx.newPage(); await page.goto(base + path, { waitUntil: "networkidle" }); await page.waitForSelector("canvas", { timeout: 20000 }); await page.waitForTimeout(900);
      const box = await page.locator("canvas").first().boundingBox();
      await page.screenshot({ path: `${out}/${kind}-${name}.png` });
      console.log(kind, name, `canvas ${Math.round(box.width)}x${Math.round(box.height)} van ${w}x${h} (${Math.round(100 * box.width * box.height / (w * h))}%)`);
      await ctx.close();
    }
  }
} finally { await browser.close(); await prisma.user.deleteMany({ where: { id: { in: users } } }); await prisma.$disconnect(); }
