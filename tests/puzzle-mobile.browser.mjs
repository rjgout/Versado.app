// Echte mobiele canvasrendering en pointerevents, met API + wegwerpdatabase.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry.ts";
import { newPuzzleSnapshot, worldOf } from "../src/lib/puzzle/engine.ts";
import { puzzleWorktable } from "../src/lib/puzzle/worktable.ts";
import { initialPuzzleCamera, resizeCamera, zoomCamera } from "../src/lib/puzzle/viewport.ts";
import { jigsawCatalog } from "../src/lib/jigsawGame.ts";
import { nl } from "../src/lib/i18n/messages/nl.ts";
import { de } from "../src/lib/i18n/messages/de.ts";

const database = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_puzzle_test" || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Gebruik de lokale wegwerpdatabase van test:puzzle:integration");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const output = "/tmp/versado-puzzle-browser"; mkdirSync(output, { recursive: true });
let user, oldDefinition, page;
try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
  user = await prisma.user.create({ data: { email: `mobile-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Mobile${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } });
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, serviceWorkers: "block" });
  await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
  page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  const canvas = page.locator("canvas");
  const api = async (body) => { const response = await context.request.post(`${base}/api/jigsaw-v2`, { data: body }); assert.equal(response.status(), 200, await response.text()); return response.json(); };
  const act = (state, operation) => api({ action: "act", sessionId: state.id, version: state.version, actionId: randomUUID(), operation });
  await page.goto(`${base}/jigsaw`);
  async function open(state) {
    await page.evaluate((id) => { localStorage.setItem("versado:jigsaw-v2-session", id); localStorage.removeItem("versado:jigsaw-v2-session:question"); }, state.id);
    await page.goto(`${base}/jigsaw?legacy=1&hint=1`); await canvas.waitFor();
    // Het Next-ontwikkelicoon bestaat niet in productie en ligt anders over
    // de contextuele draaiknop. Runtimefouten blijven via pageerror zichtbaar.
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.evaluate(async (src) => { const image = new Image(); image.src = src; await image.decode(); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); }, state.image);
    return canvas.boundingBox();
  }
  async function layout(expectedSafe = { left: 0, right: 0, bottom: 0 }) {
    await page.waitForFunction(() => { const c = document.querySelector("canvas"); const h = document.querySelector("[data-sticky-header]"); return c && h && Math.abs(c.getBoundingClientRect().top - h.getBoundingClientRect().bottom) < 1; });
    const metrics = await page.evaluate(() => {
      const c = document.querySelector("canvas").getBoundingClientRect(); const h = document.querySelector("[data-sticky-header]").getBoundingClientRect();
      return { canvas: { x: c.x, y: c.y, width: c.width, height: c.height, bottom: c.bottom, right: c.right }, header: h.bottom, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight };
    });
    assert.ok(Math.abs(metrics.canvas.x - expectedSafe.left) <= 1);
    assert.ok(Math.abs(metrics.canvas.right - (metrics.width - expectedSafe.right)) <= 1);
    assert.ok(Math.abs(metrics.canvas.bottom - (metrics.height - expectedSafe.bottom)) <= 1);
    assert.ok(metrics.scrollHeight <= metrics.height + 1, JSON.stringify(metrics)); assert.ok(metrics.scrollWidth <= metrics.width);
    await page.waitForFunction(() => { const c = document.querySelector("canvas"); const ratio = Math.min(devicePixelRatio, 2); return c.width === Math.round(c.clientWidth * ratio) && c.height === Math.round(c.clientHeight * ratio); });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return metrics.canvas;
  }
  // Een echte verbonden groep, waarvan iedere pixel bij de aansluiting dezelfde
  // kleur moet hebben als de canonieke volledige afbeelding (geen naadmasker).
  let state = await api({ action: "start", imageId: jigsawCatalog[39].url, pieceCount: 12, difficulty: "ADVENTURER" });
  for (const [id, x] of [[0, 4], [1, 5]]) state = await act(state, { kind: "move", groupId: `p${id}`, x, y: 4 });
  state = await act(state, { kind: "connect", a: 0, b: 1 });
  const geometry = createPuzzleGeometry(state.pieceCount, state.seed, state.geometryVersion);
  const group = state.snapshot.groups.find((g) => g.pieceIds.includes(0));
  async function compareSeam(camera, x = 5) {
    const result = await page.evaluate(async ({ camera, imageUrl, columns, rows, group, x }) => {
      const canvas = document.querySelector("canvas"); const actual = canvas.getContext("2d");
      const image = new Image(); image.src = imageUrl; await image.decode();
      const reference = document.createElement("canvas"); reference.width = canvas.width; reference.height = canvas.height;
      const ctx = reference.getContext("2d"); const ratio = Math.min(devicePixelRatio, 2);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.translate(camera.x, camera.y); ctx.scale(camera.scale, camera.scale);
      ctx.drawImage(image, group.x, group.y, columns, rows);
      let total = 0, matches = 0, maxError = 0;
      for (let dx = -.28; dx <= .28; dx += .015) for (let dy = .33; dy <= .67; dy += .015) {
        const px = Math.round((camera.x + (x + dx) * camera.scale) * ratio); const py = Math.round((camera.y + (group.y + dy) * camera.scale) * ratio);
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
        const a = actual.getImageData(px, py, 1, 1).data; const b = ctx.getImageData(px, py, 1, 1).data;
        const error = Math.max(...Array.from(a, (value, i) => Math.abs(value - b[i]))); maxError = Math.max(maxError, error); total++; if (error <= 2) matches++;
      }
      return { total, matches, maxError };
    }, { camera, imageUrl: state.image, columns: geometry.grid.columns, rows: geometry.grid.rows, group, x });
    assert.ok(result.total > 700, JSON.stringify(result)); assert.equal(result.matches, result.total, `Aansluiting verschilt van afbeelding: ${JSON.stringify(result)}`);
    return result;
  }
  const measurements = [];
  for (const [width, height] of [[320, 568], [390, 844], [430, 932], [844, 390], [768, 1024], [1440, 900]]) {
    await page.setViewportSize({ width, height }); await open(state); const bounds = await layout();
    const camera = initialPuzzleCamera(bounds, geometry, state.snapshot);
    const pixels = await compareSeam(camera); measurements.push({ width, height, bounds, pixels });
    await page.screenshot({ path: `${output}/board-${width}x${height}.png` });
  }
  // Niet opnieuw fitten bij browserbalk/oriëntatie: zelfde wereldmidden en zoom.
  await page.setViewportSize({ width: 390, height: 844 }); await open(state); const beforeSize = await layout();
  const beforeCamera = initialPuzzleCamera(beforeSize, geometry, state.snapshot);
  await page.setViewportSize({ width: 430, height: 800 }); const afterSize = await layout();
  await compareSeam(resizeCamera(beforeCamera, beforeSize, afterSize, puzzleWorktable(geometry).bounds));
  await page.evaluate(() => { for (const [side, value] of Object.entries({ top: 20, left: 44, right: 44, bottom: 34 })) document.documentElement.style.setProperty(`--safe-area-inset-${side}`, `${value}px`); });
  await layout({ left: 44, right: 44, bottom: 34 }); await page.screenshot({ path: `${output}/safe-areas.png` });
  await page.evaluate(() => { for (const side of ["top", "left", "right", "bottom"]) document.documentElement.style.removeProperty(`--safe-area-inset-${side}`); });
  await page.setViewportSize({ width: 390, height: 844 }); await open(state);
  const touch = await context.newCDPSession(page);
  const bounds = await layout();
  const fingerprint = () => canvas.evaluate((c) => c.toDataURL());
  let previous = await fingerprint();
  const send = (type, points) => touch.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const cy = bounds.y + bounds.height * .7;
  await send("touchStart", [[150, cy], [230, cy]]); await send("touchMove", [[115, cy], [265, cy]]); await send("touchEnd", []);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.notEqual(await fingerprint(), previous, "echte tweevinger-pinch verandert camera");
  // Pan vanuit de lege ruimte onder de verbonden groep, na pinch.
  previous = await fingerprint();
  const pinched = zoomCamera(initialPuzzleCamera(bounds, geometry, state.snapshot), bounds, puzzleWorktable(geometry).bounds, 150 / 80, { x: 190, y: bounds.height * .7 });
  const panFrom = { x: bounds.x + pinched.x + 5.6 * pinched.scale, y: bounds.y + pinched.y + 6.1 * pinched.scale };
  await send("touchStart", [[panFrom.x, panFrom.y]]); await send("touchMove", [[panFrom.x - 35, panFrom.y + 10]]); await send("touchEnd", []);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.notEqual(await fingerprint(), previous, "pannen verandert camera");
  const afterTouch = await api({ action: "resume", sessionId: state.id });
  assert.equal(afterTouch.version, state.version); assert.deepEqual(afterTouch.snapshot, state.snapshot, "camera-gebaren veranderen geen speelstatus");
  await touch.detach();

  // Groep naar groep: server accepteert de snap met exact dezelfde stationaire
  // positie, ondanks ~13px afstand bij loslaten op een klein telefoonscherm.
  for (const [id, x] of [[2, 6.24], [3, 7.24]]) state = await act(state, { kind: "move", groupId: `p${id}`, x, y: 4.1 });
  state = await act(state, { kind: "connect", a: 2, b: 3 });
  state = await act(state, { kind: "move", groupId: "p4", x: 4.2, y: 5.1 });
  await page.setViewportSize({ width: 390, height: 844 }); const dragBounds = await open(state);
  const camera = initialPuzzleCamera(dragBounds, geometry, state.snapshot);
  const moving = state.snapshot.groups.find((g) => g.pieceIds.includes(2));
  const point = (x, y) => ({ x: dragBounds.x + camera.x + x * camera.scale, y: dragBounds.y + camera.y + y * camera.scale });
  const from = point(moving.x + .5, moving.y + .5); const to = point(6.7, 4.58);
  const cascade = page.waitForResponse((r) => r.url().endsWith("/api/jigsaw-v2") && r.request().postDataJSON()?.operation?.kind === "connect" && r.request().postDataJSON()?.operation?.b === 4);
  const connected = page.waitForResponse((r) => r.url().endsWith("/api/jigsaw-v2") && r.request().postDataJSON()?.operation?.kind === "connect");
  const dragTouch = await context.newCDPSession(page);
  await dragTouch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y, id: 0 }] });
  for (let i = 1; i <= 8; i++) await dragTouch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8, id: 0 }] });
  await dragTouch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await dragTouch.detach();
  await connected; state = await (await cascade).json();
  const joined = state.snapshot.groups.find((g) => g.pieceIds.includes(0));
  assert.deepEqual([...joined.pieceIds].sort((a, b) => a - b), [0, 1, 2, 3, 4]); assert.equal(joined.x, 4); assert.equal(joined.y, 4);
  assert.deepEqual(worldOf(geometry, joined, 2), { x: 6, y: 4 });
  await open(state); const joinedBounds = await layout(); await compareSeam(initialPuzzleCamera(joinedBounds, geometry, state.snapshot), 6);
  await page.screenshot({ path: `${output}/group-snap.png` });

  // Iedere moeilijkheid en een hervatte oude v1/hintstatus gebruikt dezelfde
  // huidige Solo-interface. Alleen Meester toont draaien na selectie.
  for (const [i, difficulty] of ["DISCOVERER", "ADVENTURER", "EXPERT", "MASTER"].entries()) {
    const level = await api({ action: "start", imageId: jigsawCatalog[60 + i].url, pieceCount: 24, difficulty });
    const b = await open(level); await layout();
    for (const label of [nl.jigsaw.locationHint, nl.jigsaw.connectionHint, nl.jigsaw.edgeHint]) if (label) assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: nl.jigsaw.rotate, exact: true }).count(), 0);
    if (difficulty === "MASTER") {
      const geo = createPuzzleGeometry(level.pieceCount, level.seed, level.geometryVersion); const cam = initialPuzzleCamera(b, geo, level.snapshot);
      const visible = level.snapshot.groups.find((g) => { const x = cam.x + (g.x + .5) * cam.scale; const y = cam.y + (g.y + .5) * cam.scale; return x > 20 && x < b.width - 20 && y > 20 && y < b.height - 20; }); assert.ok(visible);
      await Promise.all([page.waitForResponse((r) => r.request().postDataJSON()?.operation?.kind === "move"), page.mouse.click(b.x + cam.x + (visible.x + .5) * cam.scale, b.y + cam.y + (visible.y + .5) * cam.scale)]);
      const [rotated] = await Promise.all([page.waitForResponse((r) => r.request().postDataJSON()?.operation?.kind === "rotate"), page.getByRole("button", { name: nl.jigsaw.rotate, exact: true }).click()]);
      const next = await rotated.json(); assert.equal(next.snapshot.groups.find((g) => g.id === visible.id).rotation, (visible.rotation + 90) % 360);
      await page.setViewportSize({ width: 320, height: 568 });
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; }); await layout();
      const rotateBox = await page.getByRole("button", { name: nl.jigsaw.rotate, exact: true }).boundingBox();
      const menuBox = await page.getByRole("button", { name: nl.jigsaw.boardMenu }).boundingBox();
      assert.ok(rotateBox.x + rotateBox.width <= menuBox.x, "draaien en menu overlappen niet bij 200% tekst");
      await page.screenshot({ path: `${output}/master-320-200.png` });
      await page.evaluate(() => { document.documentElement.style.removeProperty("font-size"); });
      await page.setViewportSize({ width: 390, height: 844 });
    }
  }
  const seed = `legacy-${randomUUID()}`; const oldGeometry = createPuzzleGeometry(24, seed, 1); const snapshot = newPuzzleSnapshot(oldGeometry, "ADVENTURER");
  snapshot.hints = [{ type: "LOCATION", at: new Date().toISOString(), extra: false }]; snapshot.filter = "EDGES";
  oldDefinition = await prisma.puzzleDefinition.create({ data: { contentKey: seed, seed, definitionHash: seed, imageUrl: state.image, storyNumber: 1, aspectRatio: 1.5, geometryVersion: 1 } });
  const variant = await prisma.puzzleVariant.create({ data: { definitionId: oldDefinition.id, pieceCount: 24, difficulty: "ADVENTURER", rulesVersion: 1 } });
  const session = await prisma.puzzleSession.create({ data: { ownerId: user.id, variantId: variant.id, snapshot: JSON.stringify(snapshot) } });
  const old = await api({ action: "resume", sessionId: session.id }); assert.equal(old.geometryVersion, 1); await open(old); await layout();
  assert.equal(await page.getByRole("button", { name: /locatie|verbinding|randhint|hint gebruikt|draaien/i }).count(), 0);
  assert.deepEqual((await api({ action: "resume", sessionId: old.id })).snapshot, snapshot, "oude voortgang blijft bewaard");
  await prisma.user.update({ where: { id: user.id }, data: { uiLanguage: "de" } });
  await page.setViewportSize({ width: 320, height: 568 }); await open(old);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; }); await layout();
  await page.getByRole("button", { name: de.jigsaw.boardMenu }).click();
  const menu = await page.getByRole("button", { name: de.jigsaw.chooseAnother }).boundingBox(); assert.ok(menu.x >= 0 && menu.x + menu.width <= 320);
  await layout(); await page.screenshot({ path: `${output}/board-german-320-200.png` });
  await page.setViewportSize({ width: 844, height: 390 }); const landscape = await layout();
  const popup = await page.getByRole("button", { name: de.jigsaw.chooseAnother }).evaluate((b) => { const r = b.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, bottom: r.bottom, right: r.right }; });
  assert.ok(popup.x >= 0 && popup.right <= 844 && popup.y >= landscape.y && popup.bottom <= 390, JSON.stringify(popup));
  await page.screenshot({ path: `${output}/menu-landscape-200.png` });
  await page.getByRole("button", { name: de.jigsaw.chooseAnother }).click();
  await page.getByRole("textbox", { name: de.jigsaw.searchImages }).waitFor();
  assert.deepEqual(errors, [], "geen mobiele runtimefouten");
  writeFileSync(`${output}/mobile-measurements.json`, JSON.stringify(measurements, null, 2));
  console.log("Mobiele browser: zes schermmaten, fullscreen zonder scroll, exacte naadpixels, viewportresize, safe areas, echte pinch/pan, groep→groep snap met stationair anker, vier moeilijkheden, contextueel draaien, oude v1/hintstatus, Duits/320px/200%: groen.");
} catch (error) {
  if (page) { await page.screenshot({ path: `${output}/mobile-failure.png`, fullPage: true }).catch(() => {}); console.error(await page.locator("body").innerText().catch(() => "")); }
  throw error;
} finally {
  await browser.close();
  if (user) await prisma.user.delete({ where: { id: user.id } });
  if (oldDefinition) await prisma.puzzleDefinition.delete({ where: { id: oldDefinition.id } });
  await prisma.$disconnect();
}
