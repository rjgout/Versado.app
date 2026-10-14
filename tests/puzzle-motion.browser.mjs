// Fase 5D-2: snapanimaties en vloeiende remote bewegingen in de echte productie-interface (Solo, Tegen elkaar-component en Samen),
// echte muis/touch, canvaspixels per frame en netwerkverkeer. Draait alleen tegen de lokale wegwerpdatabase.
//   . /tmp/puzenv.sh && npx tsx tests/puzzle-motion.browser.mjs          (METRICS_ONLY=1: alleen meten, geen beoordeling; voor de vergelijking met de vorige build)
import realAssert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry.ts";
import { connectGroups, newPuzzleSnapshot } from "../src/lib/puzzle/engine.ts";
import { initialPuzzleCamera } from "../src/lib/puzzle/viewport.ts";

const database = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_puzzle_test" || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Gebruik de lokale wegwerpdatabase");
const metricsOnly = !!process.env.METRICS_ONLY;
const assert = metricsOnly ? new Proxy(() => undefined, { get: () => () => undefined, apply: () => undefined }) : realAssert;
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const output = process.env.SHOTS ?? "/tmp/versado-motion"; mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const DEVICES = { desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, landscape: { viewport: { width: 740, height: 360 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const users = []; let definition; const report = {};
const GREEN = [50, 180, 70];
const COLOURS = [[230, 60, 60], GREEN, [230, 140, 40], [150, 60, 200], [40, 90, 230]];
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const person = async () => { const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } }); const user = await prisma.user.create({ data: { email: `mo-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Mo${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } }); users.push(user.id); return user; };
const stacked = (geometry, difficulty) => newPuzzleSnapshot(geometry, difficulty).groups.map((group) => ({ ...group, x: .6, y: .6, rotation: 0 }));
function place(groups, id, x, y) { Object.assign(groups.find((group) => group.id === `p${id}`), { x, y }); }

async function ensureDefinition(page) {
  if (definition) return definition;
  // Eén egaal gekleurd vak per stuk: zo is de positie van elk stuk per frame meetbaar.
  const imageUrl = await page.evaluate((colours) => { const c = document.createElement("canvas"); c.width = 600; c.height = 400; const ctx = c.getContext("2d"); for (let id = 0; id < 24; id++) { const rgb = id < colours.length ? colours[id] : [150, 150, 150]; ctx.fillStyle = `rgb(${rgb.join(",")})`; ctx.fillRect(id % 6 * 100, Math.floor(id / 6) * 100, 100, 100); } return c.toDataURL(); }, COLOURS);
  const seed = `mo-${randomUUID()}`; definition = await prisma.puzzleDefinition.create({ data: { contentKey: seed, seed, definitionHash: seed, imageUrl, storyNumber: 1, aspectRatio: 3 / 2, geometryVersion: 2 } }); return definition;
}
async function newContext(user, device, options = {}) {
  const context = await browser.newContext({ ...DEVICES[device], serviceWorkers: "block", ...options });
  await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
  // Tekeningen en netwerk tellen: één setTransform per beeld (renderPuzzle) en elke aanvraag/socketframe.
  await context.addInitScript(() => { window.__draws = 0; const original = CanvasRenderingContext2D.prototype.setTransform; CanvasRenderingContext2D.prototype.setTransform = function (...args) { window.__draws++; return original.apply(this, args); }; });
  return context;
}
async function prepare(page, geometry, snapshot) {
  const canvas = page.locator("canvas").first(); await canvas.waitFor(); await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForFunction(() => { const c = document.querySelector("canvas"), h = document.querySelector("[data-sticky-header]"); return c && h && Math.abs(c.getBoundingClientRect().top - h.getBoundingClientRect().bottom) < 1 && c.width === Math.round(c.clientWidth * Math.min(devicePixelRatio, 2)); });
  await page.waitForTimeout(500); await settle(page);
  const bounds = await canvas.boundingBox(); const camera = initialPuzzleCamera(bounds, geometry, snapshot);
  return { canvas, bounds, camera, screen: (x, y) => ({ x: bounds.x + camera.x + x * camera.scale, y: bounds.y + camera.y + y * camera.scale }) };
}
/** Meet per beeld het zwaartepunt van een gekleurd stuk (in wereld-units) rond een gebied; loopt tot stopTrack. */
async function startTrack(page, env, colour, around) {
  await page.evaluate(({ colour, around, camera, tolerance, captureOn }) => {
    const canvas = document.querySelector("canvas"); const ratio = canvas.width / canvas.clientWidth; const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const left = Math.max(0, Math.floor((camera.x + (around.x - around.r) * camera.scale) * ratio)); const top = Math.max(0, Math.floor((camera.y + (around.y - around.r) * camera.scale) * ratio));
    const width = Math.min(canvas.width - left, Math.ceil(2 * around.r * camera.scale * ratio)); const height = Math.min(canvas.height - top, Math.ceil(2 * around.r * camera.scale * ratio));
    window.__track = []; window.__crops = []; window.__capture = !!captureOn; window.__tracking = true; const started = performance.now(); let lastDraws = window.__draws;
    const loop = (time) => {
      if (!window.__tracking) return;
      const data = ctx.getImageData(left, top, width, height).data; let sx = 0, sy = 0, n = 0;
      for (let i = 0, p = 0; i < data.length; i += 4, p++) if (Math.abs(data[i] - colour[0]) < tolerance && Math.abs(data[i + 1] - colour[1]) < tolerance && Math.abs(data[i + 2] - colour[2]) < tolerance) { sx += p % width; sy += Math.floor(p / width); n++; }
      window.__track.push({ t: +(time - started).toFixed(1), n, x: n ? ((left + sx / n) / ratio - camera.x) / camera.scale : null, y: n ? ((top + sy / n) / ratio - camera.y) / camera.scale : null, drawn: window.__draws !== lastDraws }); lastDraws = window.__draws;
      if (window.__capture && window.__draws !== window.__lastCropDraw && window.__crops.length < 60) { window.__lastCropDraw = window.__draws; window.__crops.push({ t: +(time - started).toFixed(0), image: new ImageData(new Uint8ClampedArray(data), width, height) }); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, { colour, around, camera: env.camera, tolerance: 28, captureOn: !!process.env.FRAMES });
}
/** Contactblad van de opgenomen beelden (alleen met FRAMES=1): elk beeld waarin het bord opnieuw getekend werd, met tijdstempel. */
async function saveSheet(page, name, maxFrames = 14) {
  if (!process.env.FRAMES) return;
  const url = await page.evaluate((limit) => {
    const crops = window.__crops; if (!crops.length) return null;
    const pick = crops.length <= limit ? crops : crops.filter((_, index) => index % Math.ceil(crops.length / limit) === 0);
    const { width, height } = pick[0].image; const columns = Math.min(7, pick.length); const rows = Math.ceil(pick.length / columns); const sheet = document.createElement("canvas"); sheet.width = columns * (width + 6) + 6; sheet.height = rows * (height + 22) + 6;
    const ctx = sheet.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, sheet.width, sheet.height); ctx.font = "14px sans-serif";
    pick.forEach((crop, index) => { const x = 6 + (index % columns) * (width + 6); const y = 6 + Math.floor(index / columns) * (height + 22); ctx.putImageData(crop.image, x, y + 16); ctx.fillStyle = "#000"; ctx.fillText(`${crop.t} ms`, x + 2, y + 12); ctx.strokeStyle = "#888"; ctx.strokeRect(x - .5, y + 15.5, width + 1, height + 1); });
    return sheet.toDataURL("image/png");
  }, maxFrames);
  if (url) writeFileSync(`${output}/frames-${name}.png`, Buffer.from(url.split(",")[1], "base64"));
}
const stopTrack = (page) => page.evaluate(() => { window.__tracking = false; return window.__track; });
const distinct = (track) => { const seen = []; for (const sample of track) if (sample.x !== null && !seen.some((value) => Math.abs(value.x - sample.x) < .004 && Math.abs(value.y - sample.y) < .004)) seen.push(sample); return seen; };
function pointer(page, context, device) {
  let touch = null;
  return {
    async down(point) { if (DEVICES[device].hasTouch) { touch ??= await context.newCDPSession(page); await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 0 }] }); } else { await page.mouse.move(point.x, point.y); await page.mouse.down(); } },
    async move(point, steps = 4) { if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, id: 0 }] }); else await page.mouse.move(point.x, point.y, { steps }); },
    async up() { if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); else await page.mouse.up(); },
  };
}

async function soloSession(device, build, { difficulty = "ADVENTURER", options = {}, user: given } = {}) {
  const user = given ?? await person(); const context = await newContext(user, device, options); const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const api = async (body) => { const response = await context.request.post(`${base}/api/jigsaw-v2`, { headers: { Origin: base }, data: body }); realAssert.equal(response.status(), 200, await response.text()); return response.json(); };
  await page.goto(`${base}/jigsaw`); await ensureDefinition(page);
  const geometry = createPuzzleGeometry(24, definition.seed, 2); let snapshot = { ...newPuzzleSnapshot(geometry, difficulty), groups: stacked(geometry, difficulty) }; snapshot = build(snapshot, geometry) ?? snapshot;
  const variant = await prisma.puzzleVariant.upsert({ where: { definitionId_pieceCount_difficulty_rulesVersion: { definitionId: definition.id, pieceCount: 24, difficulty, rulesVersion: 2 } }, create: { definitionId: definition.id, pieceCount: 24, difficulty, rulesVersion: 2 }, update: {} });
  const row = await prisma.puzzleSession.create({ data: { ownerId: user.id, variantId: variant.id, snapshot: JSON.stringify(snapshot) } });
  const state = await api({ action: "resume", sessionId: row.id }); await page.evaluate((id) => localStorage.setItem("versado:jigsaw-v2-session", id), state.id); await page.reload();
  const env = await prepare(page, geometry, state.snapshot);
  return { user, context, page, api, errors, geometry, state, env, input: pointer(page, context, device) };
}

try {
  // --- Solo: een bevestigde verbinding glijdt kort; de bevestigde stand geldt direct
  for (const device of (process.env.DEVICES ?? Object.keys(DEVICES).join(",")).split(",")) {
    const s = await soloSession(device, (snapshot) => { place(snapshot.groups, 0, 4, 4); place(snapshot.groups, 1, 5.2, 4.1); return snapshot; });
    const { page, env, input } = s; const grab = env.screen(5.7, 4.6);
    await startTrack(page, env, GREEN, { x: 5.7, y: 4.6, r: 2.2 }); await sleep(120);
    // De bord blijft "bezig" tot de serveracties klaar zijn; de animatie mag dat niet verlengen (busyMs = vanaf loslaten tot weer bedienbaar).
    const released = Date.now(); await input.down(grab); await input.up();
    await page.waitForFunction(() => document.querySelector("canvas").parentElement.getAttribute("aria-busy") === "true", null, { timeout: 3000, polling: "raf" }).catch(() => undefined);
    await page.waitForFunction(() => document.querySelector("canvas").parentElement.getAttribute("aria-busy") === "false", null, { timeout: 8000, polling: "raf" }); const busyMs = Date.now() - released; await sleep(700);
    const track = await stopTrack(page); await saveSheet(page, `solo-${device}`); const series = distinct(track); const final = series.at(-1); const start = series[0];
    const moved = track.filter((sample) => sample.x !== null && (Math.abs(sample.x - start.x) > .02 || Math.abs(sample.y - start.y) > .02));
    const startAt = moved[0]?.t ?? 0; const rows = track.filter((sample) => sample.x !== null); const endAt = rows.find((sample, index) => rows.slice(index).every((later) => Math.abs(later.x - (start.x - .2)) <= .035 && Math.abs(later.y - (start.y - .1)) <= .035))?.t ?? 0;
    const resumed = await s.api({ action: "resume", sessionId: s.state.id });
    if (process.env.TRACE) console.log(device, JSON.stringify(track.filter((sample) => sample.x !== null).map((sample) => [sample.t, +sample.x.toFixed(3), sample.drawn ? 1 : 0])));
    report[`solo-${device}`] = { positions: series.length, glideMs: Math.round(endAt - startAt), busyMs, start: [+start.x.toFixed(2), +start.y.toFixed(2)], final: [+final.x.toFixed(2), +final.y.toFixed(2)] };
    assert.equal(resumed.snapshot.groups.length, s.state.snapshot.groups.length - 1, `${device}: de verbinding is vastgelegd zoals voorheen`);
    assert.ok(series.length >= 3, `${device}: de weergave bewoog in meerdere stappen (${series.length}), niet in één sprong`);
    assert.ok(Math.abs(final.x - start.x + .2) < .06 && Math.abs(final.y - start.y + .1) < .06, `${device}: eindigt precies op de verbindingsplek (${final.x - start.x}, ${final.y - start.y})`);
    const xs = series.map((sample) => sample.x); assert.ok(xs.every((x, index) => !index || x <= xs[index - 1] + .01), `${device}: monotone beweging, geen heen-en-weer`);
    assert.ok(endAt - startAt >= 30 && endAt - startAt <= 220, `${device}: korte beweging (ruim onder een kwart seconde, meer dan één beeld) (${Math.round(endAt - startAt)} ms)`);
    await sleep(300); const idle = await page.evaluate(() => { const before = window.__draws; return new Promise((resolve) => setTimeout(() => resolve(window.__draws - before), 700)); }); assert.equal(idle, 0, `${device}: na de beweging geen tekenframes meer (${idle})`);
    assert.deepEqual(s.errors, []); await s.context.close();
  }
  // --- Solo, verminderde beweging: direct de bevestigde stand
  {
    const s = await soloSession("desktop", (snapshot) => { place(snapshot.groups, 0, 4, 4); place(snapshot.groups, 1, 5.2, 4.1); return snapshot; }, { options: { reducedMotion: "reduce" } });
    await startTrack(s.page, s.env, GREEN, { x: 5.7, y: 4.6, r: 2.2 }); await sleep(100); await s.input.down(s.env.screen(5.7, 4.6)); await s.input.up(); await sleep(900);
    const reducedTrack = await stopTrack(s.page); await saveSheet(s.page, "solo-reduced"); const series = distinct(reducedTrack); report["solo-reduced"] = { positions: series.length };
    assert.ok(series.length <= 2, `reduced motion: direct de bevestigde stand, geen tussenstappen (${series.length})`); await s.context.close();
  }
  // --- Solo: voltooien tijdens de animatie en unmount tijdens de animatie
  {
    const s = await soloSession("desktop", (snapshot, geometry) => {
      // Alles aan elkaar behalve het laatste stuk, dat net naast zijn buur ligt.
      let next = snapshot; const columns = geometry.grid.columns; const origin = { x: 8, y: 6 };
      for (const piece of geometry.pieces) place(next.groups, piece.id, origin.x + piece.column, origin.y + piece.row);
      place(next.groups, 23, origin.x + 5 + .15, origin.y + 3 + .1);
      for (const piece of geometry.pieces) { if (piece.id === 23) continue; const left = piece.column > 0 ? piece.id - 1 : null; const up = piece.row > 0 ? piece.id - columns : null; if (left !== null) next = connectGroups(next, geometry, "ADVENTURER", left, piece.id); else if (up !== null) next = connectGroups(next, geometry, "ADVENTURER", up, piece.id); }
      return next;
    });
    const { page, env, input } = s;     await input.down(env.screen(8 + 5.65, 6 + 3.6)); await input.up();
    await page.waitForFunction(() => !document.querySelector("canvas") || document.querySelector("canvas")?.parentElement?.getAttribute("aria-busy") === "false", null, { timeout: 8000 });
    await sleep(500); const state = await s.api({ action: "resume", sessionId: s.state.id }); report["solo-complete"] = { status: state.status };
    assert.equal(state.status, "COMPLETED", "voltooid: de bevestigde stand is leidend, ook tijdens de animatie"); assert.equal(await page.locator("canvas").count(), 0, "de voltooiingsstap is zichtbaar en er blijft geen canvas of animatie achter");
    assert.deepEqual(s.errors, []); await s.context.close();
  }
  {
    const s = await soloSession("desktop", (snapshot) => { place(snapshot.groups, 0, 4, 4); place(snapshot.groups, 1, 5.2, 4.1); return snapshot; });
    await s.input.down(s.env.screen(5.7, 4.6)); await s.input.up(); await sleep(60); await s.page.goBack().catch(() => undefined); await s.page.goto(`${base}/`); await sleep(400);
    const idle = await s.page.evaluate(() => new Promise((resolve) => { const before = window.__draws; setTimeout(() => resolve(window.__draws - before), 500); })); report["solo-unmount"] = { idleDraws: idle, errors: s.errors.length };
    assert.deepEqual(s.errors, [], "navigeren tijdens de animatie geeft geen fouten"); await s.context.close();
  }

  // --- Samen: snap bij beide spelers, remote bewegingen, twee gelijktijdige spelers, herverbinding
  {
    const [a, b] = [await person(), await person()]; await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
    const probe = await browser.newContext(); const probePage = await probe.newPage(); await probePage.goto("about:blank"); await ensureDefinition(probePage); await probe.close();
    const geometry = createPuzzleGeometry(24, definition.seed, 2);
    const variant = await prisma.puzzleVariant.upsert({ where: { definitionId_pieceCount_difficulty_rulesVersion: { definitionId: definition.id, pieceCount: 24, difficulty: "ADVENTURER", rulesVersion: 2 } }, create: { definitionId: definition.id, pieceCount: 24, difficulty: "ADVENTURER", rulesVersion: 2 }, update: {} });
    const make = async () => {
      const groups = stacked(geometry, "ADVENTURER"); place(groups, 0, 4, 4); place(groups, 1, 5.2, 4.1); place(groups, 2, 4, 7.5); place(groups, 3, 5.2, 7.6); place(groups, 8, 9, 4);
      const snapshot = { ...newPuzzleSnapshot(geometry, "ADVENTURER"), groups };
      const session = await prisma.puzzleSession.create({ data: { ownerId: a.id, variantId: variant.id, mode: "COOP", snapshot: JSON.stringify(snapshot) } });
      await prisma.puzzleSessionParticipant.create({ data: { sessionId: session.id, userId: a.id, role: "OWNER" } }); await prisma.puzzleSessionParticipant.create({ data: { sessionId: session.id, userId: b.id } });
      return { id: session.id, snapshot };
    };
    const open = async (user, id, device = "desktop", options = {}, snapshot) => {
      const context = await newContext(user, device, options); const page = await context.newPage(); const errors = []; const sockets = []; const requests = [];
      page.on("pageerror", (e) => errors.push(e.message)); page.on("websocket", (ws) => ws.on("framesent", (f) => sockets.push(String(f.payload)))); page.on("request", (r) => { if (!r.url().startsWith("data:")) requests.push(`${r.method()} ${new URL(r.url()).pathname}`); });
      await page.goto(`${base}/jigsaw/samen/${id}`, { waitUntil: "networkidle" }); const env = await prepare(page, geometry, snapshot); return { context, page, errors, sockets, requests, env, input: pointer(page, context, device) };
    };
    for (const device of ["desktop", "phone"]) {
      const { id, snapshot } = await make(); const A = await open(a, id, device, {}, snapshot); const B = await open(b, id, device, {}, snapshot);
      const around = { x: 5.7, y: 4.6, r: 2.2 }; await startTrack(A.page, A.env, GREEN, around); await startTrack(B.page, B.env, GREEN, around); await sleep(150);
      const sentBefore = A.sockets.length; const requestsBefore = A.requests.length;
      const grab = A.env.screen(5.7, 4.6); await A.input.down(grab); await A.input.move({ x: grab.x + 1, y: grab.y }, 1); await A.input.up(); await sleep(1100);
      const trackA = await stopTrack(A.page); await saveSheet(A.page, `samen-${device}-dragger`); const trackB = await stopTrack(B.page); await saveSheet(B.page, `samen-${device}-other`); const seriesA = distinct(trackA); const seriesB = distinct(trackB);
      const server = await prisma.puzzleSession.findUniqueOrThrow({ where: { id } }); const groups = JSON.parse(server.snapshot).groups;
      report[`samen-${device}`] = { positionsA: seriesA.length, positionsB: seriesB.length, finalA: [+seriesA.at(-1).x.toFixed(2), +seriesA.at(-1).y.toFixed(2)], finalB: [+seriesB.at(-1).x.toFixed(2), +seriesB.at(-1).y.toFixed(2)], serverGroups: groups.length };
      assert.equal(groups.length, snapshot.groups.length - 1, `Samen ${device}: de server heeft de verbinding vastgelegd`);
      for (const [who, series] of [["dragger", seriesA], ["andere speler", seriesB]]) {
        assert.ok(series.length >= 3, `Samen ${device}: ${who} ziet de snap in meerdere stappen (${series.length})`);
        assert.ok(Math.abs(series.at(-1).x - series[0].x + .2) < .06 && Math.abs(series.at(-1).y - series[0].y + .1) < .06, `Samen ${device}: ${who} eindigt op de verbindingsplek`);
      }
      assert.ok(Math.abs(seriesA.at(-1).x - seriesB.at(-1).x) < .02 && Math.abs(seriesA.at(-1).y - seriesB.at(-1).y) < .02, `Samen ${device}: beide spelers zien dezelfde definitieve stand`);
      const events = (frames) => [...new Set(frames.map((frame) => frame.match(/^\d*\["([^"]+)"/)?.[1]).filter(Boolean))].sort();
      report[`samen-${device}`].socketEvents = events(A.sockets.slice(sentBefore)); report[`samen-${device}`].requests = A.requests.slice(requestsBefore).length;
      for (const [page, who] of [[A.page, "A"], [B.page, "B"]]) { const idle = await page.evaluate(() => new Promise((resolve) => { const before = window.__draws; setTimeout(() => resolve(window.__draws - before), 800); })); assert.equal(idle, 0, `Samen ${device}: ${who} tekent na de beweging niets meer (${idle})`); }
      assert.deepEqual([...A.errors, ...B.errors], []); await A.context.close(); await B.context.close();
    }
    // Remote sleepbeweging: A sleept p8 in kleine, ruim verspreide stappen; B volgt de beweging.
    for (const reduced of [false, true]) {
      const { id, snapshot } = await make(); const A = await open(a, id, "desktop", {}, snapshot); const B = await open(b, id, "desktop", reduced ? { reducedMotion: "reduce" } : {}, snapshot);
      await A.page.waitForTimeout(300);
      // p2 (oranje) staat op (4,7.5): A sleept dat stuk naar rechts; B meet per beeld waar het getekend wordt.
      await startTrack(B.page, B.env, [230, 140, 40], { x: 6.5, y: 8, r: 3.5 });
      const from = A.env.screen(4.5, 8); await A.input.down(from);
      for (let step = 1; step <= 14; step++) { await A.input.move({ x: from.x + step * .22 * A.env.camera.scale, y: from.y + Math.sin(step / 3) * 8 }, 1); await sleep(65); }
      await sleep(350); const trackB = await stopTrack(B.page); await saveSheet(B.page, `remote-${reduced ? "reduced" : "smooth"}`, 20); await A.input.up(); await sleep(500);
      const rows = trackB.filter((sample) => sample.x !== null); const times = rows.map((sample) => sample.t); const moved = distinct(rows);
      const gaps = rows.slice(1).map((sample, index) => Math.hypot(sample.x - rows[index].x, sample.y - rows[index].y)); const biggest = Math.max(...gaps);
      const frames = rows.filter((sample, index) => index && (Math.abs(sample.x - rows[index - 1].x) > .002 || Math.abs(sample.y - rows[index - 1].y) > .002)).length;
      report[`remote-${reduced ? "reduced" : "smooth"}`] = { frames: rows.length, movedFrames: frames, positions: moved.length, biggestStep: +biggest.toFixed(3), spanMs: Math.round(times.at(-1) - times[0]) };
      if (!reduced) { assert.ok(frames >= 20, `remote beweging: de weergave verandert in veel beelden (${frames})`); assert.ok(biggest < .45, `geen zichtbare sprongen (${biggest.toFixed(2)} units)`); }
      else assert.ok(frames <= 20, `reduced motion: geen interpolatie (${frames} beelden)`);
      assert.deepEqual([...A.errors, ...B.errors], []); await A.context.close(); await B.context.close();
    }
    // Twee gelijktijdige spelers: A verbindt p1, B verbindt p3; beide eindigen op dezelfde stand zonder spookgroepen.
    {
      const { id, snapshot } = await make(); const A = await open(a, id, "desktop", {}, snapshot); const B = await open(b, id, "desktop", {}, snapshot);
      await Promise.all([startTrack(A.page, A.env, GREEN, { x: 5.7, y: 4.6, r: 2.2 }), startTrack(B.page, B.env, GREEN, { x: 5.7, y: 4.6, r: 2.2 })]);
      await Promise.all([(async () => { const g = A.env.screen(5.7, 4.6); await A.input.down(g); await A.input.move({ x: g.x + 1, y: g.y }, 1); await A.input.up(); })(), (async () => { const g = B.env.screen(5.7, 8.1); await B.input.down(g); await B.input.move({ x: g.x + 1, y: g.y }, 1); await B.input.up(); })()]);
      await sleep(1200); await Promise.all([stopTrack(A.page), stopTrack(B.page)]);
      const server = await prisma.puzzleSession.findUniqueOrThrow({ where: { id } }); const groups = JSON.parse(server.snapshot).groups;
      report["samen-simultaan"] = { serverGroups: groups.length, expected: snapshot.groups.length - 2 };
      assert.equal(groups.length, snapshot.groups.length - 2, "beide gelijktijdige verbindingen zijn vastgelegd");
      for (const page of [A.page, B.page]) { const idle = await page.evaluate(() => new Promise((resolve) => { const before = window.__draws; setTimeout(() => resolve(window.__draws - before), 800); })); assert.equal(idle, 0, "geen blijvende animatie"); }
      assert.deepEqual([...A.errors, ...B.errors], []); await A.context.close(); await B.context.close();
    }
    // Herverbinden tijdens de animatie: B verliest de verbinding precies bij A's snap en komt terug; de eindstand is gelijk en er blijft niets hangen.
    {
      const { id, snapshot } = await make(); const A = await open(a, id, "desktop", {}, snapshot); const B = await open(b, id, "desktop", {}, snapshot);
      await B.context.setOffline(true); const g = A.env.screen(5.7, 4.6); await A.input.down(g); await A.input.move({ x: g.x + 1, y: g.y }, 1); await A.input.up(); await sleep(400); await B.context.setOffline(false);
      await startTrack(B.page, B.env, GREEN, { x: 5.7, y: 4.6, r: 2.2 }); await sleep(2500); const trackB = await stopTrack(B.page); const finalB = distinct(trackB).at(-1);
      await startTrack(A.page, A.env, GREEN, { x: 5.7, y: 4.6, r: 2.2 }); await sleep(200); const trackA = await stopTrack(A.page); const finalA = distinct(trackA).at(-1);
      report["samen-reconnect"] = { finalA: [+finalA.x.toFixed(2), +finalA.y.toFixed(2)], finalB: [+finalB.x.toFixed(2), +finalB.y.toFixed(2)] };
      assert.ok(Math.abs(finalA.x - finalB.x) < .02 && Math.abs(finalA.y - finalB.y) < .02, "na herverbinden dezelfde definitieve stand (geen achterblijvend stuk)");
      for (const page of [A.page, B.page]) { const idle = await page.evaluate(() => new Promise((resolve) => { const before = window.__draws; setTimeout(() => resolve(window.__draws - before), 800); })); assert.equal(idle, 0, "geen blijvende animatie na herverbinden"); }
      assert.deepEqual([...A.errors, ...B.errors], []); await A.context.close(); await B.context.close();
    }
  }
  writeFileSync(`${output}/metrics.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  console.log(metricsOnly ? "Motion-browser: alleen gemeten." : "Motion-browser: Solo glijbeweging (desktop, telefoon, landscape), reduced motion, voltooien en navigeren tijdens de animatie, Samen snap bij beide spelers, remote interpolatie, gelijktijdige spelers, herverbinden: groen.");
} finally {
  await browser.close(); await prisma.user.deleteMany({ where: { id: { in: users } } });
  if (definition) await prisma.puzzleDefinition.delete({ where: { id: definition.id } }).catch(() => undefined);
  await prisma.$disconnect();
}
