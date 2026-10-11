// Echte muis/touch, canvaspixels en API op de lokale wegwerpdatabase.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry.ts";
import { connectGroups, newPuzzleSnapshot } from "../src/lib/puzzle/engine.ts";
import { initialPuzzleCamera } from "../src/lib/puzzle/viewport.ts";

const database = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_puzzle_test" || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Gebruik de lokale wegwerpdatabase van test:puzzle:integration");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const output = "/tmp/versado-puzzle-browser"; mkdirSync(output, { recursive: true });
const red = [230, 60, 60], green = [50, 180, 70], blue = [40, 90, 230];
const measurements = [];
let user, definition;
try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
  user = await prisma.user.create({ data: { email: `drag-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Drag${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } });
  for (const [device, options] of [["desktop", { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }], ["mobile", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }]]) {
    const context = await browser.newContext({ ...options, serviceWorkers: "block" });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const canvas = page.locator("canvas");
    const api = async (body) => { const response = await context.request.post(`${base}/api/jigsaw-v2`, { data: body }); assert.equal(response.status(), 200, await response.text()); return response.json(); };
    await page.goto(`${base}/jigsaw`);
    if (!definition) {
      // Alleen testcontent: egale kleuren maken de zichtbaarheid van ieder lid
      // meetbaar, ongeacht antialiasing of de kleuren van bestaande afbeeldingen.
      const imageUrl = await page.evaluate(({ red, green, blue }) => {
        const c = document.createElement("canvas"); c.width = 400; c.height = 300; const ctx = c.getContext("2d");
        for (let id = 0; id < 12; id++) { const rgb = id === 0 ? red : id === 1 ? green : id >= 10 ? blue : [140, 140, 140]; ctx.fillStyle = `rgb(${rgb.join(",")})`; ctx.fillRect(id % 4 * 100, Math.floor(id / 4) * 100, 100, 100); }
        return c.toDataURL();
      }, { red, green, blue });
      const seed = `drag-${randomUUID()}`;
      definition = await prisma.puzzleDefinition.create({ data: { contentKey: seed, seed, definitionHash: seed, imageUrl, storyNumber: 1, aspectRatio: 4 / 3, geometryVersion: 2 } });
    }
    const geometry = createPuzzleGeometry(12, definition.seed, 2);
    const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const touch = device === "mobile" ? await context.newCDPSession(page) : null;
    let pointer;
    const down = async (point) => { pointer = point; if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 0 }] }); else { await page.mouse.move(point.x, point.y); await page.mouse.down(); } await settle(); };
    const move = async (point) => { pointer = point; if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, id: 0 }] }); else await page.mouse.move(point.x, point.y, { steps: 6 }); await settle(); };
    const up = async () => { if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); else await page.mouse.up(); await settle(); };
    const cancel = async () => { if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }); else { await canvas.dispatchEvent("pointercancel", { pointerId: 1 }); await page.mouse.up(); } await settle(); };
    for (const kind of ["piece", "group", "rotated-group"]) {
      const rotated = kind === "rotated-group", grouped = kind !== "piece";
      const dx = rotated ? .1 : 0, dy = rotated ? 0 : .1;
      const difficulty = rotated ? "MASTER" : "ADVENTURER";
      let snapshot = newPuzzleSnapshot(geometry, difficulty);
      snapshot.groups = snapshot.groups.map((g) => ({ ...g, x: .6, y: .6, rotation: 0 }));
      snapshot.groups[0] = { ...snapshot.groups[0], x: 4, y: 4 };
      if (grouped) { snapshot.groups[1] = { ...snapshot.groups[1], x: 5, y: 4 }; snapshot = connectGroups(snapshot, geometry, difficulty, 0, 1); }
      snapshot.groups.find((g) => g.id === "p0").rotation = rotated ? 90 : 0;
      Object.assign(snapshot.groups.find((g) => g.id === "p11"), rotated ? { x: 4.2, y: 4.35 } : { x: 4.35, y: 4 });
      Object.assign(snapshot.groups.find((g) => g.id === "p10"), rotated ? { x: 4.2, y: 5.35 } : { x: 5.35, y: 4 });
      const variant = await prisma.puzzleVariant.upsert({ where: { definitionId_pieceCount_difficulty_rulesVersion: { definitionId: definition.id, pieceCount: 12, difficulty, rulesVersion: 1 } }, create: { definitionId: definition.id, pieceCount: 12, difficulty, rulesVersion: 1 }, update: {} });
      const session = await prisma.puzzleSession.create({ data: { ownerId: user.id, variantId: variant.id, snapshot: JSON.stringify(snapshot) } });
      let state = await api({ action: "resume", sessionId: session.id });
      await page.evaluate((id) => localStorage.setItem("versado:jigsaw-v2-session", id), state.id);
      await page.reload(); await canvas.waitFor();
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.waitForFunction(() => { const c = document.querySelector("canvas"), h = document.querySelector("[data-sticky-header]"); return c && h && Math.abs(c.getBoundingClientRect().top - h.getBoundingClientRect().bottom) < 1 && c.width === Math.round(c.clientWidth * Math.min(devicePixelRatio, 2)); });
      await page.evaluate(async (src) => { const image = new Image(); image.src = src; await image.decode(); }, state.image); await settle();
      const bounds = await canvas.boundingBox(); const camera = initialPuzzleCamera(bounds, geometry, state.snapshot);
      const screen = (x, y) => ({ x: bounds.x + camera.x + x * camera.scale, y: bounds.y + camera.y + y * camera.scale });
      const pixel = async (x, y) => { const point = screen(x, y); return canvas.evaluate((c, p) => { const r = c.getBoundingClientRect(), d = Math.min(devicePixelRatio, 2); return [...c.getContext("2d").getImageData(Math.floor((p.x - r.x) * d), Math.floor((p.y - r.y) * d), 1, 1).data].slice(0, 3); }, point); };
      const checkMembers = async (dx, dy, foreground) => {
        const samples = rotated ? [[4.5 + dx, 4.65 + dy, red], [4.5 + dx, 5.65 + dy, green]] : [[4.65 + dx, 4.5 + dy, red], [5.65 + dx, 4.5 + dy, green]];
        for (const [x, y, color] of samples.slice(0, grouped ? 2 : 1)) assert.deepEqual(await pixel(x, y), foreground ? color : blue, `${device}/${kind}: ${foreground ? "actieve groepsleden bovenop" : "tijdelijke prioriteit opgeheven"}`);
      };
      const pick = (dx = 0, dy = 0) => rotated ? screen(4.5 + dx, 4.02 + dy) : screen(4.02 + dx, 4.5 + dy);
      await checkMembers(0, 0, false);
      const shadowBefore = await pixel(4.5, 4 - 6 / camera.scale);
      await down(pick()); await checkMembers(0, 0, true); // Ook vóór de eerste pointermove.
      const shadowDuring = await pixel(4.5, 4 - 6 / camera.scale);
      assert.ok(shadowDuring.reduce((sum, value) => sum + value, 0) < shadowBefore.reduce((sum, value) => sum + value, 0), "lift werpt subtiele schaduw buiten de contour");
      assert.deepEqual((await api({ action: "resume", sessionId: state.id })).snapshot, state.snapshot, "oppakken schrijft geen speelstatus");
      const from = pick(), to = { x: from.x + dx * camera.scale, y: from.y + dy * camera.scale };
      await move(to); await checkMembers(dx, dy, true);
      await page.screenshot({ path: `${output}/drag-${device}-${kind}.png` });
      // Houd alleen het transport kort open: lift/prioriteit moeten al bij
      // pointerup verdwijnen, niet pas als de echte serveractie terugkomt.
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const hold = async (route) => { if (route.request().postDataJSON()?.operation?.kind === "move") await gate; await route.continue(); };
      await page.route("**/api/jigsaw-v2", hold);
      const response = page.waitForResponse((r) => r.url().endsWith("/api/jigsaw-v2") && r.request().postDataJSON()?.operation?.kind === "move");
      try { await up(); await checkMembers(dx, dy, false); } finally { release(); }
      state = await (await response).json(); await page.unroute("**/api/jigsaw-v2", hold);
      await page.waitForFunction(() => document.querySelector("canvas").parentElement.getAttribute("aria-busy") === "false"); await settle();
      const saved = state.snapshot.groups.find((g) => g.id === "p0");
      assert.ok(Math.abs(saved.x - (4 + dx)) < 1e-6 && Math.abs(saved.y - (4 + dy)) < 1e-6, "lift wordt niet in de positie opgeslagen");
      assert.deepEqual(state.snapshot.groups.map((g) => g.id), snapshot.groups.map((g) => g.id), "geen persistente laagverplaatsing");
      const redTop = () => canvas.evaluate((c, { point, red }) => {
        const rect = c.getBoundingClientRect(), d = Math.min(devicePixelRatio, 2), ctx = c.getContext("2d"), x = Math.floor((point.x - rect.x) * d), y = Math.floor((point.y - rect.y) * d);
        for (let offset = -8 * d; offset < 12 * d; offset++) { const rgb = ctx.getImageData(x, y + offset, 1, 1).data; if (red.every((value, i) => value === rgb[i])) return (y + offset) / d; }
        throw new Error("Geen rode bovenrand gevonden");
      }, { point: screen(rotated ? 4.5 + dx : 4.05, 4 + dy), red });
      const restingTop = await redTop();
      // Dezelfde selectie opnieuw oppakken: React hoeft geen state te wijzigen.
      await down(pick(dx, dy)); await checkMembers(dx, dy, true);
      const liftedTop = await redTop(); assert.ok(restingTop - liftedTop >= 1.5 && restingTop - liftedTop <= 2.5, "lift blijft subtiel en gebruikt schermpixels");
      await cancel(); await checkMembers(dx, dy, false); assert.equal(await redTop(), restingTop);
      assert.deepEqual((await api({ action: "resume", sessionId: state.id })).snapshot, state.snapshot, "annuleren herstelt de volledige groep");
      if (touch) {
        await down(pick(dx, dy)); await checkMembers(dx, dy, true);
        await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...pointer, id: 0 }, { x: pointer.x + 40, y: pointer.y + 60, id: 1 }] });
        await settle(); await checkMembers(dx, dy, false); // Pinch-start, nog zonder bewegen.
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await settle();
        assert.deepEqual((await api({ action: "resume", sessionId: state.id })).snapshot, state.snapshot);
      }
      measurements.push({ device, kind, liftedPixels: restingTop - liftedTop, members: saved.pieceIds, position: { x: saved.x, y: saved.y } });
    }
    assert.deepEqual(errors, [], `${device}: geen runtimefouten`);
    await touch?.detach(); await context.close();
  }
  writeFileSync(`${output}/drag-measurements.json`, JSON.stringify(measurements, null, 2));
  console.log("Drag-browser: desktop + mobiel, losse stukken/groepen/geroteerde groepen, zichtbaarheid van alle leden, prioriteit vóór beweging, schaduw, 2px lift, direct herstel bij loslaten, dezelfde selectie, annuleren en overgang naar pinch: groen.");
} finally {
  await browser.close();
  if (user) await prisma.user.delete({ where: { id: user.id } });
  if (definition) await prisma.puzzleDefinition.delete({ where: { id: definition.id } });
  await prisma.$disconnect();
}
