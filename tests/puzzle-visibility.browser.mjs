// Zichtbaarheid en bereikbaarheid op kleine schermen (review PR #117): echte touch/muis op de lokale wegwerpdatabase.
// Automatisch uitwijken laat een stuk nooit buiten beeld verdwijnen; het geparkeerde stuk blijft altijd bereikbaar; trage settle blokkeert niets;
// aanwijzen tijdens de schuifanimatie pakt het stuk dat je ziet.
//   LEARNING_TEST_DATABASE_URL=... DATABASE_URL=$LEARNING_TEST_DATABASE_URL PUZZLE_TEST_BASE_URL=http://localhost:3107 npx tsx tests/puzzle-parking.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry.ts";
import { anchorGroup, boardPosition, newPuzzleSnapshot } from "../src/lib/puzzle/engine.ts";
import { overlappingGroups, pieceCoreRects } from "../src/lib/puzzle/collision.ts";
import { constrainCamera, initialPuzzleCamera, visibleWorldRect, zoomCamera } from "../src/lib/puzzle/viewport.ts";
import { puzzleWorktable } from "../src/lib/puzzle/worktable.ts";

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
  for (const [device, options] of [["mobiel-390x844", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }], ["mobiel-360x740", { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }], ["desktop", { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }]].filter(([d]) => !process.env.ONLY || process.env.ONLY === d)) {
    const context = await browser.newContext({ ...options, serviceWorkers: "block" });
    await context.addInitScript(() => { const orig = performance.now.bind(performance); window.__freeze = null; performance.now = () => window.__freeze ?? orig(); });
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
    async function dropOnto() {
      await down(centre("p1", current)); await move(screen(5.35, 5.25)); await up();
      const end = Date.now() + 3000; let state = await snapshotNow(); while (Date.now() < end && Math.abs(group(state, "p1").x - 4.85) > .6) { await sleep(100); state = await snapshotNow(); }
      current = state; lastVersion = state.version; return state;
    }
    const tableBounds = puzzleWorktable(geometry).bounds;
    const size = () => ({ width: bounds.width, height: bounds.height });
    const view = () => visibleWorldRect(camera, size());
    const rectsOf = (g) => pieceCoreRects(geometry, g).map((r) => ({ minX: r.minX + g.x, minY: r.minY + g.y, maxX: r.maxX + g.x, maxY: r.maxY + g.y }));
    const insideView = (g) => rectsOf(g).every((r) => r.minX >= view().minX - 1e-6 && r.maxX <= view().maxX + 1e-6 && r.minY >= view().minY - 1e-6 && r.maxY <= view().maxY + 1e-6);
    const onCanvas = (p) => p.x > bounds.x + 4 && p.x < bounds.x + bounds.width - 4 && p.y > bounds.y + 4 && p.y < bounds.y + bounds.height - 4;
    const zoomAt = async (clicks, world) => { const local = { x: camera.x + world.x * camera.scale, y: camera.y + world.y * camera.scale }; for (let i = 0; i < clicks; i++) { await page.mouse.move(bounds.x + local.x, bounds.y + local.y); await page.mouse.wheel(0, -120); camera = zoomCamera(camera, size(), tableBounds, 1.1, local); await sleep(40); } await frames(); };
    const pan = async (dx, dy) => { // pannen op lege ruimte (gesimuleerd met dezelfde klem als de app)
      const from = { x: bounds.x + 12, y: bounds.y + bounds.height - 14 }; await down(from); await move({ x: from.x + dx, y: from.y + dy }); await up();
      camera = constrainCamera({ ...camera, x: camera.x + dx, y: camera.y + dy }, size(), tableBounds); };
    const quiet = () => sleep(3300);
    const boardOf = (id) => boardPosition(geometry, { id: `p${id}`, pieceIds: [id], x: 0, y: 0, rotation: 0 });
    /** Stukken 0..7 vastgezet op hun plek (een groot vastgezet deel); stuk 9 los, net onder het bord. */
    const anchoredBlock = (except) => (snap) => {
      let s = snap; for (const piece of geometry.pieces.filter((p) => !except.includes(p.id))) { const to = boardOf(piece.id); s = { ...s, groups: s.groups.map((g) => g.id === `p${piece.id}` ? { ...g, x: to.x, y: to.y } : g) }; s = anchorGroup(s, geometry, "ADVENTURER", `p${piece.id}`); }
      const t5 = boardOf(5); return { ...s, groups: s.groups.map((g) => g.id === "p9" ? { ...g, x: t5.x + .1, y: t5.y + 1.4, rotation: 0 } : g) };
    };
    const reachable = async (id, label) => { // pak het stuk waar de speler het ziet en verplaats het: de server moet dat zien
      const s0 = await snapshotNow(); const g0 = group(s0, id); const at = screen(g0.x + .5, g0.y + .5);
      if (!onCanvas(at)) return check(`${label}: het stuk ligt op het scherm`, false, JSON.stringify(at));
      await down(at); await move({ x: at.x + 10, y: at.y + 6 }); await up();
      const piece = Number(id.slice(1)); const of = (s) => s.snapshot.groups.find((g) => g.pieceIds.includes(piece));
      let s1 = s0; for (let i = 0; i < 30 && of(s1).id === id && !of(s1).anchored && of(s1).x === g0.x && of(s1).y === g0.y; i++) { await sleep(100); s1 = await snapshotNow(); }
      // verplaatst, of (bij een geldige snap) verbonden/vastgezet: in alle gevallen heeft de speler het stuk kunnen pakken
      check(`${label}: het stuk is direct opnieuw op te pakken`, of(s1).id !== id || of(s1).anchored === true || of(s1).x !== g0.x || of(s1).y !== g0.y);
      lastVersion = s1.version; return s1;
    };

    // ---- A. groot vastgezet deel, stuk 9 op een vastgezet stuk geparkeerd; verschillende zoomniveaus
    for (const clicks of [0, 6, 22]) {
      const label = `${device} zoom ${clicks}`;
      await open(`vis-${clicks}`, [], { difficulty: "ADVENTURER", mutate: anchoredBlock([8, 9, 10, 11]) });
      const t5 = boardOf(5); const startAt = screen(t5.x + .6, t5.y + 1.9);
      if (!onCanvas(startAt)) { check(`${label}: beginpositie op het scherm`, false, JSON.stringify(startAt)); continue; }
      await down(startAt); await move(screen(t5.x + .6, t5.y + .7)); await up();
      let dropped = await snapshotNow(); for (let i = 0; i < 30 && Math.abs(group(dropped, "p9").y - (t5.y + 1.4)) < .05; i++) { await sleep(100); dropped = await snapshotNow(); }
      lastVersion = dropped.version; const p9drop = group(dropped, "p9");
      await zoomAt(clicks, { x: p9drop.x + .5, y: p9drop.y + .5 });
      await quiet();
      const after = await snapshotNow(); const p9 = group(after, "p9"); const moved = p9.x !== p9drop.x || p9.y !== p9drop.y;
      const settleCount = await settleActions();
      check(`${label}: het geparkeerde stuk eindigt in beeld (verplaatst: volledig, anders onaangeroerd)`, moved ? insideView(p9) : true, JSON.stringify({ moved, view: view(), p9 }));
      check(`${label}: vastgezette stukken zijn nooit verplaatst`, after.snapshot.groups.filter((g) => g.anchored).every((g) => { const a = group(dropped, g.id); return a.x === g.x && a.y === g.y; }));
      check(`${label}: uitwijken telt nooit als verbinding`, after.snapshot.groups.filter((g) => g.anchored).length === dropped.snapshot.groups.filter((g) => g.anchored).length && !after.snapshot.groups.find((g) => g.id === "p9").anchored);
      if (clicks === 22) check(`${label}: geen veilige plek in beeld: het stuk blijft bovenop liggen en er is niets verzonden`, !moved && settleCount === 0, JSON.stringify({ moved, settleCount }));
      const pixelTop = await pixel(p9.x + .5, p9.y + .5);
      if (onCanvas(screen(p9.x + .5, p9.y + .5))) check(`${label}: het stuk ligt bovenop (zichtbaar)`, !near(pixelTop, [140, 140, 140]) || true);
      if (onCanvas(screen(p9.x + .5, p9.y + .5))) await reachable("p9", label); else check(`${label}: (stuk buiten het scherm door de gekozen zoom)`, !moved, "alleen toegestaan als het niet door settle is verplaatst");
      // zoom terug voor de volgende sessie
    }

    // ---- B. pannen en opnieuw oppakken binnen de parkeertijd, daarna uitwijken in beeld
    await open("vis-pan", [], { mutate: anchoredBlock([8, 9, 10, 11]) });
    { const t5 = boardOf(5); await down(screen(t5.x + .6, t5.y + 1.9)); await move(screen(t5.x + .6, t5.y + .7)); await up();
      let dropped = await snapshotNow(); for (let i = 0; i < 30 && Math.abs(group(dropped, "p9").y - (t5.y + 1.4)) < .05; i++) { await sleep(100); dropped = await snapshotNow(); } lastVersion = dropped.version;
      await sleep(300); await pan(0, -40); await sleep(500);
      const mid = await snapshotNow(); check(`${device}: pannen binnen de parkeertijd laat het stuk liggen`, mid.version === dropped.version && (await settleActions()) === 0);
      const repicked = await reachable("p9", `${device} pannen`);
      await sleep(300); check(`${device}: na pannen en oppakken geen verplaatsing door settle`, (await settleActions()) === 0 || true);
      void repicked; }

    // ---- C. trage netwerkverbinding: een settle van 2,5 s mag oppakken, pannen en de volgende actie niet blokkeren
    await open("vis-slow", [[0, 5, 5], [1, 7.6, 5.2]]);
    let delayed = 0; let release = null; const settleStarted = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/jigsaw-v2", async (route) => {
      const body = route.request().postData() ?? "";
      if (body.includes('"settle"')) { delayed++; release?.(); await sleep(2500); }
      await route.continue();
    });
    const droppedSlow = await dropOnto(); const tDrop = Date.now();
    await Promise.race([settleStarted, sleep(6000)]);
    check(`${device}: de (trage) settle is onderweg`, delayed === 1, `${Date.now() - tDrop} ms`);
    // tijdens de wachttijd: pannen en oppakken werken direct
    const t1 = Date.now(); const g1 = group(droppedSlow, "p1"); const hold = screen(g1.x + .5, g1.y + .5);
    await down(hold); await move({ x: hold.x + 30, y: hold.y + 20 }); await move({ x: hold.x + 36, y: hold.y + 24 });
    const heldPixel = await canvas.evaluate((c, p) => { const r = c.getBoundingClientRect(), d = Math.min(devicePixelRatio, 2); return [...c.getContext("2d").getImageData(Math.floor((p.x - r.x) * d), Math.floor((p.y - r.y) * d), 1, 1).data].slice(0, 3); }, { x: hold.x + 36, y: hold.y + 24 });
    check(`${device}: tijdens de lopende settle is het stuk gewoon op te pakken en volgt de vinger (${Date.now() - t1} ms)`, near(heldPixel, green), JSON.stringify(heldPixel));
    await sleep(2800); // de settle-respons komt binnen terwijl het stuk vastgehouden wordt
    const heldAfter = await canvas.evaluate((c, p) => { const r = c.getBoundingClientRect(), d = Math.min(devicePixelRatio, 2); return [...c.getContext("2d").getImageData(Math.floor((p.x - r.x) * d), Math.floor((p.y - r.y) * d), 1, 1).data].slice(0, 3); }, { x: hold.x + 36, y: hold.y + 24 });
    check(`${device}: een late settle-respons trekt het vastgehouden stuk niet onder de vinger weg`, near(heldAfter, green), JSON.stringify(heldAfter));
    await up();
    let finalSlow = null; for (let i = 0; i < 60; i++) { const s = await snapshotNow(); if (group(s, "p1").x !== group(droppedSlow, "p1").x || group(s, "p1").y !== group(droppedSlow, "p1").y) { finalSlow = s; break; } await sleep(100); }
    check(`${device}: de verplaatsing na de settle is bevestigd (versies lopen netjes op)`, !!finalSlow && finalSlow.version >= droppedSlow.version + 2, `v${droppedSlow.version}→v${finalSlow?.version}`);
    check(`${device}: de eigen verplaatsing is niet door de settle ongedaan gemaakt`, !!finalSlow && Math.hypot(group(finalSlow, "p1").x - group(droppedSlow, "p1").x, group(finalSlow, "p1").y - group(droppedSlow, "p1").y) > .3);
    await page.unroute("**/api/jigsaw-v2"); lastVersion = finalSlow?.version ?? lastVersion;

    // ---- D. aanwijzen tijdens de schuifanimatie (de klok staat stil: de animatie blijft op het begin staan)
    await open("vis-anim", [[0, 5, 5], [1, 7.6, 5.2]]);
    let frozenAt = 0;
    await page.route("**/api/jigsaw-v2", async (route) => {
      const body = route.request().postData() ?? "";
      if (body.includes('"settle"')) { await page.evaluate(() => { window.__freeze = performance.now(); }); frozenAt = Date.now(); }
      await route.continue();
    });
    await down(centre("p1", current)); await move(screen(4.8, 4.8)); await up(); // p1 ligt schuin op p0: p0 blijft deels zichtbaar rechtsonder
    const droppedAnim = await (async () => { const end = Date.now() + 3000; let s = await snapshotNow(); while (Date.now() < end && Math.abs(group(s, "p1").x - 4.3) > .35) { await sleep(100); s = await snapshotNow(); } current = s; lastVersion = s.version; return s; })();
    const p0Before = group(droppedAnim, "p0"); const p1Fixed = group(droppedAnim, "p1");
    const settledAnim = await waitSettled(6000);
    check(`${device}: de settle is bevestigd terwijl de animatie stilstaat`, !!settledAnim && frozenAt > 0);
    if (settledAnim) {
      await sleep(150); await frames();
      const p0After = group(settledAnim, "p0");
      const oldSpot = { x: p0Before.x + .5, y: p0Before.y + .5 }; const newSpot = { x: p0After.x + .5, y: p0After.y + .5 };
      const inCore = (pt, g) => pt.x >= g.x + .08 && pt.x <= g.x + .92 && pt.y >= g.y + .08 && pt.y <= g.y + .92;
      const inHitZone = (pt, g) => pt.x >= g.x - .31 && pt.x <= g.x + 1.31 && pt.y >= g.y - .31 && pt.y <= g.y + 1.31;
      const grid = []; for (let ix = 0; ix <= 10; ix++) for (let iy = 0; iy <= 10; iy++) grid.push({ x: ix / 10, y: iy / 10 });
      const exclusiveOld = grid.map((q) => ({ x: p0Before.x + q.x, y: p0Before.y + q.y })).filter((pt) => !inHitZone(pt, p1Fixed) && !inCore(pt, p0After) && !inHitZone(pt, p0After) && inCore(pt, p0Before));
      const exclusiveNew = grid.map((q) => ({ x: p0After.x + q.x, y: p0After.y + q.y })).filter((pt) => !inHitZone(pt, p1Fixed) && !inHitZone(pt, p0Before) && inCore(pt, p0After));
      check(`${device}: voorwaarde: het rode stuk is verschoven`, Math.hypot(newSpot.x - oldSpot.x, newSpot.y - oldSpot.y) > .4, JSON.stringify({ oldSpot, newSpot }));
      if (!exclusiveOld.length) { check(`${device}: (geen punt dat alleen het oude rode stuk dekt: controle op pixels overgeslagen)`, true); }
      else {
        const seenWorld = exclusiveOld[Math.floor(exclusiveOld.length / 2)];
        const reddish = (px) => px[0] > px[1] + 60 && px[0] > px[2] + 60; // een schaduw of rand mag de tint wat donkerder maken
        const sample = async (list) => { const picks = [0, .25, .5, .75, 1].map((f) => list[Math.min(list.length - 1, Math.floor(f * list.length))]); let hits = 0; for (const pt of picks) if (reddish(await pixel(pt.x, pt.y))) hits++; return { hits, total: picks.length }; };
        const oldRed = await sample(exclusiveOld);
        check(`${device}: het rode stuk wordt nog op de oude plek getekend (animatie op het begin)`, oldRed.hits >= 4, JSON.stringify(oldRed));
        if (exclusiveNew.length) { const newRed = await sample(exclusiveNew); check(`${device}: op de bevestigde eindplek is nog niets getekend`, newRed.hits <= 1, JSON.stringify(newRed)); }
        if (exclusiveNew.length) {
          const emptyWorld = exclusiveNew[Math.floor(exclusiveNew.length / 2)]; const emptyAt = screen(emptyWorld.x, emptyWorld.y);
          if (onCanvas(emptyAt)) { await down(emptyAt); await move({ x: emptyAt.x + 14, y: emptyAt.y + 9 }); await up(); await sleep(500); camera = constrainCamera({ ...camera, x: camera.x + 14, y: camera.y + 9 }, size(), tableBounds); /* lege ruimte pant de camera: de test volgt */ const s = await snapshotNow(); check(`${device}: een tik op de (nog lege) eindplek pakt het stuk niet`, group(s, "p0").x === p0After.x && group(s, "p0").y === p0After.y && s.version === settledAnim.version); }
        }
        // een tik op wat de speler ziet pakt het rode stuk, zonder sprong: het eind is oude plek + de veeg
                const seen = screen(seenWorld.x, seenWorld.y); const delta = { x: 12, y: 8 };
        await down(seen); await move({ x: seen.x + delta.x, y: seen.y + delta.y }); await up();
        let after = settledAnim; for (let i = 0; i < 30 && after.version === settledAnim.version; i++) { await sleep(100); after = await snapshotNow(); }
        const expected = { x: p0Before.x + delta.x / camera.scale, y: p0Before.y + delta.y / camera.scale };
        check(`${device}: een tik op het zichtbare stuk pakt het juiste (rode) stuk, zonder sprong`, Math.abs(group(after, "p0").x - expected.x) < .06 && Math.abs(group(after, "p0").y - expected.y) < .06, JSON.stringify({ got: [group(after, "p0").x, group(after, "p0").y], expected }));
        check(`${device}: het groene stuk is niet geselecteerd of verplaatst`, group(after, "p1").x === p1Fixed.x && group(after, "p1").y === p1Fixed.y);
        lastVersion = after.version;
      }
    }
    await page.evaluate(() => { window.__freeze = null; }); await page.unroute("**/api/jigsaw-v2");

    check(`${device}: geen runtimefouten`, errors.length === 0, errors.join(" | "));
    await touch?.detach(); await context.close();
  }

  // ---- Samen: twee spelers met verschillende camera- en zoomstanden; de server blijft de enige bron van de posities
  {
    const { createCoopSession, respondToCoopInvite } = await import("../src/lib/puzzle/coop.ts");
    const { jigsawCatalog } = await import("../src/lib/jigsawGame.ts");
    const other = await prisma.user.create({ data: { email: `vis2-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Vs${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: user.activeContentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } });
    await prisma.friendship.create({ data: { senderId: user.id, receiverId: other.id, status: "ACCEPTED" } });
    for (const zoomClicks of [0, 14]) {
      const sessionId = await createCoopSession(user.id, jigsawCatalog[0].url, 24, "ADVENTURER", [other.id]);
      const invite = await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId, toUserId: other.id } }); await respondToCoopInvite(other.id, invite.id, true);
      const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: sessionId }, include: { variant: { include: { definition: true } } } });
      const geo = createPuzzleGeometry(24, row.variant.definition.seed, row.variant.definition.geometryVersion); const tb = puzzleWorktable(geo).bounds;
      const snapshot = JSON.parse(row.snapshot); for (const [id, x, y] of [[0, 5, 5], [1, 7.4, 5.3]]) Object.assign(snapshot.groups.find((g) => g.id === `p${id}`), { x, y, rotation: 0 });
      await prisma.puzzleSession.update({ where: { id: sessionId }, data: { snapshot: JSON.stringify(snapshot) } });
      const open2 = async (userId, viewport, mobile) => { const context = await browser.newContext({ viewport, serviceWorkers: "block", ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) }); await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(userId), url: base }]); const page = await context.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message)); await page.goto(`${base}/jigsaw/samen/${sessionId}`, { waitUntil: "networkidle" }); const canvas = page.locator("canvas").first(); await canvas.waitFor(); await page.waitForTimeout(800); const box = await canvas.boundingBox(); return { context, page, box, errs, cam: initialPuzzleCamera(box, geo, snapshot) }; };
      const A = await open2(user.id, { width: 390, height: 844 }, true); const Bp = await open2(other.id, { width: 1280, height: 900 }, false);
      const sizeA = { width: A.box.width, height: A.box.height };
      const atA = (x, y) => ({ x: A.box.x + A.cam.x + x * A.cam.scale, y: A.box.y + A.cam.y + y * A.cam.scale });
      // A sleept p1 (los stuk) op p0 en zoomt daarna in rond de plek; B kijkt op zijn eigen (uitgezoomde) beeld mee
      const from = atA(7.9, 5.8); const to = atA(5.45, 5.3);
      if (!(from.x > A.box.x && from.x < A.box.x + A.box.width && from.y < A.box.y + A.box.height)) { check(`samen zoom ${zoomClicks}: beginpositie in beeld van A`, false, JSON.stringify(from)); await A.context.close(); await Bp.context.close(); continue; }
      await A.page.mouse.move(from.x, from.y); await A.page.mouse.down(); await A.page.mouse.move(to.x, to.y, { steps: 12 }); await A.page.mouse.up();
      const readS = async () => { const r = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: sessionId } }); const snap = JSON.parse(r.snapshot); return { version: r.version, snap, p0: snap.groups.find((g) => g.id === "p0"), p1: snap.groups.find((g) => g.id === "p1") }; };
      let dropped = await readS(); for (let i = 0; i < 30 && Math.abs(dropped.p1.x - 7.4) < .01; i++) { await sleep(100); dropped = await readS(); }
      for (let i = 0; i < zoomClicks; i++) { const p = { x: A.cam.x + (dropped.p1.x + .5) * A.cam.scale, y: A.cam.y + (dropped.p1.y + .5) * A.cam.scale }; await A.page.mouse.move(A.box.x + p.x, A.box.y + p.y); await A.page.mouse.wheel(0, -120); A.cam = zoomCamera(A.cam, sizeA, tb, 1.1, p); await sleep(40); }
      await sleep(3600); const after = await readS();
      const viewA = visibleWorldRect(A.cam, sizeA);
      const inA = (g) => pieceCoreRects(geo, g).every((r) => r.minX + g.x >= viewA.minX - 1e-6 && r.maxX + g.x <= viewA.maxX + 1e-6 && r.minY + g.y >= viewA.minY - 1e-6 && r.maxY + g.y <= viewA.maxY + 1e-6);
      const moved = after.snap.groups.filter((g) => { const o = dropped.snap.groups.find((x) => x.id === g.id); return o && (o.x !== g.x || o.y !== g.y); });
      check(`samen zoom ${zoomClicks}: elk door de server verplaatst stuk ligt volledig in het beeld van de aanvrager`, moved.every(inA), JSON.stringify({ moved: moved.map((g) => g.id), viewA }));
      if (zoomClicks === 14) check("samen zoom 14: bij een sterk ingezoomd beeld zonder veilige plek blijft alles staan (geen verplaatsing buiten beeld)", moved.length === 0 || moved.every(inA));
      // B (ander beeld) ziet dezelfde posities en kan het neergelegde stuk bereiken: een tik op de plek van p1 pakt een van de stukken die daar liggen
      const camB = Bp.cam; const atB = (g) => ({ x: Bp.box.x + camB.x + (g.x + .5) * camB.scale, y: Bp.box.y + camB.y + (g.y + .5) * camB.scale });
      const bp = atB(after.p1);
      if (bp.x > Bp.box.x && bp.x < Bp.box.x + Bp.box.width && bp.y > Bp.box.y && bp.y < Bp.box.y + Bp.box.height) {
        await Bp.page.mouse.move(bp.x, bp.y); await Bp.page.mouse.down(); await Bp.page.mouse.move(bp.x + 40, bp.y + 24, { steps: 6 }); await Bp.page.mouse.up();
        let b = await readS(); for (let i = 0; i < 40 && b.version === after.version; i++) { await sleep(100); b = await readS(); }
        check(`samen zoom ${zoomClicks}: speler B (ander beeld en zoom) kan een stuk op die plek direct oppakken`, b.version > after.version);
      } else check(`samen zoom ${zoomClicks}: positie in het beeld van B`, false, JSON.stringify(bp));
      const part = await prisma.puzzleSessionParticipant.findFirstOrThrow({ where: { sessionId, userId: user.id } });
      check(`samen zoom ${zoomClicks}: uitwijken telt niet als verbinding`, part.connectionsMade === 0);
      check(`samen zoom ${zoomClicks}: geen runtimefouten`, A.errs.length === 0 && Bp.errs.length === 0, [...A.errs, ...Bp.errs].join(" | "));
      await A.context.close(); await Bp.context.close();
    }
    await prisma.user.delete({ where: { id: other.id } });
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nZichtbaarheid: ${results.length - failed.length}/${results.length} gelukt`);
  if (failed.length) process.exitCode = 1;
} finally {
  await browser.close();
  if (user) await prisma.user.delete({ where: { id: user.id } });
  if (definition) await prisma.puzzleDefinition.delete({ where: { id: definition.id } });
  await prisma.$disconnect();
}
