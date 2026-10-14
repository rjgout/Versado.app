// Fase 5D-1: bijna-passend-feedback in de echte productie-interface (Solo, Tegen elkaar-component en Samen), echte muis/touch,
// canvaspixels en websocketverkeer. Draait alleen tegen de lokale wegwerpdatabase.
//   . /tmp/puzenv.sh && npx tsx tests/puzzle-near-snap.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { jigsawCatalog } from "../src/lib/jigsawGame.ts";
import { createCoopSession, respondToCoopInvite } from "../src/lib/puzzle/coop.ts";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry.ts";
import { boardPosition, newPuzzleSnapshot } from "../src/lib/puzzle/engine.ts";
import { initialPuzzleCamera } from "../src/lib/puzzle/viewport.ts";

const database = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_puzzle_test" || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Gebruik de lokale wegwerpdatabase");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const output = process.env.SHOTS ?? "/tmp/versado-near-snap"; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const DEVICES = { desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, landscape: { viewport: { width: 740, height: 360 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const users = []; let definition; const report = [];
const person = async () => { const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } }); const user = await prisma.user.create({ data: { email: `ns-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Ns${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } }); users.push(user.id); return user; };
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
/** Pixels in de kern van de feedbackkleur (diep cyaan), met een kleine tolerantie voor antialiasing. */
const accent = (page, tolerance = 16) => page.locator("canvas").first().evaluate((canvas, tol) => { const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data; let count = 0; for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - 25) < tol && Math.abs(data[i + 1] - 122) < tol && Math.abs(data[i + 2] - 150) < tol) count++; return count; }, tolerance);
const SEEN = 30;
const stacked = (geometry, difficulty) => newPuzzleSnapshot(geometry, difficulty).groups.map((group) => ({ ...group, x: .6, y: .6, rotation: 0 }));
function place(groups, id, x, y, rotation = 0) { const group = groups.find((candidate) => candidate.id === `p${id}`); Object.assign(group, { x, y, rotation }); }

async function openSolo(device, difficulty, build, options = {}) {
  const user = await person();
  const context = await browser.newContext({ ...DEVICES[device], serviceWorkers: "block", ...options });
  await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
  const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const api = async (body) => { const response = await context.request.post(`${base}/api/jigsaw-v2`, { headers: { Origin: base }, data: body }); assert.equal(response.status(), 200, await response.text()); return response.json(); };
  await page.goto(`${base}/jigsaw`);
  if (!definition) {
    // Alleen testcontent in grijstinten en oranje: niets lijkt op de blauwe feedbackkleur.
    const imageUrl = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 400; c.height = 300; const ctx = c.getContext("2d"); for (let id = 0; id < 12; id++) { ctx.fillStyle = id % 2 ? "rgb(210,150,70)" : "rgb(150,150,150)"; ctx.fillRect(id % 4 * 100, Math.floor(id / 4) * 100, 100, 100); } return c.toDataURL(); });
    const seed = `ns-${randomUUID()}`; definition = await prisma.puzzleDefinition.create({ data: { contentKey: seed, seed, definitionHash: seed, imageUrl, storyNumber: 1, aspectRatio: 4 / 3, geometryVersion: 2 } });
  }
  const geometry = createPuzzleGeometry(12, definition.seed, 2);
  const snapshot = { ...newPuzzleSnapshot(geometry, difficulty), groups: stacked(geometry, difficulty) }; build(snapshot.groups, geometry);
  const variant = await prisma.puzzleVariant.upsert({ where: { definitionId_pieceCount_difficulty_rulesVersion: { definitionId: definition.id, pieceCount: 12, difficulty, rulesVersion: 2 } }, create: { definitionId: definition.id, pieceCount: 12, difficulty, rulesVersion: 2 }, update: {} });
  const session = await prisma.puzzleSession.create({ data: { ownerId: user.id, variantId: variant.id, snapshot: JSON.stringify(snapshot) } });
  const state = await api({ action: "resume", sessionId: session.id });
  await page.evaluate((id) => localStorage.setItem("versado:jigsaw-v2-session", id), state.id); await page.reload();
  const canvas = page.locator("canvas"); await canvas.waitFor();
  await page.waitForFunction(() => { const c = document.querySelector("canvas"), h = document.querySelector("[data-sticky-header]"); return c && h && Math.abs(c.getBoundingClientRect().top - h.getBoundingClientRect().bottom) < 1 && c.width === Math.round(c.clientWidth * Math.min(devicePixelRatio, 2)); });
  await page.evaluate(async (src) => { const image = new Image(); image.src = src; await image.decode(); }, state.image); await page.waitForTimeout(300); await settle(page);
  const bounds = await canvas.boundingBox(); const camera = initialPuzzleCamera(bounds, geometry, state.snapshot);
  const screen = (x, y) => ({ x: bounds.x + camera.x + x * camera.scale, y: bounds.y + camera.y + y * camera.scale });
  return { user, context, page, api, state, geometry, screen, camera, errors, canvas, touch: DEVICES[device].hasTouch ? await context.newCDPSession(page) : null };
}
function pointer(env) {
  let current;
  const down = async (point) => { current = point; if (env.touch) await env.touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 0 }] }); else { await env.page.mouse.move(point.x, point.y); await env.page.mouse.down(); } await settle(env.page); };
  const move = async (point) => { current = point; if (env.touch) await env.touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, id: 0 }] }); else await env.page.mouse.move(point.x, point.y, { steps: 5 }); await settle(env.page); };
  const up = async () => { if (env.touch) await env.touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); else await env.page.mouse.up(); await settle(env.page); };
  const cancel = async () => { if (env.touch) await env.touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }); else { await env.canvas.dispatchEvent("pointercancel", { pointerId: 1 }); await env.page.mouse.up(); } await settle(env.page); };
  return { down, move, up, cancel, get at() { return current; } };
}
const FADE_WAIT = 320;

try {
  // --- Solo: verbinding, binnenkomen, verlaten, terugkeren, loslaten, annuleren (alle schermen)
  for (const device of Object.keys(DEVICES)) {
    const env = await openSolo(device, "ADVENTURER", (groups) => { place(groups, 0, 4, 4); place(groups, 1, 5.2, 4.1); });
    const { page, screen } = env; const p = pointer(env);
    assert.equal(await accent(page), 0, `${device}: zonder slepen geen feedback`);
    const grab = screen(5.7, 4.6); await p.down(grab); await page.waitForTimeout(FADE_WAIT);
    const near = await accent(page); assert.ok(near >= SEEN, `${device}: feedback bij een geldige bijna-verbinding (${near})`);
    await page.screenshot({ path: `${output}/solo-near-${device}.png` });
    await p.move({ x: grab.x + 2.5 * env.camera.scale, y: grab.y + 1.5 * env.camera.scale }); assert.equal(await accent(page), 0, `${device}: buiten de snapafstand direct weg`);
    await page.screenshot({ path: `${output}/solo-far-${device}.png` });
    await p.move({ x: grab.x - .05 * env.camera.scale, y: grab.y }); await page.waitForTimeout(FADE_WAIT); assert.ok(await accent(page) >= SEEN, `${device}: terug in de snapafstand`);
    await p.up(); await page.waitForFunction(() => document.querySelector("canvas").parentElement.getAttribute("aria-busy") === "false"); await settle(page);
    assert.equal(await accent(page), 0, `${device}: na loslaten geen achterblijvende gloed`);
    const joined = await env.api({ action: "resume", sessionId: env.state.id }); assert.equal(joined.snapshot.groups.length, 11, `${device}: loslaten verbindt zoals voorheen (engine ongewijzigd)`);
    assert.deepEqual(env.errors, []); await env.context.close();
    report.push({ device, near });
  }
  {
    const env = await openSolo("desktop", "ADVENTURER", (groups) => { place(groups, 0, 4, 4); place(groups, 1, 5.2, 4.1); }); const p = pointer(env);
    await p.down(env.screen(5.7, 4.6)); await env.page.waitForTimeout(FADE_WAIT); assert.ok(await accent(env.page) >= SEEN);
    await p.cancel(); assert.equal(await accent(env.page), 0, "annuleren verwijdert de feedback"); await env.context.close();
  }
  // --- Verkeerde buur of te ver: geen feedback
  {
    const env = await openSolo("desktop", "ADVENTURER", (groups) => { place(groups, 0, 4, 4); place(groups, 2, 5.2, 4.1); place(groups, 5, 7.8, 4); }); const p = pointer(env);
    await p.down(env.screen(5.7, 4.6)); await env.page.waitForTimeout(FADE_WAIT); assert.equal(await accent(env.page), 0, "stukken die geen buren zijn: geen feedback"); await p.up(); await env.context.close();
  }
  // --- Moeilijkheid: bordplaats alleen bij Ontdekker/Avonturier
  for (const [difficulty, expected] of [["DISCOVERER", true], ["ADVENTURER", true], ["EXPERT", false], ["MASTER", false]]) {
    const env = await openSolo("desktop", difficulty, (groups, geometry) => { const to = boardPosition(geometry, { pieceIds: [5] }); place(groups, 5, to.x + .1, to.y - .1); }); const p = pointer(env);
    const geometry = env.geometry; const to = boardPosition(geometry, { pieceIds: [5] });
    await p.down(env.screen(to.x + .6, to.y + .4)); await env.page.waitForTimeout(FADE_WAIT);
    const count = await accent(env.page, 70); await env.page.screenshot({ path: `${output}/board-${difficulty.toLowerCase()}.png` });
    if (expected) assert.ok(count >= 10, `${difficulty}: bordplaats krijgt feedback (${count})`); else assert.equal(count, 0, `${difficulty}: geen bordhulp (${count})`);
    await p.cancel(); await env.context.close();
  }
  // --- Meester: alleen bij de juiste rotatie
  for (const [rotation, expected] of [[0, true], [90, false], [180, false]]) {
    const env = await openSolo("desktop", "MASTER", (groups) => { place(groups, 0, 4, 4); place(groups, 1, 5.2, 4.1, rotation); }); const p = pointer(env);
    await p.down(env.screen(5.7, 4.6)); await env.page.waitForTimeout(FADE_WAIT); const count = await accent(env.page);
    await env.page.screenshot({ path: `${output}/master-rotation-${rotation}.png` });
    if (expected) assert.ok(count >= SEEN, `MEESTER rotatie ${rotation}: wel feedback (${count})`); else assert.equal(count, 0, `MEESTER rotatie ${rotation}: geen feedback (${count})`);
    await p.cancel(); await env.context.close();
  }
  // --- Verminderde beweging: direct de statische weergave, geen overgang
  {
    const reduced = await openSolo("desktop", "ADVENTURER", (groups) => { place(groups, 0, 4, 4); place(groups, 1, 5.2, 4.1); }, { reducedMotion: "reduce" });
    const normal = await openSolo("desktop", "ADVENTURER", (groups) => { place(groups, 0, 4, 4); place(groups, 1, 5.2, 4.1); });
    const a = pointer(reduced); await a.down(reduced.screen(5.7, 4.6)); const immediate = await accent(reduced.page);
    const b = pointer(normal); await b.down(normal.screen(5.7, 4.6)); const early = await accent(normal.page); await normal.page.waitForTimeout(FADE_WAIT); const later = await accent(normal.page);
    assert.ok(immediate >= SEEN, `reduced motion: direct zichtbaar (${immediate})`); assert.ok(early < immediate, `zonder reduced motion begint de overgang zachter (${early} < ${immediate})`); assert.ok(Math.abs(later - immediate) < immediate * .2, "zelfde eindbeeld");
    await reduced.page.screenshot({ path: `${output}/reduced-motion.png` });
    // Geen permanente lus: na de overgang worden er geen frames meer geteken terwijl de speler stilstaat.
    const draws = await normal.page.evaluate(() => new Promise((resolve) => { const canvas = document.querySelector("canvas"); let count = 0; const original = canvas.getContext("2d").setTransform.bind(canvas.getContext("2d")); canvas.getContext("2d").setTransform = (...args) => { count++; return original(...args); }; setTimeout(() => resolve(count), 600); }));
    assert.equal(draws, 0, `stilstaand: geen herhaalde tekenframes (${draws})`);
    await a.up(); await b.up(); await reduced.context.close(); await normal.context.close();
  }

  // --- Samen: alleen de slepende speler ziet het; geen extra verkeer; lockverlies verwijdert het
  {
    const [a, b] = [await person(), await person()]; await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
    const sessionId = await createCoopSession(a.id, jigsawCatalog[3].url, 24, "ADVENTURER", [b.id]);
    await respondToCoopInvite(b.id, (await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId, toUserId: b.id } })).id, true);
    const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: sessionId }, include: { variant: { include: { definition: true } } } });
    const geometry = createPuzzleGeometry(24, row.variant.definition.seed, row.variant.definition.geometryVersion);
    const groups = stacked(geometry, "ADVENTURER"); place(groups, 0, 4, 4); place(groups, 1, 5.2, 4.1);
    await prisma.puzzleSession.update({ where: { id: sessionId }, data: { snapshot: JSON.stringify({ ...JSON.parse(row.snapshot), groups }) } });
    const open = async (user) => { const context = await browser.newContext({ ...DEVICES.desktop, serviceWorkers: "block" }); await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]); const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); const frames = []; const requests = []; page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload)))); page.on("request", (r) => { if (!r.url().startsWith("data:")) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); }); await page.goto(`${base}/jigsaw/samen/${sessionId}`, { waitUntil: "networkidle" }); await page.waitForSelector("canvas"); await page.waitForTimeout(900); await settle(page); return { context, page, errors, frames, requests, canvas: page.locator("canvas").first() }; };
    const A = await open(a); const B = await open(b); const box = await A.canvas.boundingBox(); const camera = initialPuzzleCamera(box, geometry, { ...JSON.parse(row.snapshot), groups });
    const at = (x, y) => ({ x: box.x + camera.x + x * camera.scale, y: box.y + camera.y + y * camera.scale });
    const baseA = await accent(A.page); const baseB = await accent(B.page);
    const eventNames = (frames) => [...new Set(frames.map((frame) => frame.match(/^\d*\["([^"]+)"/)?.[1]).filter(Boolean))].sort();
    // Fase 1: ver weg slepen (referentieverkeer). Fase 2: dezelfde bewegingen binnen de snapafstand.
    const start = at(5.7, 4.6); await A.page.mouse.move(start.x, start.y); await A.page.mouse.down(); await settle(A.page);
    for (let attempt = 0; attempt < 40 && !(await prisma.puzzleLock.count({ where: { sessionId } })); attempt++) await A.page.waitForTimeout(50);
    const far = at(5.7 + 3, 4.6 + 2); let framesBefore = A.frames.length; let requestsBefore = A.requests.length;
    for (let i = 0; i < 12; i++) { await A.page.mouse.move(far.x + i, far.y + i); await settle(A.page); }
    const farB = await accent(B.page); const farEvents = eventNames(A.frames.slice(framesBefore)); const farRequests = A.requests.slice(requestsBefore); assert.equal(await accent(A.page) - baseA, 0, "Samen: ver weg geen feedback");
    await A.page.mouse.move(start.x, start.y, { steps: 6 }); await A.page.waitForTimeout(FADE_WAIT);
    framesBefore = A.frames.length; requestsBefore = A.requests.length;
    for (let i = 0; i < 12; i++) { await A.page.mouse.move(start.x + i * .3, start.y + i * .3); await settle(A.page); }
    await A.page.waitForTimeout(FADE_WAIT); const mine = await accent(A.page) - baseA; assert.ok(mine >= SEEN, `Samen: de slepende speler ziet de feedback (${mine})`);
    await A.page.screenshot({ path: `${output}/samen-dragger.png` }); await B.page.screenshot({ path: `${output}/samen-other-player.png` });
    const nearB = await accent(B.page); assert.ok(Math.abs(nearB - farB) < 5, `Samen: de andere speler ziet geen lokale feedback, ook niet tijdens de remote sleepbeweging (${farB} → ${nearB}, basis ${baseB})`);
    const nearEvents = eventNames(A.frames.slice(framesBefore)); const nearRequests = A.requests.slice(requestsBefore);
    assert.deepEqual(nearEvents.filter((name) => !farEvents.includes(name)), [], `Samen: geen nieuwe socket-events (${nearEvents} t.o.v. ${farEvents})`); assert.deepEqual(nearRequests.filter((request) => !farRequests.includes(request)), [], "Samen: geen nieuwe HTTP-verzoeken");
    // Lockverlies: mijn lock verloopt, de ander pakt de groep; de feedback verdwijnt terwijl ik nog sleep.
    await prisma.puzzleLock.updateMany({ where: { sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const grabbed = await B.context.request.post(`${base}/api/puzzle/coop`, { headers: { Origin: base }, data: { action: "lock", sessionId, groupId: "p1" } }); assert.equal(grabbed.status(), 200);
    await A.page.waitForFunction(() => true); await A.page.waitForTimeout(500); await A.page.mouse.move(start.x + 1, start.y + 1); await settle(A.page);
    assert.equal(await accent(A.page) - baseA, 0, "Samen: na lockverlies geen feedback meer");
    await A.page.mouse.up(); await settle(A.page); assert.equal(await accent(A.page) - baseA, 0, "Samen: na loslaten niets achter");
    assert.deepEqual([...A.errors, ...B.errors], []); await A.context.close(); await B.context.close();
    report.push({ samen: { mine, farEvents, nearEvents } });
  }
  console.log(JSON.stringify(report));
  console.log("Near-snap-browser: Solo (desktop, telefoon, landscape), binnen/buiten snapafstand, loslaten, annuleren, bordhulp per niveau, Meester-rotatie, reduced motion, Samen (alleen slepende speler, geen extra verkeer, lockverlies): groen.");
} finally {
  await browser.close();
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  if (definition) await prisma.puzzleDefinition.delete({ where: { id: definition.id } }).catch(() => {});
  await prisma.$disconnect();
}
