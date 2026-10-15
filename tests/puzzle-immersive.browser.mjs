// Echte browser (touch/muis) op de lokale wegwerpdatabase: Immersive tijdens het actieve puzzelbord, compacte afgeronde lijst met
// geschiedenis, en de grotere draaiknop. Catalogus, hub, kaart en vraag blijven Focus/normaal.
//   LEARNING_TEST_DATABASE_URL=... DATABASE_URL=$LEARNING_TEST_DATABASE_URL PUZZLE_TEST_BASE_URL=http://localhost:3107 npx tsx tests/puzzle-immersive.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { jigsawCatalog } from "../src/lib/jigsawGame.ts";
import { createCoopSession, respondToCoopInvite } from "../src/lib/puzzle/coop.ts";
import { createMatch } from "../src/lib/puzzle/match.ts";

const database = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_puzzle_test" || process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Gebruik de lokale wegwerpdatabase van test:puzzle:integration");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.PUZZLE_TEST_BASE_URL ?? "http://localhost:3107";
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(ok ? "OK  " : "FAIL", name, detail); if (!ok) process.exitCode = 1; };
const DAY = 86_400_000;
const users = [];
const KEY = "versado:jigsaw-v2-session";

try {
  const scope = await prisma.gameContentScope.findFirstOrThrow({ where: { gameKey: "jigsaw" } });
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", jigsawEnabled: true }, update: { jigsawEnabled: true } });
  const person = async (tag) => { const user = await prisma.user.create({ data: { email: `imm-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `${tag}${randomUUID().slice(0, 6)}`, discriminator: "00", activeContentCollectionId: scope.contentCollectionId, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } }); users.push(user.id); return user; };
  const [a, b] = [await person("Im"), await person("Fr")];
  await prisma.friendship.create({ data: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" } });
  const openPage = async (user, viewport, mobile = true, path = "/jigsaw", prepare) => {
    const context = await browser.newContext({ viewport, serviceWorkers: "block", ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    if (prepare) { await page.goto(`${base}/jigsaw/records`, { waitUntil: "domcontentloaded" }); await prepare(page, context); }
    await page.goto(base + path, { waitUntil: "networkidle" });
    return { context, page, errors };
  };
  const mode = (page) => page.locator("[data-shell-mode]").first().getAttribute("data-shell-mode");
  const headerVisible = (page) => page.locator("[data-sticky-header]").first().isVisible();
  const backBarVisible = (page) => page.locator("[data-subpage-back-bar]").first().isVisible().catch(() => false);
  const rows = (page) => page.locator("li", { has: page.getByRole("link", { name: /Bekijk resultaat|Vraag beantwoorden/ }) });

  // ---- A. Hub: precies drie afgeronde, "Bekijk alle", lopende puzzel blijft zichtbaar; geschiedenis met paginatie
  for (let i = 0; i < 24; i++) {
    const id = await createCoopSession(a.id, jigsawCatalog[0].url, 24, "ADVENTURER", [b.id]);
    await prisma.puzzleSession.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date(Date.now() - (i + 2) * 3600_000), lastActivityAt: new Date(Date.now() - (i + 2) * 3600_000) } });
  }
  const recentMatch = await createMatch(a.id, jigsawCatalog[1].url, 6, "ADVENTURER", [b.id], "ASYNC");
  await prisma.puzzleMatch.update({ where: { id: recentMatch }, data: { status: "FINISHED", finishedAt: new Date(Date.now() - 60_000) } });
  const oldMatch = await createMatch(a.id, jigsawCatalog[1].url, 6, "ADVENTURER", [b.id], "ASYNC");
  await prisma.puzzleMatch.update({ where: { id: oldMatch }, data: { status: "FINISHED", finishedAt: new Date(Date.now() - 30 * DAY) } });
  const activeId = await createCoopSession(a.id, jigsawCatalog[2].url, 24, "ADVENTURER", [b.id]);
  await prisma.puzzleSession.update({ where: { id: activeId }, data: { lastActivityAt: new Date(Date.now() - 90 * DAY) } });
  for (const [name, viewport, mobile] of [["390 × 844", { width: 390, height: 844 }, true], ["desktop", { width: 1280, height: 900 }, false]]) {
    const hub = await openPage(a, viewport, mobile);
    await hub.page.getByRole("heading", { name: "Afgerond" }).waitFor({ timeout: 15000 });
    check(`hub ${name}: de hub is Focus met de gewone terugbalk (geen Immersive)`, (await mode(hub.page)) === "focus" && await backBarVisible(hub.page));
    check(`hub ${name}: precies drie afgeronde puzzels`, (await rows(hub.page).count()) === 3, String(await rows(hub.page).count()));
    check(`hub ${name}: de lopende puzzel is niet verdrongen door de afgeronde`, (await hub.page.getByRole("link", { name: "Verder puzzelen" }).count()) === 1);
    check(`hub ${name}: de nieuwste (wedstrijd) staat bovenaan en de wedstrijd van 30 dagen terug niet op de hub`, (await rows(hub.page).first().innerText()).includes("Wedstrijd") && (await hub.page.locator(`a[href="/jigsaw/wedstrijd/${oldMatch}"]`).count()) === 0);
    const all = hub.page.getByRole("link", { name: "Bekijk alle afgeronde puzzels" });
    check(`hub ${name}: de actie "Bekijk alle afgeronde puzzels" staat onder de drie`, (await all.count()) === 1 && (await all.boundingBox()).y > (await rows(hub.page).last().boundingBox()).y);
    await all.click(); await hub.page.waitForURL(/\/jigsaw\/afgerond$/, { timeout: 15000 });
    await hub.page.getByRole("heading", { name: "Afgeronde puzzels" }).waitFor({ timeout: 15000 });
    await rows(hub.page).first().waitFor({ timeout: 15000 });
    check(`geschiedenis ${name}: eerste pagina van 20, "Meer laden" zichtbaar`, (await rows(hub.page).count()) === 20 && (await hub.page.getByRole("button", { name: "Meer laden" }).count()) === 1, String(await rows(hub.page).count()));
    check(`geschiedenis ${name}: nieuwste eerst (de wedstrijd van zojuist)`, (await rows(hub.page).first().innerText()).includes("Wedstrijd"));
    await hub.page.getByRole("button", { name: "Meer laden" }).click();
    await hub.page.waitForFunction(() => document.querySelectorAll("li a[href^='/jigsaw/samen/'], li a[href^='/jigsaw/wedstrijd/']").length >= 26, null, { timeout: 15000 });
    const hrefs = await hub.page.locator("li a[href^='/jigsaw/samen/'], li a[href^='/jigsaw/wedstrijd/']").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    check(`geschiedenis ${name}: alle 26 afgeronde (24 samen + 2 wedstrijden, ook de oude) zonder dubbelen en zonder "Meer laden"`, hrefs.length === 26 && new Set(hrefs).size === 26 && hrefs.includes(`/jigsaw/wedstrijd/${oldMatch}`) && (await hub.page.getByRole("button", { name: "Meer laden" }).count()) === 0, String(hrefs.length));
    check(`geschiedenis ${name}: geen horizontale overflow`, await hub.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await hub.page.getByRole("link", { name: "Bekijk resultaat" }).first().click(); await hub.page.waitForURL(/\/jigsaw\/(samen|wedstrijd)\//, { timeout: 15000 });
    check(`geschiedenis ${name}: "Bekijk resultaat" opent de uitslag`, true);
    check(`hub ${name}: geen runtimefouten`, hub.errors.length === 0, hub.errors.join(" | "));
    await hub.context.close();
  }
  // een vreemde ziet niets van een ander (toegangscontrole via de route)
  const stranger = await person("St");
  const foreign = await openPage(stranger, { width: 390, height: 844 }, true, "/jigsaw/afgerond");
  await foreign.page.getByText("Je hebt nog geen afgeronde").waitFor({ timeout: 15000 });
  check("geschiedenis: een andere gebruiker ziet geen afgeronde puzzels van een ander", (await rows(foreign.page).count()) === 0);
  const bad = await foreign.context.request.get(`${base}/api/puzzle/history?cursor=geen-cursor`); check("geschiedenis-API: een ongeldige cursor wordt geweigerd", bad.status() === 400);
  const big = await foreign.context.request.get(`${base}/api/puzzle/history?limit=500`); check("geschiedenis-API: een te grote pagina wordt geweigerd (nooit onbegrensd)", big.status() === 400);
  await foreign.context.close();

  // ---- B. Solo: catalogus Focus, actief bord Immersive in alle maten, menu bereikbaar, terug naar Focus
  const soloUser = await person("So");
  const api = (context, body) => context.request.post(`${base}/api/jigsaw-v2`, { headers: { Origin: base }, data: body }).then(async (r) => { assert.equal(r.status(), 200, await r.text()); return r.json(); });
  const cases = [["320 × 568", { width: 320, height: 568 }, true, {}, {}], ["360 × 740", { width: 360, height: 740 }, true, {}, {}], ["390 × 844", { width: 390, height: 844 }, true, {}, {}],
    ["390 × 844, 200% tekst", { width: 390, height: 844 }, true, { text: true }, {}], ["390 × 844, veilige randen", { width: 390, height: 844 }, true, { safe: { top: 47, bottom: 34, left: 0, right: 0 } }, {}],
    ["landscape 844 × 390", { width: 844, height: 390 }, true, { safe: { top: 0, bottom: 21, left: 47, right: 47 } }, {}], ["desktop 1280 × 900", { width: 1280, height: 900 }, false, {}, {}]];
  for (const [name, viewport, mobile, extra] of cases) {
    const context = await browser.newContext({ viewport, serviceWorkers: "block", ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(soloUser.id), url: base }]);
    const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.addStyleTag({ content: "" }).catch(() => {});
    await page.goto(`${base}/jigsaw/records`, { waitUntil: "domcontentloaded" }); await page.evaluate((key) => localStorage.removeItem(key), KEY);
    await page.goto(`${base}/jigsaw`, { waitUntil: "networkidle" });
    check(`solo ${name}: de catalogus is Focus met terugbalk, zonder globale header en onderbalk`, (await mode(page)) === "focus" && await backBarVisible(page) && (await page.locator("nav[data-main-nav]").first().isVisible()) === false);
    const state = await api(context, { action: "start", imageId: jigsawCatalog[39].url, pieceCount: 12, difficulty: "MASTER" });
    await page.evaluate(([key, id]) => localStorage.setItem(key, id), [KEY, state.id]);
    await page.goto(`${base}/jigsaw`, { waitUntil: "networkidle" });
    await page.locator("canvas").waitFor({ timeout: 20000 });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    if (extra.text) await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    const safe = extra.safe ?? { top: 0, bottom: 0, left: 0, right: 0 };
    if (extra.safe) await page.evaluate((s) => { for (const [side, value] of Object.entries(s)) document.documentElement.style.setProperty(`--safe-area-inset-${side}`, `${value}px`); }, safe);
    await page.waitForFunction(() => document.querySelector("[data-shell-mode]")?.getAttribute("data-shell-mode") === "immersive");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await sleep(200);
    check(`solo ${name}: het actieve bord is Immersive`, (await mode(page)) === "immersive");
    check(`solo ${name}: geen globale header, terugbalk of onderbalk (geen dubbele terugknop)`, !(await headerVisible(page)) && !(await backBarVisible(page)) && (await page.locator("nav[data-main-nav]").first().isVisible()) === false);
    const m = await page.evaluate(() => { const c = document.querySelector("canvas").getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height, right: c.right, bottom: c.bottom, iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, y0: scrollY }; });
    check(`solo ${name}: de werktafel vult het scherm binnen de veilige randen (geen lege strook)`, Math.abs(m.x - safe.left) <= 1 && Math.abs(m.y - safe.top) <= 1 && Math.abs(m.right - (m.iw - safe.right)) <= 1 && Math.abs(m.bottom - (m.ih - safe.bottom)) <= 1, JSON.stringify(m));
    check(`solo ${name}: geen horizontale of verticale documentoverflow`, m.sw <= m.iw && m.sh <= m.ih + 1 && m.y0 === 0, JSON.stringify(m));
    const menuButton = page.getByRole("button", { name: "Puzzelbordmenu", exact: true });
    const mb = await menuButton.boundingBox();
    check(`solo ${name}: het bordmenu staat volledig in beeld, binnen de veilige randen`, mb.x >= safe.left && mb.y >= safe.top && mb.x + mb.width <= m.iw - safe.right + 0.5 && mb.y + mb.height <= m.ih - safe.bottom + 0.5, JSON.stringify(mb));
    await menuButton.click();
    const back = page.getByRole("button", { name: "Andere puzzel kiezen", exact: true });
    await back.waitFor();
    const bb = await back.boundingBox();
    check(`solo ${name}: het geopende menu en de terugactie zijn volledig bereikbaar`, bb.x >= 0 && bb.y >= safe.top && bb.x + bb.width <= m.iw && bb.y + bb.height <= m.ih, JSON.stringify(bb));
    // de draaiknop (Master): 76 × 76, icoon 34, niet over het menu en binnen beeld; draaien werkt
    await menuButton.click(); await sleep(100);
    await page.locator("canvas").focus(); await page.keyboard.press("Enter");
    const rotate = page.getByRole("button", { name: "Draai", exact: false }).first();
    await rotate.waitFor({ timeout: 5000 });
    const rb = await rotate.boundingBox(); const icon = await rotate.locator("svg").boundingBox();
    check(`solo ${name}: de draaiknop is 76 × 76 met een icoon van 34 px`, Math.abs(rb.width - 76) <= 1 && Math.abs(rb.height - 76) <= 1 && Math.abs(icon.width - 34) <= 1, JSON.stringify({ rb, icon }));
    const mb2 = await menuButton.boundingBox();
    const overlap = !(rb.x + rb.width <= mb2.x || mb2.x + mb2.width <= rb.x || rb.y + rb.height <= mb2.y || mb2.y + mb2.height <= rb.y);
    check(`solo ${name}: de draaiknop bedekt het menu niet en ligt volledig in beeld`, !overlap && rb.x >= safe.left && rb.y >= safe.top && rb.x + rb.width <= m.iw - safe.right + .5 && rb.y + rb.height <= m.ih - safe.bottom + .5, JSON.stringify({ rb, mb2 }));
    const hit = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return !!el?.closest("button[title]"); }, { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 });
    check(`solo ${name}: de draaiknop is aanraakbaar (niets ligt eroverheen)`, hit);
    const before = (await api(context, { action: "resume", sessionId: state.id })).snapshot.groups.map((g) => g.rotation).join(",");
    await rotate.click(); let after = before; for (let i = 0; i < 40 && after === before; i++) { await sleep(100); after = (await api(context, { action: "resume", sessionId: state.id })).snapshot.groups.map((g) => g.rotation).join(","); }
    check(`solo ${name}: draaien werkt (de server legde de rotatie vast)`, after !== before);
    // terug via het menu: Focus met terugbalk, de puzzel blijft bewaard
    await menuButton.click(); await back.click();
    await page.getByRole("heading", { name: /Kies een puzzel|Puzzel|Legpuzzel/ }).first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector("[data-shell-mode]")?.getAttribute("data-shell-mode") === "focus");
    check(`solo ${name}: terug via het menu geeft de catalogus in Focus met de gewone terugbalk`, (await backBarVisible(page)) && (await prisma.puzzleSession.findUniqueOrThrow({ where: { id: state.id } })).status === "ACTIVE");
    check(`solo ${name}: geen runtimefouten`, errors.length === 0, errors.join(" | "));
    await context.close();
    await prisma.puzzleSession.update({ where: { id: state.id }, data: { status: "ABANDONED" } });
  }

  // ---- C. Samen: bord Immersive; browserterug (geschiedenis) en menu-terug laten de gezamenlijke puzzel ongemoeid
  const hub2 = await openPage(a, { width: 390, height: 844 }, true, "/jigsaw");
  await hub2.page.getByRole("link", { name: "Verder puzzelen" }).click(); await hub2.page.waitForURL(/\/jigsaw\/samen\//, { timeout: 15000 });
  await hub2.page.locator("canvas").first().waitFor({ timeout: 20000 });
  check("samen: het actieve bord is Immersive", (await mode(hub2.page)) === "immersive" && !(await headerVisible(hub2.page)));
  await hub2.page.goBack(); await hub2.page.waitForURL(/\/jigsaw$/, { timeout: 15000 });
  await hub2.page.waitForFunction(() => document.querySelector("[data-shell-mode]")?.getAttribute("data-shell-mode") === "focus");
  check("samen: browserterug brengt je terug naar het overzicht in Focus; de sessie blijft actief", (await mode(hub2.page)) === "focus" && (await prisma.puzzleSession.findUniqueOrThrow({ where: { id: activeId } })).status === "ACTIVE");
  await hub2.page.goForward(); await hub2.page.locator("canvas").first().waitFor({ timeout: 20000 });
  check("samen: vooruit herstelt het Immersive-bord", (await mode(hub2.page)) === "immersive");
  check("samen: geen runtimefouten", hub2.errors.length === 0, hub2.errors.join(" | "));
  await hub2.context.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\nImmersive/geschiedenis/draaiknop: ${results.length - failed.length}/${results.length} gelukt`);
  if (failed.length) process.exitCode = 1;
} finally {
  await browser.close();
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
}
