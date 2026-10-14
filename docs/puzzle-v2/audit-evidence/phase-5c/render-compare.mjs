// Fase 5C: pixelvergelijking van het canvas vóór/na de refactor naar één gedeelde tekenmodule.
// Elke scenario-uitvoer is een sha256 van de canvaspixels (canvas.toDataURL) en, met OUT, de PNG zelf.
//   . /tmp/puzenv.sh  (geïsoleerde testdatabase + draaiende productie-instance op PUZZLE_TEST_BASE_URL)
//   OUT=/tmp/render-before npx tsx docs/puzzle-v2/audit-evidence/phase-5c/render-compare.mjs
// Daarna met de nieuwe code opnieuw (OUT=/tmp/render-after) en vergelijk met compare.mjs in dezelfde map.
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../../../../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../../../../src/lib/auth.ts";
import { jigsawCatalog } from "../../../../src/lib/jigsawGame.ts";
import { createCoopSession, respondToCoopInvite } from "../../../../src/lib/puzzle/coop.ts";
import { startSoloPuzzle } from "../../../../src/lib/puzzle/solo.ts";
import { createMatch, respondToMatchInvite, beginMatchAttempt } from "../../../../src/lib/puzzle/match.ts";
import { createPuzzleGeometry } from "../../../../src/lib/puzzle/geometry.ts";
import { puzzleWorktable } from "../../../../src/lib/puzzle/worktable.ts";
import { anchorGroup, boardPosition, connectGroups, newPuzzleSnapshot, validPuzzleStructure } from "../../../../src/lib/puzzle/engine.ts";
import { puzzleHintTarget } from "../../../../src/lib/puzzle/hints.ts";
import { fitCamera, initialPuzzleCamera } from "../../../../src/lib/puzzle/viewport.ts";
if (!process.env.LEARNING_TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Alleen een geïsoleerde testdatabase");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107"; const out = process.env.OUT ?? "/tmp/render-run"; mkdirSync(out, { recursive: true });
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const VIEWPORTS = { phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, landscape: { viewport: { width: 740, height: 360 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 } };
const results = {}; const users = []; const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const FAR = new Date(Date.now() + 3600e3).toISOString();

const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", jigsawEnabled: true }, update: { jigsawEnabled: true } });
const person = async () => { const u = await prisma.user.create({ data: { email: `rc-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Rc${randomUUID().slice(0, 6)}`, discriminator: "00", hintBalance: 5, activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } }); users.push(u.id); return u; };
const wants = (name) => !only || only.test(name);

/** Deterministische testtoestand: een samengestelde groep, een verankerde groep en (MASTER) draaiingen uit newPuzzleSnapshot. */
function prepare(snapshot, geometry, difficulty) {
  let next = structuredClone(snapshot); const g = (id) => next.groups.find((x) => x.id === `p${id}`);
  const columns = geometry.grid.columns;
  Object.assign(g(1), { x: g(0).x + 1, y: g(0).y, rotation: g(0).rotation }); Object.assign(g(2), { x: g(0).x + 2, y: g(0).y, rotation: g(0).rotation });
  if (difficulty !== "MASTER") { next = connectGroups(next, geometry, difficulty, 0, 1); next = connectGroups(next, geometry, difficulty, 1, 2); }
  const last = geometry.pieces.length - 1; const group = next.groups.find((x) => x.pieceIds.includes(last)); group.rotation = 0;
  const board = boardPosition(geometry, group); group.x = board.x; group.y = board.y;
  if (difficulty !== "MASTER") next = anchorGroup(next, geometry, difficulty, group.id);
  void columns; if (!validPuzzleStructure(next, geometry, difficulty, 2)) throw new Error("ongeldige testtoestand");
  return next;
}
const hintFor = (kind, snapshot, geometry) => {
  const loose = snapshot.groups.find((x) => !x.anchored && x.pieceIds.length === 1);
  const piece = loose.pieceIds[0]; const target = kind === "FILTER" ? puzzleHintTarget(snapshot, geometry, "FILTER", undefined, "CORNERS") : puzzleHintTarget(snapshot, geometry, kind, piece);
  if (!target) throw new Error(`geen hint ${kind}`); return { type: kind, at: new Date().toISOString(), extra: false, source: "INCLUDED", actionId: randomUUID(), expiresAt: FAR, target };
};

async function sha(page, name) {
  const url = await page.locator("canvas").first().evaluate((c) => c.toDataURL("image/png"));
  const data = Buffer.from(url.split(",")[1], "base64"); results[name] = createHash("sha256").update(data).digest("hex"); writeFileSync(`${out}/${name}.png`, data);
}
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const ready = async (page) => { await page.waitForSelector("canvas", { timeout: 20000 }); await page.waitForTimeout(900); await settle(page); };

async function newContext(user, device) {
  const context = await browser.newContext({ ...VIEWPORTS[device], serviceWorkers: "block" });
  await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]); return context;
}
/** Sleept met muis (desktop) of echte touch (mobiel) en houdt vast; de aanroeper leest dan de pixels. */
async function holdDrag(page, context, device, from, to) {
  if (VIEWPORTS[device].hasTouch) {
    const touch = await context.newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...from, id: 0 }] }); await settle(page);
    for (let i = 1; i <= 6; i++) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6, id: 0 }] });
    await settle(page); return async () => { await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }); await settle(page); };
  }
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 6 }); await settle(page);
  return async () => { await page.keyboard.press("Escape").catch(() => {}); await page.mouse.up().catch(() => {}); };
}
const worldToScreen = (box, camera, x, y) => ({ x: box.x + camera.x + x * camera.scale, y: box.y + camera.y + y * camera.scale });

async function soloRow(label, count, difficulty, device, scenarios, { match = false } = {}) {
  const user = await person(); const peer = match ? await person() : null; let matchId = null;
  if (match) { await prisma.friendship.create({ data: { senderId: user.id, receiverId: peer.id, status: "ACCEPTED" } }); matchId = await createMatch(user.id, 4, count, difficulty, [peer.id], "ASYNC"); await respondToMatchInvite(peer.id, matchId, true); await beginMatchAttempt(user.id, matchId); }
  for (const scenario of scenarios) {
    const name = `${label}-${device}-${scenario}`; if (!wants(name)) continue;
    const owner = match ? user : await person();
    let sessionId;
    if (match) sessionId = (await prisma.puzzleSession.findFirstOrThrow({ where: { ownerId: user.id, matchId } })).id;
    else sessionId = (await startSoloPuzzle(owner.id, 7, count, difficulty, "nl")).id;
    const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: sessionId }, include: { variant: { include: { definition: true } } } });
    const geometry = createPuzzleGeometry(count, row.variant.definition.seed, row.variant.definition.geometryVersion);
    let snapshot = prepare(newPuzzleSnapshot(geometry, difficulty), geometry, difficulty);
    if (scenario.startsWith("hint-")) snapshot.hints = [hintFor(scenario.slice(5).toUpperCase(), snapshot, geometry)];
    await prisma.puzzleSession.update({ where: { id: sessionId }, data: { snapshot: JSON.stringify(snapshot) } });
    const context = await newContext(owner, device); const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    if (!match) await context.addInitScript((id) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, sessionId);
    await page.goto(base + (match ? `/jigsaw/wedstrijd/${matchId}` : "/jigsaw"), { waitUntil: "networkidle" }); await ready(page);
    const canvas = page.locator("canvas").first(); const box = await canvas.boundingBox(); const needsFit = ["selected", "drag"].includes(scenario) || scenario.startsWith("hint-"); if (needsFit) { await canvas.press("0"); await settle(page); } const camera = needsFit ? fitCamera({ width: box.width, height: box.height }, puzzleWorktable(geometry).bounds) : initialPuzzleCamera({ width: box.width, height: box.height }, geometry, snapshot);
    if (scenario === "selected") { await canvas.press("Enter"); await settle(page); }
    if (scenario === "drag") {
      const loose = snapshot.groups.find((x) => !x.anchored && x.pieceIds.length === 1 && x.id !== "p0");
      const from = worldToScreen(box, camera, loose.x + .5, loose.y + .5); const to = { x: from.x + 40, y: from.y + 30 };
      const release = await holdDrag(page, context, device, from, to); await sha(page, name); await release(); if (errors.length) results[`${name}:errors`] = errors.join("|"); await context.close(); continue;
    }
    if (scenario === "fit") { await canvas.press("0"); await settle(page); }
    await sha(page, name); if (errors.length) results[`${name}:errors`] = errors.join("|"); await context.close();
  }
}

async function coopRow(label, count, difficulty, device, scenarios, imageIndex = 2) {
  for (const scenario of scenarios) {
    const name = `${label}-${device}-${scenario}`; if (!wants(name)) continue;
    const [a, b] = [await person(), await person()]; await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
    const sessionId = await createCoopSession(a.id, jigsawCatalog[imageIndex].url, count, difficulty, [b.id]);
    const invite = await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId, toUserId: b.id } }); await respondToCoopInvite(b.id, invite.id, true);
    const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: sessionId }, include: { variant: { include: { definition: true } } } });
    const geometry = createPuzzleGeometry(count, row.variant.definition.seed, row.variant.definition.geometryVersion);
    const snapshot = prepare(newPuzzleSnapshot(geometry, difficulty), geometry, difficulty);
    if (scenario === "complete") snapshot.completedAt = new Date().toISOString();
    await prisma.puzzleSession.update({ where: { id: sessionId }, data: { snapshot: JSON.stringify(snapshot) } });
    if (scenario.startsWith("hint-")) { const hint = hintFor(scenario.slice(5).toUpperCase(), snapshot, geometry); await prisma.puzzleSessionParticipant.updateMany({ where: { sessionId, userId: a.id }, data: { activeHint: JSON.stringify(hint) } }); }
    const context = await newContext(a, device); const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/jigsaw/samen/${sessionId}`, { waitUntil: "networkidle" }); await ready(page);
    const canvas = page.locator("canvas").first(); const box = await canvas.boundingBox(); const needsFit = ["selected", "drag", "remote"].includes(scenario) || scenario.startsWith("hint-"); if (needsFit) { await canvas.press("0"); await settle(page); } const camera = needsFit ? fitCamera({ width: box.width, height: box.height }, puzzleWorktable(geometry).bounds) : initialPuzzleCamera({ width: box.width, height: box.height }, geometry, snapshot);
    const loose = snapshot.groups.find((x) => !x.anchored && x.pieceIds.length === 1 && x.id !== "p0");
    const from = worldToScreen(box, camera, loose.x + .5, loose.y + .5); const to = { x: from.x + 40, y: from.y + 30 };
    if (scenario === "selected") { await canvas.press("Enter"); await settle(page); }
    if (scenario === "drag") { const release = await holdDrag(page, context, device, from, to); await sha(page, name); await release(); }
    else if (scenario === "remote") {
      const other = await newContext(b, device); const peer = await other.newPage(); await peer.goto(`${base}/jigsaw/samen/${sessionId}`, { waitUntil: "networkidle" }); await ready(peer); await peer.locator("canvas").first().press("0"); await settle(peer);
      await page.waitForTimeout(600);
      const release = await holdDrag(peer, other, device, from, to); await peer.waitForTimeout(150); await sha(page, name); await release(); await other.close();
    } else await sha(page, name);
    if (errors.length) results[`${name}:errors`] = errors.join("|"); await context.close();
  }
}

try {
  for (const [count, difficulty] of [[24, "ADVENTURER"], [48, "DISCOVERER"], [96, "EXPERT"], [24, "MASTER"]]) {
    const label = `solo${count}-${difficulty.toLowerCase()}`;
    for (const device of ["phone", "landscape", "desktop"]) await soloRow(label, count, difficulty, device, ["initial", "selected", "drag", "fit"]);
    for (const device of ["phone", "desktop"]) await soloRow(label, count, difficulty, device, ["hint-location", "hint-connection", "hint-filter"]);
  }
  await soloRow("wedstrijd24-adventurer", 24, "ADVENTURER", "phone", ["initial", "drag"], { match: true });
  for (const [count, difficulty] of [[150, "ADVENTURER"], [300, "ADVENTURER"], [96, "DISCOVERER"], [24, "MASTER"]]) {
    const label = `samen${count}-${difficulty.toLowerCase()}`;
    for (const device of ["phone", "landscape", "desktop"]) await coopRow(label, count, difficulty, device, ["initial", "selected", "drag"]);
    for (const device of ["phone", "desktop"]) await coopRow(label, count, difficulty, device, ["remote"]);
  }
  for (const device of ["phone", "desktop"]) await coopRow("samen150-adventurer", 150, "ADVENTURER", device, ["hint-location", "hint-connection", "hint-filter", "complete"]);
} finally {
  await browser.close(); await prisma.user.deleteMany({ where: { id: { in: users } } }); await prisma.$disconnect();
  writeFileSync(`${out}/hashes.json`, JSON.stringify(results, null, 1)); console.log(`${Object.keys(results).length} scenario's naar ${out}/hashes.json`);
}
