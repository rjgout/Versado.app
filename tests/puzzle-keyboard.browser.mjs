// Fase 5D-3: toetsenbordbediening van de puzzel (pijltjestoetsen): het aantal serveracties moet laag blijven en de uitkomst nauwkeurig.
// Draait alleen tegen de lokale wegwerpdatabase en een draaiende productie-instance. METRICS_ONLY=1: alleen meten (voor "vóór").
import realAssert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { jigsawCatalog } from "../src/lib/jigsawGame.ts";
import { createCoopSession, respondToCoopInvite } from "../src/lib/puzzle/coop.ts";
import { startSoloPuzzle } from "../src/lib/puzzle/solo.ts";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry.ts";
import { newPuzzleSnapshot } from "../src/lib/puzzle/engine.ts";

const database = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_puzzle_test" || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Gebruik de lokale wegwerpdatabase");
const metricsOnly = !!process.env.METRICS_ONLY;
const assert = metricsOnly ? new Proxy(() => undefined, { get: () => () => undefined, apply: () => undefined }) : realAssert;
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const users = []; const report = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const person = async () => { const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } }); const user = await prisma.user.create({ data: { email: `kb-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Kb${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } }); users.push(user.id); return user; };
const stacked = (geometry) => newPuzzleSnapshot(geometry, "ADVENTURER").groups.map((group) => ({ ...group, x: .6, y: .6, rotation: 0 }));
const place = (groups, id, x, y) => Object.assign(groups.find((group) => group.id === `p${id}`), { x, y });
async function context(user) { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" }); await ctx.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]); return ctx; }

try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } }); void scope;
  // --- Solo: 10 snelle pijltjesaanslagen = één verplaatsing; en een pijl-naar-snap verbindt
  {
    const user = await person(); const ctx = await context(user); const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const solo = await startSoloPuzzle(user.id, 11, 24, "ADVENTURER", "nl"); const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: solo.id }, include: { variant: { include: { definition: true } } } });
    const geometry = createPuzzleGeometry(24, row.variant.definition.seed, row.variant.definition.geometryVersion);
    const groups = stacked(geometry); place(groups, 0, 8, 8); place(groups, 1, 4, 4); place(groups, 2, 5.5, 4.05);
    await prisma.puzzleSession.update({ where: { id: solo.id }, data: { snapshot: JSON.stringify({ ...newPuzzleSnapshot(geometry, "ADVENTURER"), groups }) } });
    await ctx.addInitScript((id) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, solo.id);
    const moves = []; page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/api/jigsaw-v2")) { const body = request.postDataJSON(); if (body?.action === "act") moves.push(body.operation); } });
    await page.goto(`${base}/jigsaw`); const canvas = page.locator("canvas").first(); await canvas.waitFor(); await page.waitForTimeout(800);
    await canvas.focus(); await canvas.press("Enter"); // selecteert het eerste stuk (p0)
    const presses = 10; for (let i = 0; i < presses; i++) { await canvas.press("ArrowRight"); await sleep(25); }
    await sleep(1800); let state = (await prisma.puzzleSession.findUniqueOrThrow({ where: { id: solo.id } })); let snapshot = JSON.parse(state.snapshot); const p0 = snapshot.groups.find((g) => g.id === "p0");
    report.soloTen = { serverMoves: moves.filter((m) => m.kind === "move").length, finalX: +p0.x.toFixed(3) };
    assert.ok(report.soloTen.serverMoves <= 2, `Solo: 10 pijltjesaanslagen geven hooguit 2 serveracties (${report.soloTen.serverMoves})`);
    assert.ok(Math.abs(p0.x - 10) < 1e-6 && Math.abs(p0.y - 8) < 1e-6, `Solo: nauwkeurig 10 × 0,2 verplaatst (${p0.x})`);
    // naar de snap: selecteer p1 (Enter loopt de stukken langs) en duw het drie keer naar zijn rechterbuur p2
    moves.length = 0; await canvas.press("Enter");
    for (let i = 0; i < 3; i++) { await canvas.press("ArrowRight"); await sleep(25); }
    await sleep(2000); state = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: solo.id } }); snapshot = JSON.parse(state.snapshot);
    report.soloSnap = { serverActions: moves.map((m) => m.kind), groups: snapshot.groups.length };
    assert.ok(moves.filter((m) => m.kind === "move").length <= 1, "Solo: één verplaatsing richting de buur"); assert.equal(snapshot.groups.length, 23, "Solo: pijltjes brengen het stuk in de snapzone en het verbindt (engine ongewijzigd)");
    assert.deepEqual(errors, []); await ctx.close();
  }
  // --- Samen: 10 aanslagen = één greep, één verplaatsing, één loslaten
  {
    const [a, b] = [await person(), await person()]; await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
    const id = await createCoopSession(a.id, jigsawCatalog[4].url, 24, "ADVENTURER", [b.id]); await respondToCoopInvite(b.id, (await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId: id, toUserId: b.id } })).id, true);
    const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id }, include: { variant: { include: { definition: true } } } }); const geometry = createPuzzleGeometry(24, row.variant.definition.seed, row.variant.definition.geometryVersion);
    const groups = stacked(geometry); place(groups, 0, 8, 8); await prisma.puzzleSession.update({ where: { id }, data: { snapshot: JSON.stringify({ ...newPuzzleSnapshot(geometry, "ADVENTURER"), groups }) } });
    const ctx = await context(a); const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); const frames = []; page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
    const http = []; page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/api/puzzle/coop")) http.push(request.postDataJSON()?.action); });
    await page.goto(`${base}/jigsaw/samen/${id}`, { waitUntil: "networkidle" }); const canvas = page.locator("canvas").first(); await canvas.waitFor(); await page.waitForTimeout(900);
    await canvas.focus(); await canvas.press("Enter"); const before = frames.length; const httpBefore = http.length;
    for (let i = 0; i < 10; i++) { await canvas.press("ArrowRight"); await sleep(25); }
    await sleep(2200); const events = frames.slice(before).map((frame) => frame.match(/^\d*\["([^"]+)"/)?.[1]).filter(Boolean);
    const count = (name) => events.filter((event) => event === name).length + http.slice(httpBefore).filter((action) => action === (name === "puzzle:commit" ? "commit" : name === "puzzle:lock" ? "lock" : "release")).length;
    const p0 = JSON.parse((await prisma.puzzleSession.findUniqueOrThrow({ where: { id } })).snapshot).groups.find((g) => g.id === "p0");
    report.samenTen = { commits: count("puzzle:commit"), locks: count("puzzle:lock"), releases: count("puzzle:release"), finalX: +p0.x.toFixed(3) };
    assert.ok(report.samenTen.commits <= 2 && report.samenTen.locks <= 2, `Samen: 10 aanslagen geven hooguit 2 verplaatsingen en 2 grepen (${JSON.stringify(report.samenTen)})`);
    assert.ok(Math.abs(p0.x - 10) < 1e-6, `Samen: nauwkeurig verplaatst (${p0.x})`); assert.deepEqual(errors, []); await ctx.close();
  }
  console.log(JSON.stringify(report)); console.log(metricsOnly ? "Keyboard-browser: alleen gemeten." : "Keyboard-browser: Solo en Samen, pijltjestoetsen: weinig serveracties, nauwkeurig, snap bereikbaar: groen.");
} finally { await browser.close(); await prisma.user.deleteMany({ where: { id: { in: users } } }); await prisma.$disconnect(); }
