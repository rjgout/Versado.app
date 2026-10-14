// Fase 5E: geluid en haptische feedback in de echte productie-interface (Solo, Samen, Tegen elkaar) met nagebootste AudioContext en trilling.
// Dit bewijst de logica en het verkeer, niet dat een echte iPhone of luidspreker iets laat horen of voelen. Draait alleen tegen de lokale wegwerpdatabase en een draaiende productie-instance.
//   . /tmp/puzenv.sh && npx tsx tests/puzzle-feedback.browser.mjs          (SHOTS=<map> bewaart screenshots; MATRIX=1 voegt Solo 96, Samen 150/300 en live toe)
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { jigsawCatalog } from "../src/lib/jigsawGame.ts";
import { createCoopSession, respondToCoopInvite } from "../src/lib/puzzle/coop.ts";
import { startSoloPuzzle } from "../src/lib/puzzle/solo.ts";
import { createMatch, respondToMatchInvite, beginMatchAttempt, startLiveMatch } from "../src/lib/puzzle/match.ts";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry.ts";
import { boardPosition, connectGroups, newPuzzleSnapshot } from "../src/lib/puzzle/engine.ts";
import { fitCamera, initialPuzzleCamera } from "../src/lib/puzzle/viewport.ts";
import { puzzleWorktable } from "../src/lib/puzzle/worktable.ts";
import { formatPuzzleTime } from "../src/lib/puzzle/recordFormat.ts";
import { nl } from "../src/lib/i18n/messages/nl.ts";
import { jigsawQuestionsForStory } from "../src/lib/jigsawQuestions.ts";

const database = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_puzzle_test" || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Gebruik de lokale wegwerpdatabase");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const shots = process.env.SHOTS ?? "/tmp/versado-feedback"; mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const DEVICES = {
  "phone-small": { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  landscape: { viewport: { width: 740, height: 360 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
};
const users = []; const report = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const person = async (companion = "NOVI") => { const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } }); const user = await prisma.user.create({ data: { email: `cc-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Cc${randomUUID().slice(0, 6)}`, discriminator: "00", companion, hintBalance: 3, activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } }); users.push(user.id); return user; };
const place = (groups, id, x, y) => Object.assign(groups.find((group) => group.id === `p${id}`), { x, y });
const stacked = (geometry, difficulty = "ADVENTURER") => newPuzzleSnapshot(geometry, difficulty).groups.map((group) => ({ ...group, x: .6, y: .6, rotation: 0 }));
/** Alles aan elkaar behalve het laatste stuk, dat net naast zijn plek ligt: loslaten voltooit de puzzel. Origin = de bordpositie van stuk 0. */
function almostDone(geometry, difficulty = "ADVENTURER") {
  const last = geometry.pieces.length - 1; const snapshot = { ...newPuzzleSnapshot(geometry, difficulty), groups: stacked(geometry, difficulty) }; const first = boardPosition(geometry, { pieceIds: [0] });
  for (const piece of geometry.pieces) place(snapshot.groups, piece.id, first.x + piece.column, first.y + piece.row);
  const lastPiece = geometry.pieces[last]; place(snapshot.groups, last, first.x + lastPiece.column + .15, first.y + lastPiece.row + .1);
  let next = snapshot; for (const piece of geometry.pieces) { if (piece.id === last) continue; const left = piece.column > 0 ? piece.id - 1 : null; const up = piece.row > 0 ? piece.id - geometry.grid.columns : null; if (left !== null) next = connectGroups(next, geometry, difficulty, left, piece.id); else if (up !== null) next = connectGroups(next, geometry, difficulty, up, piece.id); }
  return { snapshot: next, spot: { x: first.x + lastPiece.column + .65, y: first.y + lastPiece.row + .6 } };
}
async function newContext(user, device, options = {}) {
  const ctx = await browser.newContext({ ...DEVICES[device], serviceWorkers: "block", ...options });
  await ctx.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]); return ctx;
}
async function drop(page, ctx, device, env, spot) {
  const point = { x: env.bounds.x + env.camera.x + spot.x * env.camera.scale, y: env.bounds.y + env.camera.y + spot.y * env.camera.scale };
  if (DEVICES[device].hasTouch) { const touch = await ctx.newCDPSession(page); await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 0 }] }); await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x + 1, y: point.y, id: 0 }] }); await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
  else { await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 1, point.y, { steps: 1 }); await page.mouse.up(); }
}
async function prepare(page, geometry, snapshot, fit = false) {
  const canvas = page.locator("canvas").first(); await canvas.waitFor(); await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForFunction(() => { const c = document.querySelector("canvas"), h = document.querySelector("[data-sticky-header]"); return c && h && Math.abs(c.getBoundingClientRect().top - h.getBoundingClientRect().bottom) < 1 && c.width === Math.round(c.clientWidth * Math.min(devicePixelRatio, 2)); });
  await page.waitForTimeout(600); if (fit) { await canvas.focus(); await canvas.press("0"); await page.waitForTimeout(200); } const bounds = await canvas.boundingBox(); return { bounds, camera: fit ? fitCamera({ width: bounds.width, height: bounds.height }, puzzleWorktable(geometry).bounds) : initialPuzzleCamera(bounds, geometry, snapshot) };
}
async function soloVariant(user, pieceCount, difficulty = "ADVENTURER", { hints = 0, bestMs = null } = {}) {
  const solo = await startSoloPuzzle(user.id, 5 + (pieceCount % 7), pieceCount, difficulty, "nl"); const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: solo.id }, include: { variant: { include: { definition: true } } } });
  const geometry = createPuzzleGeometry(pieceCount, row.variant.definition.seed, row.variant.definition.geometryVersion); const { snapshot, spot } = almostDone(geometry, difficulty);
  snapshot.hints = Array.from({ length: hints }, () => ({ type: "PREVIEW", at: new Date(Date.now() - 60000).toISOString(), extra: false, source: "INCLUDED", actionId: randomUUID(), expiresAt: new Date(0).toISOString(), target: { type: "PREVIEW" } }));
  await prisma.puzzleSession.update({ where: { id: solo.id }, data: { snapshot: JSON.stringify(snapshot), startedAt: new Date(Date.now() - 95_400), optionOrder: JSON.stringify([0, 1, 2]), questionId: jigsawQuestionsForStory(row.variant.definition.storyNumber)[0].id } });
  if (bestMs !== null) await prisma.puzzleBestRecord.create({ data: { userId: user.id, variantId: row.variantId, mode: "SOLO", hintCategory: hints > 0 ? "WITH_HINTS" : "NO_HINTS", elapsedMs: bestMs, hintsUsed: hints, extraHintsUsed: 0, completedAt: new Date(Date.now() - 86400000), sessionId: (await prisma.puzzleSession.create({ data: { ownerId: user.id, variantId: row.variantId, status: "ANSWERED", snapshot: "{}", answeredAt: new Date(), completedAt: new Date(Date.now() - 86400000) } })).id } });
  return { solo, row, geometry, snapshot, spot };
}
async function openSolo(user, device, variant, options = {}) {
  const ctx = await newContext(user, device, options); await ctx.addInitScript((id) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, variant.solo.id);
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); await page.goto(`${base}/jigsaw`);
  const env = await prepare(page, variant.geometry, variant.snapshot, variant.geometry.pieces.length >= 96); return { ctx, page, errors, env };
}
const heading = (page, text = nl.jigsaw.complete) => page.locator("h1", { hasText: text });
const inView = async (page, locator) => { const box = await locator.boundingBox(); const view = page.viewportSize(); return !!box && box.y >= 0 && box.y + box.height <= view.height + 1 && box.x >= 0 && box.x + box.width <= view.width + 1; };


const MODES = { "uit-uit": [false, false], "geluid": [true, false], "haptiek": [false, true], "beide": [true, true] };
/** Nagebootste Web Audio en trilling; telt alleen. Voorkeuren komen uit localStorage zoals in de echte app. */
async function spy(ctx, [sound, haptics]) {
  await ctx.addInitScript(([s, h]) => {
    window.__fb = { contexts: 0, osc: 0, vib: [], resumed: 0, closed: 0 };
    try { if (s) localStorage.setItem("versado:feedback-sound", "1"); if (h) localStorage.setItem("versado:feedback-haptics", "1"); } catch {}
    class FakeContext { constructor() { window.__fb.contexts++; this.currentTime = 0; this.state = "running"; this.destination = {}; }
      createOscillator() { window.__fb.osc++; return { frequency: {}, connect() {}, disconnect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
      resume() { window.__fb.resumed++; return Promise.resolve(); } close() { window.__fb.closed++; return Promise.resolve(); } }
    window.AudioContext = FakeContext; window.webkitAudioContext = FakeContext; navigator.vibrate = (pattern) => { window.__fb.vib.push(pattern); return true; };
  }, [sound, haptics]);
}
const counts = (page) => page.evaluate(() => ({ ...window.__fb, vib: [...window.__fb.vib] }));
function watchTraffic(page) { const t = { acts: 0, media: [], other: [] }; page.on("request", (r) => { const url = r.url(); if (/\.(mp3|wav|ogg|m4a|aac)(\?|$)/i.test(url) || /sound|feedback|haptic/i.test(new URL(url).pathname)) t.media.push(url); if (r.method() === "POST" && url.endsWith("/api/jigsaw-v2")) t.acts++; }); return t; }

try {
  // === Instellingen: beide schakelaars standaard uit, onafhankelijk, bewaard op dit apparaat, zonder serververkeer
  {
    const user = await person(); const ctx = await newContext(user, "phone"); const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const writes = []; page.on("request", (r) => { if (r.method() !== "GET" && !/\/_next\/|\/socket\.io\/|\/api\/streak\//.test(r.url())) writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await page.goto(`${base}/profile?view=gameFeedback`, { waitUntil: "networkidle" });
    const sound = page.getByRole("switch", { name: nl.profile.gameFeedback.sound }); const haptics = page.getByRole("switch", { name: nl.profile.gameFeedback.haptics });
    await sound.waitFor(); assert.equal(await sound.isChecked(), false, "geluid standaard uit"); assert.equal(await haptics.isChecked(), false, "haptiek standaard uit");
    assert.ok(await page.getByText(nl.profile.gameFeedback.saved).count() >= 1, "vermeldt: bewaard op dit apparaat");
    await page.screenshot({ path: `${shots}/settings-default-phone.png` });
    const stored = () => page.evaluate(() => [localStorage.getItem("versado:feedback-sound"), localStorage.getItem("versado:feedback-haptics")]);
    writes.length = 0; await sound.click({ force: true }); assert.deepEqual(await stored(), ["1", null], "alleen geluid aan"); assert.equal(await haptics.isChecked(), false);
    await haptics.click({ force: true }); assert.deepEqual(await stored(), ["1", "1"], "beide aan"); await sleep(500); await page.screenshot({ path: `${shots}/settings-both-phone.png` });
    await page.reload({ waitUntil: "networkidle" }); assert.equal(await page.getByRole("switch", { name: nl.profile.gameFeedback.sound }).isChecked(), true, "geluid blijft na herladen"); assert.equal(await page.getByRole("switch", { name: nl.profile.gameFeedback.haptics }).isChecked(), true, "haptiek blijft na herladen");
    await page.getByRole("switch", { name: nl.profile.gameFeedback.sound }).click({ force: true }); assert.deepEqual(await stored(), [null, "1"], "geluid uit, haptiek aan");
    await page.getByRole("switch", { name: nl.profile.gameFeedback.haptics }).click({ force: true }); assert.deepEqual(await stored(), [null, null], "beide uit");
    assert.deepEqual(writes, [], `instellingen veroorzaken geen serververkeer (${writes.join(", ")})`);
    // De profielrij staat in het overzicht
    await page.goto(`${base}/profile`, { waitUntil: "networkidle" }); assert.ok(await page.getByText(nl.profile.gameFeedback.title).count() >= 1, "rij in het profieloverzicht");
    // localStorage niet beschikbaar: de pagina blijft werken
    const blocked = await newContext(user, "phone"); await blocked.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("geblokkeerd"); } }); });
    const bp = await blocked.newPage(); const be = []; bp.on("pageerror", (e) => be.push(e.message)); await bp.goto(`${base}/profile?view=gameFeedback`, { waitUntil: "domcontentloaded" }).catch(() => undefined); await sleep(2500);
    // De feedbacklaag zelf werpt nooit een fout, ook als localStorage ontbreekt (de rest van de app valt hier buiten).
    assert.deepEqual(be.filter((m) => /feedback|versado:feedback/i.test(m)), [], "zonder localStorage: geen fout uit de feedbacklaag"); await blocked.close();
    assert.deepEqual(errors, []); await ctx.close();
  }
  // === Solo 24: per stand van de schakelaars een echte verbinding (pijltjes, niet de laatste) en de voltooiing door loslaten
  const baseline = {};
  for (const [name, mode] of Object.entries(MODES)) {
    // 1. een bevestigde verbinding via het toetsenbord (geen pickup): precies één verbindingseffect
    {
      const user = await person(); const ctx = await newContext(user, "desktop"); await spy(ctx, mode); const solo = await startSoloPuzzle(user.id, 11, 24, "ADVENTURER", "nl"); const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: solo.id }, include: { variant: { include: { definition: true } } } });
      const geometry = createPuzzleGeometry(24, row.variant.definition.seed, row.variant.definition.geometryVersion); const groups = stacked(geometry); place(groups, 0, 8, 8); place(groups, 1, 4, 4); place(groups, 2, 5.5, 4.05);
      await prisma.puzzleSession.update({ where: { id: solo.id }, data: { snapshot: JSON.stringify({ ...newPuzzleSnapshot(geometry, "ADVENTURER"), groups }) } });
      await ctx.addInitScript((id) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, solo.id);
      const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); const traffic = watchTraffic(page);
      await page.goto(`${base}/jigsaw`); const canvas = page.locator("canvas").first(); await canvas.waitFor(); await sleep(800);
      await canvas.focus(); await canvas.press("Enter"); await canvas.press("Enter"); // p1 selecteren
      let seen = await counts(page); assert.equal(seen.osc, 0, `${name}: selecteren is stil`); assert.equal(seen.vib.length, 0);
      for (let i = 0; i < 3; i++) { await canvas.press("ArrowRight"); await sleep(25); } await sleep(2200);
      const snapshot = JSON.parse((await prisma.puzzleSession.findUniqueOrThrow({ where: { id: solo.id } })).snapshot); assert.equal(snapshot.groups.length, 23, `${name}: de verbinding is server-side bevestigd`);
      seen = await counts(page);
      assert.equal(seen.osc, mode[0] ? 2 : 0, `${name}: verbindingsgeluid precies één keer (${seen.osc})`); assert.equal(seen.vib.length, mode[1] ? 1 : 0, `${name}: één lichte puls`); if (mode[1]) assert.deepEqual(seen.vib[0], [14]);
      assert.ok(seen.contexts <= 1, `${name}: hooguit één AudioContext`); if (!mode[0]) assert.equal(seen.contexts, 0, `${name}: zonder geluid geen AudioContext`);
      baseline[name] = traffic.acts; assert.equal(traffic.media.length, 0, `${name}: geen verzoeken voor geluid`);
      if (mode[0]) { await sleep(16000); seen = await counts(page); assert.ok(seen.closed >= 1, `${name}: de AudioContext sluit zichzelf na stilte`); }
      assert.deepEqual(errors, []); await ctx.close();
    }
    // 2. voltooiing door loslaten: pickup (alleen geluid) + één voltooiingsviering, geen verbindingstoon bij de laatste snap
    {
      const user = await person(); const variant = await soloVariant(user, 24); const ctx = await newContext(user, "desktop"); await spy(ctx, mode);
      await ctx.addInitScript((id) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, variant.solo.id);
      const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); const traffic = watchTraffic(page); await page.goto(`${base}/jigsaw`); const env = await prepare(page, variant.geometry, variant.snapshot);
      await drop(page, ctx, "desktop", env, variant.spot); await heading(page).waitFor({ timeout: 8000 }); await sleep(1800);
      let seen = await counts(page);
      assert.equal(seen.osc, mode[0] ? 1 + 3 : 0, `${name}: pickup + precies één voltooiingsmelodie (${seen.osc})`); assert.equal(seen.vib.length, mode[1] ? 1 : 0, `${name}: één voltooiingshaptiek`); if (mode[1]) assert.equal(seen.vib[0].length, 3);
      await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(900); const again = await counts(page); assert.equal(again.osc, seen.osc, `${name}: herhaalde updates geven geen tweede viering`); assert.equal(again.vib.length, seen.vib.length);
      // Juist antwoord = bevestigd nieuw record (eerste tijd): één recordtoon, pas na het antwoord
      await page.getByRole("button", { name: nl.jigsaw.completion.toQuestion, exact: true }).click(); await page.getByRole("button", { name: nl.jigsaw.confirmAnswer, exact: true }).waitFor();
      const beforeAnswer = await counts(page); assert.equal(beforeAnswer.osc, seen.osc, `${name}: nog geen recordgeluid vóór het antwoord`);
      await page.locator("section.card button[aria-pressed]").nth(0).click(); await page.getByRole("button", { name: nl.jigsaw.confirmAnswer, exact: true }).click(); await page.locator("[data-record-notice]").waitFor({ timeout: 8000 }); await sleep(500);
      const afterAnswer = await counts(page); assert.equal(afterAnswer.osc - beforeAnswer.osc, mode[0] ? 4 : 0, `${name}: één recordtoon na het bevestigde record`); assert.equal(afterAnswer.vib.length - beforeAnswer.vib.length, mode[1] ? 1 : 0);
      assert.equal(traffic.media.length, 0); assert.deepEqual(errors, []); await ctx.close();
    }
  }
  // Het serververkeer is in elke stand gelijk (alleen move + connect)
  assert.deepEqual(Object.values(baseline).every((n) => n === baseline["uit-uit"]), true, `serververkeer gelijk in alle standen (${JSON.stringify(baseline)})`);
  // === Onjuist antwoord en een reeds voltooide puzzel openen: geen enkel effect
  {
    const user = await person(); const variant = await soloVariant(user, 24); const mode = MODES.beide; const ctx = await newContext(user, "desktop"); await spy(ctx, mode);
    await ctx.addInitScript((id) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, variant.solo.id);
    const page = await ctx.newPage(); await page.goto(`${base}/jigsaw`); const env = await prepare(page, variant.geometry, variant.snapshot); await drop(page, ctx, "desktop", env, variant.spot); await heading(page).waitFor({ timeout: 8000 }); await sleep(600);
    await page.getByRole("button", { name: nl.jigsaw.completion.toQuestion, exact: true }).click(); await page.getByRole("button", { name: nl.jigsaw.confirmAnswer, exact: true }).waitFor(); const before = await counts(page);
    await page.locator("section.card button[aria-pressed]").nth(1).click(); await page.getByRole("button", { name: nl.jigsaw.confirmAnswer, exact: true }).click(); await page.locator("h1", { hasText: nl.jigsaw.completion.resultIncorrectTitle }).waitFor(); await sleep(600);
    const after = await counts(page); assert.equal(after.osc, before.osc, "onjuist antwoord: geen recordgeluid"); assert.equal(after.vib.length, before.vib.length); await ctx.close();
    const second = await newContext(user, "desktop"); await spy(second, mode); await second.addInitScript((id) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, variant.solo.id);
    const reopened = await second.newPage(); await reopened.goto(`${base}/jigsaw`); await sleep(1500); const quiet = await counts(reopened); assert.equal(quiet.osc, 0, "een voltooide puzzel openen: stil"); assert.equal(quiet.vib.length, 0); assert.equal(quiet.contexts, 0); await second.close();
  }
  // === Afgewezen/bijna-snap: een stuk dat net buiten de snapafstand ligt geeft geen verbindingsfeedback (alleen pickup bij geluid)
  {
    const user = await person(); const variant = await soloVariant(user, 24); const ctx = await newContext(user, "desktop"); await spy(ctx, MODES.beide);
    await ctx.addInitScript((id) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, variant.solo.id);
    const page = await ctx.newPage(); await page.goto(`${base}/jigsaw`); const env = await prepare(page, variant.geometry, variant.snapshot);
    await drop(page, ctx, "desktop", { ...env }, { x: variant.spot.x + 2.5, y: variant.spot.y + 2.5 }); await sleep(1500);
    const seen = await counts(page); assert.equal(seen.vib.length, 0, "geen haptiek zonder bevestigde verbinding"); assert.ok(seen.osc <= 1, `hooguit de pickup-tik (${seen.osc})`);
    const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: variant.solo.id } }); assert.equal(row.status, "ACTIVE", "de puzzel is niet voltooid"); await ctx.close();
  }
  // === Samen 24 (en met MATRIX 150/300): iedere deelnemer één voltooiingsviering, geen geluid van andermans slepen, gelijk socketverkeer
  const socketEvents = {};
  for (const mode of ["uit-uit", "beide"]) for (const count of process.env.MATRIX ? [24, 150, 300] : [24]) {
    const [a, b] = [await person(), await person()]; await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
    const id = await createCoopSession(a.id, jigsawCatalog[2].url, count, "ADVENTURER", [b.id]); await respondToCoopInvite(b.id, (await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId: id, toUserId: b.id } })).id, true);
    const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id }, include: { variant: { include: { definition: true } } } }); const geometry = createPuzzleGeometry(count, row.variant.definition.seed, row.variant.definition.geometryVersion); const { snapshot, spot } = almostDone(geometry);
    await prisma.puzzleSession.update({ where: { id }, data: { snapshot: JSON.stringify(snapshot) } });
    const open = async (user) => { const ctx = await newContext(user, "desktop"); await spy(ctx, MODES[mode]); const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); const frames = []; page.on("websocket", (ws) => ws.on("framesent", (f) => { const m = String(f.payload).match(/^\d*\["([^"]+)"/); if (m) frames.push(m[1]); })); await page.goto(`${base}/jigsaw/samen/${id}`, { waitUntil: "networkidle" }); return { ctx, page, errors, frames, env: await prepare(page, geometry, snapshot, count >= 96) }; };
    const A = await open(a); const B = await open(b); await B.page.mouse.click(B.env.bounds.x + 6, B.env.bounds.y + 6); /* een echt gebaar op het bord van B */ await drop(A.page, A.ctx, "desktop", A.env, spot);
    const title = nl.puzzleTogether.coop.completeTitle; await heading(A.page, title).waitFor({ timeout: 10000 }); await heading(B.page, title).waitFor({ timeout: 10000 }); await sleep(1800);
    const ca = await counts(A.page); const cb = await counts(B.page); const on = MODES[mode];
    assert.equal(cb.osc, on[0] ? 3 : 0, `Samen ${count} ${mode}: B hoort alleen de voltooiing, niet het slepen van A (${cb.osc})`); assert.equal(cb.vib.length, on[1] ? 1 : 0);
    assert.equal(ca.osc, on[0] ? 4 : 0, `Samen ${count} ${mode}: A hoort pickup + één voltooiing (${ca.osc})`); assert.equal(ca.vib.length, on[1] ? 1 : 0);
    // Opnieuw openen van de voltooide puzzel: stil
    const re = await newContext(a, "desktop"); await spy(re, MODES[mode]); const rp = await re.newPage(); await rp.goto(`${base}/jigsaw/samen/${id}`, { waitUntil: "networkidle" }); await sleep(1200); const cr = await counts(rp); assert.equal(cr.osc, 0, "Samen: voltooide puzzel heropenen is stil"); assert.equal(cr.vib.length, 0); await re.close();
    (socketEvents[count] ??= {})[mode] = [...A.frames, ...B.frames].filter((e) => e !== "puzzle:sync").sort().join(","); /* sync = bestaande herverbinding/resync, tijdgevoelig en los van feedback */
    assert.deepEqual([...A.errors, ...B.errors], []); await A.ctx.close(); await B.ctx.close();
  }
  for (const [count, perMode] of Object.entries(socketEvents)) assert.equal(perMode["uit-uit"], perMode["beide"], `Samen ${count}: exact dezelfde socket-events met en zonder feedback`);
  // === Tegen elkaar: asynchroon (en met MATRIX live): nieuw record bevestigd door de server = één recordviering
  for (const kind of process.env.MATRIX ? ["ASYNC", "LIVE"] : ["ASYNC"]) {
    const [a, b] = [await person(), await person()]; await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
    const matchId = await createMatch(a.id, 9, 24, "ADVENTURER", [b.id], kind); await respondToMatchInvite(b.id, matchId, true); if (kind === "LIVE") await startLiveMatch(a.id, matchId); else await beginMatchAttempt(a.id, matchId);
    const session = await prisma.puzzleSession.findFirstOrThrow({ where: { ownerId: a.id, matchId }, include: { variant: { include: { definition: true } } } }); const geometry = createPuzzleGeometry(24, session.variant.definition.seed, session.variant.definition.geometryVersion); const { snapshot, spot } = almostDone(geometry);
    await prisma.puzzleSession.update({ where: { id: session.id }, data: { snapshot: JSON.stringify(snapshot) } });
    const ctx = await newContext(a, "phone"); await spy(ctx, MODES.beide); const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); await page.goto(`${base}/jigsaw/wedstrijd/${matchId}`, { waitUntil: "networkidle" }); const env = await prepare(page, geometry, snapshot);
    await drop(page, ctx, "phone", env, spot); await heading(page).waitFor({ timeout: 10000 }); await sleep(1800); const seen = await counts(page);
    assert.equal(await page.locator("[data-completion-record='new']").count(), 1, `Tegen elkaar (${kind}): server-bevestigd record`);
    assert.equal(seen.osc, 1 + 4, `Tegen elkaar (${kind}): pickup + één recordviering in plaats van de gewone voltooiing (${seen.osc})`); assert.equal(seen.vib.length, 1); assert.equal(seen.vib[0].length, 5);
    assert.deepEqual(errors, []); await ctx.close();
  }
  // === Prestatie: Solo 96 met geluid en haptiek aan, alleen met MATRIX
  if (process.env.MATRIX) {
    const user = await person(); const variant = await soloVariant(user, 96); const ctx = await newContext(user, "desktop"); await spy(ctx, MODES.beide);
    await ctx.addInitScript((id) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, variant.solo.id);
    const page = await ctx.newPage(); await page.goto(`${base}/jigsaw`); const env = await prepare(page, variant.geometry, variant.snapshot, true); await drop(page, ctx, "desktop", env, variant.spot); await heading(page).waitFor({ timeout: 12000 }); await sleep(1500);
    const seen = await counts(page); report["solo96"] = { osc: seen.osc, vib: seen.vib.length, contexts: seen.contexts }; assert.equal(seen.osc, 4); assert.equal(seen.contexts, 1); await ctx.close();
  }
  report.baselineActs = baseline; writeFileSync(`${shots}/metrics.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  console.log("Feedback-browser: instellingen, Solo, Samen en Tegen elkaar met geluid/haptiek (mocks): groen.");
} finally { await browser.close(); await prisma.user.deleteMany({ where: { id: { in: users } } }); await prisma.$disconnect(); }
