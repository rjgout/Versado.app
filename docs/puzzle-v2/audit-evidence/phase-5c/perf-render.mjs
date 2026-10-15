// Fase 5C: tekenkosten tijdens een identieke sleepbeweging (400 pointermoves, elk met een volledig beeld) op de huidige build.
// Meet scripttijd en taaktijd via CDP Performance.getMetrics, frametijden en JS-heap. Zelfde script vóór en na de refactor.
//   . /tmp/puzenv.sh; RUNS=3 npx tsx docs/puzzle-v2/audit-evidence/phase-5c/perf-render.mjs
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../../../../src/lib/auth.ts";
import { jigsawCatalog } from "../../../../src/lib/jigsawGame.ts";
import { createCoopSession, respondToCoopInvite } from "../../../../src/lib/puzzle/coop.ts";
import { startSoloPuzzle } from "../../../../src/lib/puzzle/solo.ts";
import { createPuzzleGeometry } from "../../../../src/lib/puzzle/geometry.ts";
import { newPuzzleSnapshot } from "../../../../src/lib/puzzle/engine.ts";
import { fitCamera } from "../../../../src/lib/puzzle/viewport.ts";
import { puzzleWorktable } from "../../../../src/lib/puzzle/worktable.ts";
if (!process.env.LEARNING_TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Alleen een geïsoleerde testdatabase");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright"); const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const runs = Number(process.env.RUNS ?? 3); const MOVES = 400; const users = []; const rows = [];
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const median = (values) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)];
const q = (values, p) => { const s = [...values].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", jigsawEnabled: true }, update: { jigsawEnabled: true } });
  const person = async () => { const u = await prisma.user.create({ data: { email: `pr-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Pr${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } }); users.push(u.id); return u; };
  for (const [kind, count] of [["samen", 150], ["samen", 300], ["solo", 96]]) {
    const samples = [];
    for (let run = 0; run < runs; run++) {
      const a = await person(); let path, init, geometry;
      if (kind === "samen") { const b = await person(); await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } }); const id = await createCoopSession(a.id, jigsawCatalog[5].url, count, "ADVENTURER", [b.id]); await respondToCoopInvite(b.id, (await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId: id, toUserId: b.id } })).id, true); path = `/jigsaw/samen/${id}`; const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id }, include: { variant: { include: { definition: true } } } }); geometry = createPuzzleGeometry(count, row.variant.definition.seed, row.variant.definition.geometryVersion); }
      else { const s = await startSoloPuzzle(a.id, 7 + run, count, "ADVENTURER", "nl"); path = "/jigsaw"; init = s.id; const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: s.id }, include: { variant: { include: { definition: true } } } }); geometry = createPuzzleGeometry(count, row.variant.definition.seed, row.variant.definition.geometryVersion); }
      const context = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: "block" });
      await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(a.id), url: base }]); if (init) await context.addInitScript((id) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, init);
      const page = await context.newPage(); const t0 = Date.now(); await page.goto(base + path, { waitUntil: "domcontentloaded" }); await page.waitForSelector("canvas", { timeout: 30000 }); const firstRenderMs = Date.now() - t0; await page.waitForTimeout(900);
      const canvas = page.locator("canvas").first(); await canvas.press("0"); await page.waitForTimeout(200); const box = await canvas.boundingBox();
      const camera = fitCamera({ width: box.width, height: box.height }, puzzleWorktable(geometry).bounds); const first = newPuzzleSnapshot(geometry, "ADVENTURER").groups[count - 1];
      const from = { x: box.x + camera.x + (first.x + .5) * camera.scale, y: box.y + camera.y + (first.y + .5) * camera.scale };
      const cdp = await context.newCDPSession(page); await cdp.send("Performance.enable"); const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
      await page.evaluate(() => { window.__frames = []; let last = performance.now(); const loop = (now) => { window.__frames.push(now - last); last = now; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
      const before = await metrics(); await page.mouse.move(from.x, from.y); await page.mouse.down();
      for (let i = 1; i <= MOVES; i++) { await page.mouse.move(from.x + 60 * Math.sin(i / 20), from.y + 40 * Math.cos(i / 20)); if (i % 4 === 0) await page.evaluate(() => new Promise((r) => requestAnimationFrame(r))); }
      const after = await metrics(); await page.mouse.up(); const frames = (await page.evaluate(() => window.__frames.slice(3))).sort((x, y) => x - y);
      samples.push({ firstRenderMs, scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000, taskMs: (after.TaskDuration - before.TaskDuration) * 1000, heapMB: after.JSHeapUsedSize / 1048576, p95: q(frames, .95), over50: frames.filter((f) => f > 50).length });
      await context.close();
    }
    const field = (k) => +median(samples.map((s) => s[k])).toFixed(1);
    rows.push({ kind, count, runs, firstRenderMs: field("firstRenderMs"), scriptMs: field("scriptMs"), taskMs: field("taskMs"), heapMB: field("heapMB"), frameP95: field("p95"), over50: Math.max(...samples.map((s) => s.over50)) });
  }
} finally { await browser.close(); await prisma.user.deleteMany({ where: { id: { in: users } } }); await prisma.$disconnect(); console.table(rows); console.log(JSON.stringify(rows)); }
