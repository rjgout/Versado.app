// Echte muis/touch en canvaspixels op de lokale wegwerpdatabase: slim parkeren en ruimte maken (Solo; de regels van Tegen elkaar zijn dezelfde).
//   LEARNING_TEST_DATABASE_URL=... DATABASE_URL=$LEARNING_TEST_DATABASE_URL PUZZLE_TEST_BASE_URL=http://localhost:3107 npx tsx tests/puzzle-parking.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry.ts";
import { anchorGroup, boardPosition, newPuzzleSnapshot } from "../src/lib/puzzle/engine.ts";
import { overlappingGroups } from "../src/lib/puzzle/collision.ts";
import { initialPuzzleCamera } from "../src/lib/puzzle/viewport.ts";

const database = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_puzzle_test" || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Gebruik de lokale wegwerpdatabase van test:puzzle:integration");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const red = [230, 60, 60], green = [50, 180, 70];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(ok ? "OK  " : "FAIL", name, detail); if (!ok) process.exitCode = 1; };
let user, definition;
try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
  user = await prisma.user.create({ data: { email: `park-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Park${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } });
  for (const [device, options] of [["desktop", { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }], ["mobiel", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }], ["mobiel-minder-beweging", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, reducedMotion: "reduce" }]].filter(([d]) => !process.env.ONLY || process.env.ONLY === d)) {
    const context = await browser.newContext({ ...options, serviceWorkers: "block" });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const canvas = page.locator("canvas");
    const api = async (body) => { const response = await context.request.post(`${base}/api/jigsaw-v2`, { headers: { Origin: base }, data: body }); assert.equal(response.status(), 200, await response.text()); return response.json(); };
    await page.goto(`${base}/jigsaw`);
    if (!definition) {
      const imageUrl = await page.evaluate(({ red, green }) => {
        const c = document.createElement("canvas"); c.width = 400; c.height = 300; const ctx = c.getContext("2d");
        for (let id = 0; id < 12; id++) { const rgb = id === 0 ? red : id === 1 ? green : [140, 140, 140]; ctx.fillStyle = `rgb(${rgb.join(",")})`; ctx.fillRect(id % 4 * 100, Math.floor(id / 4) * 100, 100, 100); }
        return c.toDataURL();
      }, { red, green });
      const seed = `park-${randomUUID()}`;
      definition = await prisma.puzzleDefinition.create({ data: { contentKey: seed, seed, definitionHash: seed, imageUrl, storyNumber: 1, aspectRatio: 4 / 3, geometryVersion: 2 } });
    }
    const geometry = createPuzzleGeometry(12, definition.seed, 2);
    const touch = options.isMobile ? await context.newCDPSession(page) : null;
    const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    let pointer = { x: 0, y: 0 };
    const down = async (point) => { pointer = point; if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 0 }] }); else { await page.mouse.move(point.x, point.y); await page.mouse.down(); } await frames(); };
    const move = async (point) => { pointer = point; if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, id: 0 }] }); else await page.mouse.move(point.x, point.y, { steps: 5 }); await frames(); };
    const up = async () => { if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); else await page.mouse.up(); await frames(); };
    const pinchMove = async (center, spread) => { if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: center.x - spread, y: center.y, id: 0 }, { x: center.x + spread, y: center.y, id: 1 }] }); };
    const settleActions = () => prisma.puzzleAction.count({ where: { sessionId: current.id, type: "settle" } });

    let current = null; let camera = null; let bounds = null;
    /** Een sessie met losse stukken op het (lege) bordmidden; verder alles op de standaardplek. */
    async function open(name, place, { difficulty = "ADVENTURER", mutate } = {}) {
      let snapshot = newPuzzleSnapshot(geometry, difficulty);
      for (const [id, x, y] of place) Object.assign(snapshot.groups.find((g) => g.id === `p${id}`), { x, y, rotation: 0 });
      snapshot = mutate ? mutate(snapshot) : snapshot;
      const variant = await prisma.puzzleVariant.upsert({ where: { definitionId_pieceCount_difficulty_rulesVersion: { definitionId: definition.id, pieceCount: 12, difficulty, rulesVersion: 2 } }, create: { definitionId: definition.id, pieceCount: 12, difficulty, rulesVersion: 2 }, update: {} });
      const session = await prisma.puzzleSession.create({ data: { ownerId: user.id, variantId: variant.id, snapshot: JSON.stringify(snapshot) } });
      const state = await api({ action: "resume", sessionId: session.id }); current = state;
      await page.evaluate((id) => localStorage.setItem("versado:jigsaw-v2-session", id), state.id);
      await page.reload(); await canvas.waitFor(); await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.waitForFunction(() => { const c = document.querySelector("canvas"), h = document.querySelector("[data-sticky-header]"); return c && h && Math.abs(c.getBoundingClientRect().top - h.getBoundingClientRect().bottom) < 1; });
      await page.evaluate(async (src) => { const image = new Image(); image.src = src; await image.decode(); }, state.image); await frames();
      bounds = await canvas.boundingBox(); camera = initialPuzzleCamera(bounds, geometry, state.snapshot);
      return state;
    }
    const screen = (x, y) => ({ x: bounds.x + camera.x + x * camera.scale, y: bounds.y + camera.y + y * camera.scale });
    const pixel = async (x, y) => { const point = screen(x, y); return canvas.evaluate((c, p) => { const r = c.getBoundingClientRect(), d = Math.min(devicePixelRatio, 2); return [...c.getContext("2d").getImageData(Math.floor((p.x - r.x) * d), Math.floor((p.y - r.y) * d), 1, 1).data].slice(0, 3); }, point); };
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
    const snapshotNow = async () => (await api({ action: "resume", sessionId: current.id }));
    const group = (state, id) => state.snapshot.groups.find((g) => g.id === id);
    const centre = (id, state) => { const g = group(state, id); return screen(g.x + .5, g.y + .5); };
    const waitSettled = async (timeout = 4000) => { const end = Date.now() + timeout; while (Date.now() < end) { const s = await snapshotNow(); if (s.version > lastVersion) return s; await sleep(150); } return null; };
    let lastVersion = 0;
    /** Sleep p1 (groen) boven op p0 (rood) en laat los; geeft de serverstand na de verplaatsing. */
    async function dropOnto() {
      await down(centre("p1", current)); await move(screen(5.35, 5.25)); await up();
      const end = Date.now() + 3000; let state = await snapshotNow(); while (Date.now() < end && Math.abs(group(state, "p1").x - 4.85) > .6) { await sleep(100); state = await snapshotNow(); }
      current = state; lastVersion = state.version; return state;
    }

    // ---- 1. parkeren: bovenop, direct opnieuw oppakken, na 1,5 s ruimte maken
    await open("park", [[0, 5, 5], [1, 7.6, 5.2]]);
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-${device}.png` });
    const dropped = await dropOnto(); const t0 = Date.now();
    check(`${device}: neergelegd stuk wordt niet verbonden of verankerd`, group(dropped, "p1").pieceIds.length === 1 && !group(dropped, "p1").anchored);
    check(`${device}: direct na loslaten ligt de neergelegde groep bovenop (groen boven rood)`, near(await pixel(5.6, 5.6), green), JSON.stringify(await pixel(5.6, 5.6)));
    check(`${device}: de serverstand is nog ongewijzigd (er wordt niet meteen verplaatst)`, (await snapshotNow()).version === dropped.version && (await settleActions()) === 0);
    await sleep(700);
    check(`${device}: na 0,7 s nog steeds bovenop en onaangeroerd`, near(await pixel(5.6, 5.6), green) && (await snapshotNow()).version === dropped.version);
    // opnieuw oppakken binnen 1,5 s: pakt de bovenste groep (groen), niet het rode stuk eronder
    await down(screen(5.6, 5.6)); await move(screen(5.65, 5.6)); await up();
    const repicked = await (async () => { const end = Date.now() + 3000; let s = await snapshotNow(); while (Date.now() < end && s.version === dropped.version) { await sleep(100); s = await snapshotNow(); } return s; })();
    check(`${device}: opnieuw oppakken pakt het bovenste stuk (groen) en laat het rode stuk staan`, group(repicked, "p1").x !== group(dropped, "p1").x && group(repicked, "p0").x === 5, `${group(repicked, "p1").x} ${group(repicked, "p0").x}`);
    current = repicked; lastVersion = repicked.version;
    check(`${device}: opnieuw neerleggen begint de wachttijd opnieuw (nog geen verplaatsing)`, (await settleActions()) === 0);
    const settled = await waitSettled(4500);
    check(`${device}: na 1,5 s zonder interactie maakt de server ruimte`, !!settled && (await settleActions()) === 1, `${Date.now() - t0} ms`);
    if (settled) {
      check(`${device}: de laatst neergelegde groep bleef liggen`, group(settled, "p1").x === group(repicked, "p1").x && group(settled, "p1").y === group(repicked, "p1").y);
      check(`${device}: het rode stuk week uit en overlapt niets meer`, (group(settled, "p0").x !== 5 || group(settled, "p0").y !== 5) && overlappingGroups(settled.snapshot, geometry, "p1").length === 0);
      await frames(); await sleep(250); // de schuif duurt 180 ms; bij verminderde beweging staat het direct goed
      const at = group(settled, "p0"); check(`${device}: het rode stuk wordt op zijn nieuwe plek getekend`, near(await pixel(at.x + .5, at.y + .5), red), JSON.stringify(await pixel(at.x + .5, at.y + .5)));
      if (options.reducedMotion) { /* geen animatie: dezelfde controle direct na de serverrespons is hierboven al geslaagd */ }
    }

    // ---- 2. camerabeweging (pannen) stelt ruimte maken uit
    await open("pan", [[0, 5, 5], [1, 7.6, 5.2]]);
    const droppedPan = await dropOnto();
    const emptySpot = screen(7.5, 6.5); // leeg bordmidden, ver van de losse stukken
    await down(emptySpot);
    for (let i = 1; i <= 8; i++) { await move({ x: emptySpot.x + (i % 2 ? 40 : -40), y: emptySpot.y + 20 }); await sleep(400); }
    check(`${device}: tijdens 3,2 s pannen wordt er niets verplaatst`, (await snapshotNow()).version === droppedPan.version && (await settleActions()) === 0);
    await up(); await sleep(900);
    check(`${device}: ook 0,9 s na het pannen nog niet (een nieuwe periode van 1,5 s)`, (await snapshotNow()).version === droppedPan.version);
    lastVersion = droppedPan.version; const afterPan = await waitSettled(4000);
    check(`${device}: na een rustige periode gebeurt het alsnog`, !!afterPan && (await settleActions()) === 1);

    // ---- 3. zoomen stelt ruimte maken uit (muiswiel of pinch)
    await open("zoom", [[0, 5, 5], [1, 7.6, 5.2]]);
    const droppedZoom = await dropOnto();
    if (!touch) { for (let i = 0; i < 8; i++) { await page.mouse.move(bounds.x + 600, bounds.y + 400); await page.mouse.wheel(0, i % 2 ? 120 : -120); await sleep(400); } }
    else {
      const c = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x - 40, y: c.y, id: 0 }, { x: c.x + 40, y: c.y, id: 1 }] });
      for (let i = 1; i <= 8; i++) { await pinchMove(c, 40 + i * 8); await sleep(400); }
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    check(`${device}: tijdens 3,2 s zoomen wordt er niets verplaatst`, (await snapshotNow()).version === droppedZoom.version && (await settleActions()) === 0);
    lastVersion = droppedZoom.version; const afterZoom = await waitSettled(4500);
    check(`${device}: na het zoomen en een rustige periode wordt alsnog ruimte gemaakt`, !!afterZoom && (await settleActions()) === 1);

    // ---- 4. een groep vasthouden voorkomt opruimen
    await open("hold", [[0, 5, 5], [1, 7.6, 5.2]]);
    const droppedHold = await dropOnto(); await sleep(500);
    await down(screen(5.6, 5.6)); await sleep(2600);
    check(`${device}: een opnieuw opgepakt stuk wordt tijdens het vasthouden niet door het opruimen verplaatst`, (await snapshotNow()).version === droppedHold.version && (await settleActions()) === 0);
    await up(); lastVersion = (await snapshotNow()).version;

    // ---- 5. het allerlaatste stuk verbindt en voltooit; nooit weggeschoven
    const openLast = async () => open("laatste", [], { mutate: (snap) => {
      let s = snap; for (const piece of geometry.pieces.filter((p) => p.id !== 11)) { const to = boardPosition(geometry, { id: `p${piece.id}`, pieceIds: [piece.id], x: 0, y: 0, rotation: 0 }); s = { ...s, groups: s.groups.map((g) => g.id === `p${piece.id}` ? { ...g, x: to.x, y: to.y } : g) }; s = anchorGroup(s, geometry, "ADVENTURER", `p${piece.id}`); }
      const to = boardPosition(geometry, { id: "p11", pieceIds: [11], x: 0, y: 0, rotation: 0 }); return { ...s, groups: s.groups.map((g) => g.id === "p11" ? { ...g, x: to.x + .2, y: to.y + .15 } : g) };
    } });
    const last = await openLast(); const lastGroup = group(last, "p11"); assert.ok(lastGroup && !lastGroup.anchored);
    await down(screen(lastGroup.x + .5, lastGroup.y + .5)); await move(screen(lastGroup.x + .5 - .1, lastGroup.y + .5 - .05)); await up();
    let finished = null; for (let i = 0; i < 40 && !finished; i++) { const s = await snapshotNow(); if (s.status === "COMPLETED") finished = s; else await sleep(150); }
    check(`${device}: het laatste stuk voltooit de puzzel direct (bestaande voltooiingsprocedure)`, !!finished && !!finished.snapshot.completedAt);
    await sleep(2200);
    const afterLast = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: last.id } });
    check(`${device}: daarna wordt er niets meer verplaatst of teruggezet`, afterLast.status === "COMPLETED" && (await settleActions()) === 0 && JSON.parse(afterLast.snapshot).groups.every((g) => g.anchored === true || JSON.parse(afterLast.snapshot).groups.length === 1));

    check(`${device}: geen runtimefouten`, errors.length === 0, errors.join(" | "));
    await touch?.detach(); await context.close();
  }
  // ---- Samen: server-authoritative ruimte maken, met respect voor locks van anderen
  {
    const { createCoopSession, respondToCoopInvite, acquireCoopLock, releaseCoopLocks } = await import("../src/lib/puzzle/coop.ts");
    const { jigsawCatalog } = await import("../src/lib/jigsawGame.ts");
    const other = await prisma.user.create({ data: { email: `park2-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Pk${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: user.activeContentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } });
    await prisma.friendship.create({ data: { senderId: user.id, receiverId: other.id, status: "ACCEPTED" } });
    const g24 = createPuzzleGeometry(24, "x", 2);
    for (const variant of ["vrij", "gelockt"]) {
      const sessionId = await createCoopSession(user.id, jigsawCatalog[0].url, 24, "ADVENTURER", [other.id]);
      const invite = await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId, toUserId: other.id } }); await respondToCoopInvite(other.id, invite.id, true);
      const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: sessionId }, include: { variant: { include: { definition: true } } } });
      const geometry = createPuzzleGeometry(24, row.variant.definition.seed, row.variant.definition.geometryVersion);
      const snapshot = JSON.parse(row.snapshot);
      for (const [id, x, y] of [[0, 5, 5], [1, 9.2, 5.3]]) Object.assign(snapshot.groups.find((g) => g.id === `p${id}`), { x, y, rotation: 0 });
      await prisma.puzzleSession.update({ where: { id: sessionId }, data: { snapshot: JSON.stringify(snapshot) } });
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
      await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
      const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/jigsaw/samen/${sessionId}`, { waitUntil: "networkidle" }); const canvas = page.locator("canvas").first(); await canvas.waitFor();
      await page.waitForTimeout(800);
      const box = await canvas.boundingBox(); const cam = initialPuzzleCamera(box, geometry, snapshot);
      const at = (x, y) => ({ x: box.x + cam.x + x * cam.scale, y: box.y + cam.y + y * cam.scale });
      const lock = variant === "gelockt" ? await acquireCoopLock(other.id, sessionId, "p0") : null;
      const from = at(9.7, 5.8); const to = at(5.45, 5.3);
      await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up();
      const read = async () => { const r = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: sessionId } }); const snap = JSON.parse(r.snapshot); return { version: r.version, p0: snap.groups.find((g) => g.id === "p0"), p1: snap.groups.find((g) => g.id === "p1"), snap }; };
      let dropped = await read(); for (let i = 0; i < 30 && Math.abs(dropped.p1.x - 9.2) < .01; i++) { await sleep(100); dropped = await read(); }
      const actions = () => prisma.puzzleAction.count({ where: { sessionId, type: "settle" } });
      if (variant === "vrij") {
        check("samen/vrij: het neergelegde stuk staat in de gedeelde stand (nog geen opruiming)", Math.abs(dropped.p1.x - 9.2) > .5 && (await actions()) === 0);
        await sleep(900); check("samen/vrij: na 0,9 s nog onaangeroerd", (await actions()) === 0);
      }
      await sleep(2500); const after = await read();
      if (variant === "vrij") {
        check("samen/vrij: na 1,5 s maakt de server atomair ruimte (één settle-actie, één versie)", (await actions()) === 1 && after.version === dropped.version + 1, `v${dropped.version}→v${after.version}`);
        check("samen/vrij: de laatst neergelegde groep bleef liggen en het andere stuk week uit", after.p1.x === dropped.p1.x && (after.p0.x !== 5 || after.p0.y !== 5) && overlappingGroups(after.snap, geometry, "p1").length === 0);
      } else {
        check("samen/gelockt: een groep die een andere speler vasthoudt beweegt nooit", after.p0.x === 5 && after.p0.y === 5);
        check("samen/gelockt: het losse stuk zoekt zelf een vrije plek (settle-actie door de server)", (await actions()) >= 1 && (after.p1.x !== 9.2) && overlappingGroups(after.snap, geometry, "p1").length === 0);
        await releaseCoopLocks(other.id, sessionId, { tokens: [lock.token] });
      }
      const part = await prisma.puzzleSessionParticipant.findFirstOrThrow({ where: { sessionId, userId: user.id } });
      check(`samen/${variant}: uitwijken telt niet als verbinding`, part.connectionsMade === 0);
      check(`samen/${variant}: geen runtimefouten`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
    void g24;
    await prisma.user.delete({ where: { id: other.id } });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nParkeren: ${results.length - failed.length}/${results.length} gelukt`);
  if (failed.length) process.exitCode = 1;
} finally {
  await browser.close();
  if (user) await prisma.user.delete({ where: { id: user.id } });
  if (definition) await prisma.puzzleDefinition.delete({ where: { id: definition.id } });
  await prisma.$disconnect();
}
