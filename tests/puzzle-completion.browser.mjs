// Fase 5D-3: de voltooiingskaart (Solo, Tegen elkaar, Samen) in de echte productie-interface: volgorde, mascotte, tijd, records, vervolgvraag,
// toegankelijkheid en schermformaten. Draait alleen tegen de lokale wegwerpdatabase en een draaiende productie-instance.
//   . /tmp/puzenv.sh && npx tsx tests/puzzle-completion.browser.mjs          (SHOTS=<map> bewaart screenshots; MATRIX=1 doorloopt de volledige schermmatrix)
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { jigsawCatalog } from "../src/lib/jigsawGame.ts";
import { createCoopSession, respondToCoopInvite } from "../src/lib/puzzle/coop.ts";
import { startSoloPuzzle } from "../src/lib/puzzle/solo.ts";
import { createMatch, respondToMatchInvite, beginMatchAttempt } from "../src/lib/puzzle/match.ts";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry.ts";
import { boardPosition, connectGroups, newPuzzleSnapshot } from "../src/lib/puzzle/engine.ts";
import { initialPuzzleCamera } from "../src/lib/puzzle/viewport.ts";
import { formatPuzzleTime } from "../src/lib/puzzle/recordFormat.ts";
import { nl } from "../src/lib/i18n/messages/nl.ts";

const database = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_puzzle_test" || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Gebruik de lokale wegwerpdatabase");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const shots = process.env.SHOTS ?? "/tmp/versado-completion"; mkdirSync(shots, { recursive: true });
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
async function prepare(page, geometry, snapshot) {
  const canvas = page.locator("canvas").first(); await canvas.waitFor(); await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForFunction(() => { const c = document.querySelector("canvas"), h = document.querySelector("[data-sticky-header]"); return c && h && Math.abs(c.getBoundingClientRect().top - h.getBoundingClientRect().bottom) < 1 && c.width === Math.round(c.clientWidth * Math.min(devicePixelRatio, 2)); });
  await page.waitForTimeout(600); const bounds = await canvas.boundingBox(); return { bounds, camera: initialPuzzleCamera(bounds, geometry, snapshot) };
}
async function soloVariant(user, pieceCount, difficulty = "ADVENTURER", { hints = 0, bestMs = null } = {}) {
  const solo = await startSoloPuzzle(user.id, 5 + (pieceCount % 7), pieceCount, difficulty, "nl"); const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: solo.id }, include: { variant: { include: { definition: true } } } });
  const geometry = createPuzzleGeometry(pieceCount, row.variant.definition.seed, row.variant.definition.geometryVersion); const { snapshot, spot } = almostDone(geometry, difficulty);
  snapshot.hints = Array.from({ length: hints }, () => ({ type: "PREVIEW", at: new Date(Date.now() - 60000).toISOString(), extra: false, source: "INCLUDED", actionId: randomUUID(), expiresAt: new Date(0).toISOString(), target: { type: "PREVIEW" } }));
  await prisma.puzzleSession.update({ where: { id: solo.id }, data: { snapshot: JSON.stringify(snapshot), startedAt: new Date(Date.now() - 95_400) } });
  if (bestMs !== null) await prisma.puzzleBestRecord.create({ data: { userId: user.id, variantId: row.variantId, mode: "SOLO", hintCategory: hints > 0 ? "WITH_HINTS" : "NO_HINTS", elapsedMs: bestMs, hintsUsed: hints, extraHintsUsed: 0, completedAt: new Date(Date.now() - 86400000), sessionId: (await prisma.puzzleSession.create({ data: { ownerId: user.id, variantId: row.variantId, status: "ANSWERED", snapshot: "{}", answeredAt: new Date(), completedAt: new Date(Date.now() - 86400000) } })).id } });
  return { solo, row, geometry, snapshot, spot };
}
async function openSolo(user, device, variant, options = {}) {
  const ctx = await newContext(user, device, options); await ctx.addInitScript((id) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, variant.solo.id);
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); await page.goto(`${base}/jigsaw`);
  const env = await prepare(page, variant.geometry, variant.snapshot); return { ctx, page, errors, env };
}
const heading = (page, text = nl.jigsaw.complete) => page.locator("h1", { hasText: text });
const inView = async (page, locator) => { const box = await locator.boundingBox(); const view = page.viewportSize(); return !!box && box.y >= 0 && box.y + box.height <= view.height + 1 && box.x >= 0 && box.x + box.width <= view.width + 1; };

try {
  // === Solo: kaart zonder record, met mascotte van de gebruiker, officiële tijd, details en de verplichte vervolgvraag
  for (const device of ["phone-small", "landscape", "desktop"]) {
    const user = await person("VERA"); const variant = await soloVariant(user, 24); const { ctx, page, errors, env } = await openSolo(user, device, variant);
    await drop(page, ctx, device, env, variant.spot); await heading(page).waitFor({ timeout: 8000 });
    const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id: variant.solo.id } }); const elapsed = row.completedAt.getTime() - row.startedAt.getTime();
    const card = page.locator("[data-completion-card]"); const time = await page.locator("[data-official-time]").innerText();
    assert.equal(row.status, "COMPLETED", `${device}: de server legde voltooiing vast`);
    assert.ok(time.includes(formatPuzzleTime(elapsed)), `${device}: de officiële tijd is de door de server vastgelegde tijd (${time} ~ ${formatPuzzleTime(elapsed)})`);
    assert.ok(Math.abs(elapsed - 95_400) < 4000 + 8000, `${device}: tijd is completedAt - startedAt`);
    const mascot = card.locator('img[src*="/mascots/"]'); assert.equal(await mascot.count(), 1, `${device}: één mascotte`); assert.match(await mascot.getAttribute("src"), /vera/i, `${device}: de gekozen gids (Vera)`); assert.match(await mascot.getAttribute("src"), /celebrate/i, `${device}: celebrate-toestand`);
    assert.equal(await mascot.getAttribute("aria-hidden"), "true", `${device}: de mascotte is decoratief`);
    assert.equal(await page.locator("[data-completion-followup]").innerText(), nl.jigsaw.completion.questionNext, `${device}: duidelijk dat er nog een vraag volgt`);
    assert.ok((await card.innerText()).includes(nl.puzzleRecords.catNO_HINTS), `${device}: hintcategorie zichtbaar`);
    assert.ok((await card.innerText()).includes(nl.jigsaw.completion.noBest), `${device}: geen eerdere tijd = nette tekst, geen verzonnen record`);
    assert.equal(await page.locator("[data-record-notice], [data-completion-record='new']").count(), 0, `${device}: geen recordclaim vóór het antwoord`);
    const button = page.getByRole("button", { name: nl.jigsaw.completion.toQuestion, exact: true }); assert.ok(await inView(page, button), `${device}: de knop is zonder scrollen bereikbaar`);
    const box = await button.boundingBox(); assert.ok(box.height >= 44, `${device}: knop minstens 44 px hoog`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "puzzle-completion-title", `${device}: focus op de kop`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${device}: geen horizontale overflow`);
    await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.activeElement?.textContent), nl.jigsaw.completion.toQuestion, `${device}: Tab bereikt de knop`);
    assert.equal(await heading(page).count(), 1, `${device}: één kaart`); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await sleep(700); assert.equal(await heading(page).count(), 1, `${device}: herhaalde updates geven geen tweede kaart`);
    await page.screenshot({ path: `${shots}/solo24-${device}.png` });
    report[`solo-${device}`] = { time, elapsed };
    assert.deepEqual(errors, []); await ctx.close();
  }
  // === Solo met bestaand record, met hints; daarna de vraag (juist = record, onjuist = geen viering en geen record)
  {
    const user = await person("VARO"); const variant = await soloVariant(user, 24, "ADVENTURER", { hints: 1, bestMs: 120_000 }); const { ctx, page, errors, env } = await openSolo(user, "phone", variant);
    await drop(page, ctx, "phone", env, variant.spot); await heading(page).waitFor({ timeout: 8000 });
    const text = await page.locator("[data-completion-card]").innerText(); assert.ok(text.includes(nl.puzzleRecords.catWITH_HINTS), "met hints: de categorie Met hints"); assert.ok(text.includes(nl.jigsaw.completion.bestSoFar.replace("{category}", nl.puzzleRecords.catWITH_HINTS).replace("{time}", formatPuzzleTime(120_000))), "bestaand persoonlijk record uit de server");
    assert.match(await page.locator('[data-completion-card] img[src*="/mascots/"]').getAttribute("src"), /varo/i, "Varo als gekozen gids");
    await page.screenshot({ path: `${shots}/solo24-existing-record-phone.png` });
    await page.getByRole("button", { name: nl.jigsaw.completion.toQuestion, exact: true }).click(); await page.getByRole("button", { name: nl.jigsaw.confirmAnswer, exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: nl.jigsaw.completion.toQuestion, exact: true }).count(), 0, "de verplichte vervolgvraag volgt na de kaart");
    // Onjuist antwoord: de optie die niet het juiste antwoord is (de server bepaalt dat; we proberen de opties tot een onjuist resultaat)
    const options = page.locator("section.card button[aria-pressed]"); await options.nth(0).click(); await page.getByRole("button", { name: nl.jigsaw.confirmAnswer, exact: true }).click();
    await page.locator("h1").first().waitFor(); const wrong = await page.locator("h1", { hasText: nl.jigsaw.completion.resultIncorrectTitle }).count() === 1; const right = await page.locator("[data-record-notice]").count() === 1 || await page.getByText(nl.jigsaw.completion.resultCorrectNote).count() === 1;
    report["solo-answer"] = { wrong, right }; assert.ok(wrong !== right, "het resultaat is óf juist óf onjuist, nooit allebei");
    if (wrong) { assert.equal(await page.locator("[data-record-notice]").count(), 0, "onjuist: geen record"); assert.ok(await page.getByText(nl.jigsaw.completion.resultIncorrectNote).count() === 1, "onjuist: zegt dat de activiteit niet is afgerond"); assert.match(await page.locator('[data-completion-card] img[src*="/mascots/"]').getAttribute("src"), /encourage/i, "onjuist: bemoedigende gids"); await page.screenshot({ path: `${shots}/solo24-result-wrong-phone.png` }); }
    else { await page.screenshot({ path: `${shots}/solo24-result-correct-phone.png` }); }
    assert.deepEqual(errors, []); await ctx.close();
  }
  // === Direct openen van een voltooide puzzel: de kaart staat er meteen, één keer, zonder animatiewachttijd; ontbrekende mascotte blijft werken
  {
    const user = await person(); const variant = await soloVariant(user, 24); const first = await openSolo(user, "phone", variant);
    await drop(first.page, first.ctx, "phone", first.env, variant.spot); await heading(first.page).waitFor({ timeout: 8000 }); await first.ctx.close();
    const ctx = await newContext(user, "phone"); await ctx.addInitScript((id) => { try { localStorage.setItem("versado:jigsaw-v2-session", id); } catch {} }, variant.solo.id);
    await ctx.route("**/mascots/**", (route) => route.abort()); const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/jigsaw`); await heading(page).waitFor({ timeout: 8000 }); assert.equal(await page.locator("canvas").count(), 0, "geopend als voltooid: direct de kaart, geen bord");
    assert.equal(await heading(page).count(), 1, "één kaart"); assert.ok(await inView(page, page.getByRole("button", { name: nl.jigsaw.completion.toQuestion, exact: true })), "ontbrekende mascotte: de kaart en de knop werken gewoon");
    await page.getByRole("button", { name: nl.jigsaw.completion.toQuestion, exact: true }).click(); await page.getByRole("button", { name: nl.jigsaw.confirmAnswer, exact: true }).waitFor(); assert.deepEqual(errors, []); await ctx.close();
  }
  // === Samen: dezelfde kaart zonder tijd, record of vraag; één kaart per speler
  for (const [count, device] of process.env.MATRIX ? [[24, "phone"], [150, "phone"], [300, "phone"], [24, "desktop"]] : [[24, "phone"]]) {
    const [a, b] = [await person("NOVI"), await person("VARO")]; await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
    const id = await createCoopSession(a.id, jigsawCatalog[2].url, count, "ADVENTURER", [b.id]); await respondToCoopInvite(b.id, (await prisma.puzzleInvite.findFirstOrThrow({ where: { sessionId: id, toUserId: b.id } })).id, true);
    const row = await prisma.puzzleSession.findUniqueOrThrow({ where: { id }, include: { variant: { include: { definition: true } } } }); const geometry = createPuzzleGeometry(count, row.variant.definition.seed, row.variant.definition.geometryVersion); const { snapshot, spot } = almostDone(geometry);
    await prisma.puzzleSession.update({ where: { id }, data: { snapshot: JSON.stringify(snapshot) } });
    const open = async (user) => { const ctx = await newContext(user, device); const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); await page.goto(`${base}/jigsaw/samen/${id}`, { waitUntil: "networkidle" }); return { ctx, page, errors, env: await prepare(page, geometry, snapshot) }; };
    const A = await open(a); const B = await open(b); await drop(A.page, A.ctx, device, A.env, spot);
    const title = nl.puzzleTogether.coop.completeTitle; await heading(A.page, title).waitFor({ timeout: 10000 }); await heading(B.page, title).waitFor({ timeout: 10000 }); await sleep(600);
    for (const [who, view] of [["A", A], ["B", B]]) {
      const text = await view.page.locator("[data-completion-card]").innerText();
      assert.equal(await heading(view.page, title).count(), 1, `Samen ${count}: één kaart bij ${who}`); assert.equal(await view.page.locator("[data-official-time]").count(), 0, "Samen: geen puzzeltijd"); assert.equal(await view.page.locator("[data-completion-record], [data-record-notice]").count(), 0, "Samen: geen persoonlijk snelheidsrecord");
      assert.equal(await view.page.locator("[data-completion-followup]").count(), 0, "Samen: geen vervolgvraag"); assert.ok(text.includes(nl.puzzleTogether.coop.completeText));
      assert.ok(await inView(view.page, view.page.getByRole("button", { name: nl.puzzleTogether.coop.back, exact: true })), `Samen ${count}: de knop is bereikbaar`);
    }
    assert.match(await A.page.locator('[data-completion-card] img[src*="/mascots/"]').getAttribute("src"), /novi/i, "Samen: A ziet zijn eigen gids"); assert.match(await B.page.locator('[data-completion-card] img[src*="/mascots/"]').getAttribute("src"), /varo/i, "Samen: B ziet zijn eigen gids");
    await A.page.screenshot({ path: `${shots}/samen${count}-${device}.png` });
    assert.deepEqual([...A.errors, ...B.errors], []); await A.ctx.close(); await B.ctx.close();
  }
  // === Tegen elkaar (asynchroon en live): officiële tijd = door de server vastgelegde finishtijd; nieuw record bevestigd door de server
  for (const kind of process.env.MATRIX ? ["ASYNC", "LIVE"] : ["ASYNC"]) {
    const [a, b] = [await person(), await person()]; await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
    const matchId = await createMatch(a.id, 9, 24, "ADVENTURER", [b.id], kind); await respondToMatchInvite(b.id, matchId, true); await beginMatchAttempt(a.id, matchId);
    const session = await prisma.puzzleSession.findFirstOrThrow({ where: { ownerId: a.id, matchId }, include: { variant: { include: { definition: true } } } }); const geometry = createPuzzleGeometry(24, session.variant.definition.seed, session.variant.definition.geometryVersion); const { snapshot, spot } = almostDone(geometry);
    await prisma.puzzleSession.update({ where: { id: session.id }, data: { snapshot: JSON.stringify(snapshot) } });
    const ctx = await newContext(a, "phone"); const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message)); await page.goto(`${base}/jigsaw/wedstrijd/${matchId}`, { waitUntil: "networkidle" }); const env = await prepare(page, geometry, snapshot);
    await drop(page, ctx, "phone", env, spot); await heading(page).waitFor({ timeout: 10000 }); await sleep(500);
    const participant = await prisma.puzzleMatchParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId: a.id } } });
    const shown = await page.locator("[data-official-time]").innerText(); report[`match-${kind}`] = { shown, official: participant.elapsedMs, status: participant.status };
    assert.equal(participant.status, "FINISHED"); assert.ok(shown.includes(formatPuzzleTime(participant.elapsedMs)), `Tegen elkaar (${kind}): de getoonde tijd is de officiële finishtijd van de server (${shown} ~ ${formatPuzzleTime(participant.elapsedMs)})`);
    assert.ok(await page.locator("[data-completion-record='new']").count() === 1, `Tegen elkaar (${kind}): nieuw record, bevestigd door de server (eerste geldige finish)`); assert.equal(await page.locator("[data-completion-followup]").innerText(), nl.jigsaw.completion.questionNext);
    assert.equal(await heading(page).count(), 1); await page.screenshot({ path: `${shots}/match-${kind.toLowerCase()}-phone.png` });
    await page.getByRole("button", { name: nl.jigsaw.completion.toQuestion, exact: true }).click(); await page.getByRole("button", { name: nl.jigsaw.confirmAnswer, exact: true }).waitFor();
    assert.deepEqual(errors, []); await ctx.close();
  }
  // === Matrix: schermformaten × aantallen (alleen met MATRIX=1)
  if (process.env.MATRIX) {
    for (const device of Object.keys(DEVICES)) for (const count of [6, 24, 96]) {
      const user = await person(["NOVI", "VARO", "VERA"][count % 3]); const variant = await soloVariant(user, count); const { ctx, page, errors, env } = await openSolo(user, device, variant);
      await drop(page, ctx, device, env, variant.spot); await heading(page).waitFor({ timeout: 10000 }); await sleep(500);
      const button = page.getByRole("button", { name: nl.jigsaw.completion.toQuestion, exact: true }); const ok = await inView(page, button); report[`matrix-${device}-${count}`] = { buttonInView: ok };
      assert.ok(ok, `${device} ${count}: knop bereikbaar zonder scrollen`); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `${device} ${count}: geen overflow`);
      const nav = await page.evaluate(() => { const bar = document.querySelector("[data-main-nav]"); return bar ? getComputedStyle(bar).display !== "none" && bar.getBoundingClientRect().height > 0 : false; }); assert.equal(nav, false, `${device} ${count}: geen overlap met de onderbalk (focusmodus)`);
      await page.screenshot({ path: `${shots}/matrix-solo${count}-${device}.png` }); assert.deepEqual(errors, []); await ctx.close();
    }
    // Tekstvergroting 200% op een kleine telefoon: geen overflow en de knop blijft bereikbaar
    const user = await person(); const variant = await soloVariant(user, 24); const { ctx, page, env } = await openSolo(user, "phone-small", variant); await drop(page, ctx, "phone-small", env, variant.spot); await heading(page).waitFor({ timeout: 10000 });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" }); await sleep(300); const button = page.getByRole("button", { name: nl.jigsaw.completion.toQuestion, exact: true }); await button.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, "200% tekst: geen horizontale overflow"); assert.ok(await button.isVisible(), "200% tekst: de knop is bereikbaar"); await page.screenshot({ path: `${shots}/solo24-text200-phone-small.png` }); await ctx.close();
  }
  writeFileSync(`${shots}/metrics.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  console.log("Completion-browser: kaart met mascotte, officiële tijd, details, records, vervolgvraag, toegankelijkheid; Solo, Samen en Tegen elkaar: groen.");
} finally { await browser.close(); await prisma.user.deleteMany({ where: { id: { in: users } } }); await prisma.$disconnect(); }
