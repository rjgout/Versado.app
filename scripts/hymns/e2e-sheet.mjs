// Browsertest "Bladmuziek per couplet" van Lofzangen (derde weergave), zonder microfoon.
// Vereist een draaiende productie-app en Playwright (niet in package.json):
//   PLAYWRIGHT_MODULE=/pad/naar/playwright CHROMIUM_PATH=/pad/naar/chrome PROMOTE_DB_URL=postgresql://... \
//     AUDIT_BASE_URL=http://localhost:3108 SHOTS_DIR=/tmp/shots node scripts/hymns/e2e-sheet.mjs
// Dit is Chromium met aanraak- en viewport-emulatie: GEEN bewijs voor iPhone-Safari of een WKWebView.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3108";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
fs.mkdirSync(SHOTS, { recursive: true });
const password = "Wachtwoord-123!";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "OK  " : "FAIL", name, detail); };

async function session(viewport, { admin = true, mobile = true, dark = false, view = "sheet" } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: dark ? "dark" : "light", reducedMotion: "reduce" });
  await ctx.addInitScript((v) => {
    window.__mic = 0;
    if (navigator.mediaDevices) { const g = navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices); if (g) navigator.mediaDevices.getUserMedia = async (c) => { window.__mic += 1; return g(c); }; }
    try { localStorage.setItem("versado:hymns:prefs:v1", JSON.stringify({ view: v, size: "normal", autoScroll: true, calm: false, sheetZoom: 100 })); } catch {}
  }, view);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const em = `blad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  let res = await ctx.request.post(`${BASE}/api/auth/register`, { data: { email: em, handle: `Blad ${Math.random().toString(36).slice(2, 7)}`, password } });
  if (!res.ok()) throw new Error(`registreren mislukt: ${res.status()}`);
  if (admin) execFileSync("psql", [process.env.PROMOTE_DB_URL, "-c", `update "User" set "isAdmin"=true where email='${em}'`]);
  res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: em, password } });
  if (!res.ok()) throw new Error(`inloggen mislukt: ${res.status()}`);
  return { browser, ctx, page, errors };
}
const open = async (page, n) => {
  await page.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator(`[data-hymn-number="${n}"]`).click({ timeout: 120000 });
};
const rendered = (page) => page.locator("[data-hymns-sheet] svg").first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
const lyricWords = (page) => page.evaluate(() => [...document.querySelectorAll("[data-hymns-sheet] svg text")].map((t) => t.textContent.trim()).filter(Boolean));
const noteheads = (page) => page.evaluate(() => document.querySelectorAll("[data-hymns-sheet] svg .vf-notehead, [data-hymns-sheet] svg g.vf-stavenote").length);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// --- iPhone-portret, lofzang 24 (refrein, fermate, F-sleutel)
{
  const { browser, page, errors } = await session({ width: 390, height: 844 });
  await open(page, 24);
  check("1 Bladmuziek is de gekozen weergave en rendert SVG", await rendered(page));
  const words1 = await lyricWords(page);
  check("2 couplet 1: tekst onder de noten (Ere, de, man) en het refrein (Heil)", words1.includes("E") || words1.some((w) => /^E/.test(w)), words1.slice(0, 6).join("|"));
  check("2b refrein op hetzelfde blad", words1.some((w) => /Heil/.test(w)));
  await page.screenshot({ path: `${SHOTS}/sheet-24-c1-390.png` });
  check("3 geen horizontale overflow (390 px)", (await overflow(page)) <= 0, String(await overflow(page)));
  const n1 = await noteheads(page);
  await page.getByRole("button", { name: "Couplet 2", exact: true }).click();
  await page.waitForTimeout(1500);
  const words2 = await lyricWords(page);
  check("4 couplet 2: andere tekst, zelfde melodie", words2.join("|") !== words1.join("|") && (await noteheads(page)) === n1, `${n1} noten`);
  check("4b couplet 2 bevat 'Blij' (couplet 2 begint 'Blijf hem gedenken')", words2.some((w) => /Blij/.test(w)), words2.slice(0, 5).join("|"));
  check("5 coupletwissel vraagt geen nieuwe microfoon", (await page.evaluate(() => window.__mic)) === 0);
  await page.screenshot({ path: `${SHOTS}/sheet-24-c2-390.png` });
  const before = await page.locator("[data-hymns-sheet] svg").first().evaluate((s) => s.getBoundingClientRect().height);
  await page.locator("[data-hymns-zoom-in]").click();
  await page.waitForTimeout(1500);
  const after = await page.locator("[data-hymns-sheet] svg").first().evaluate((s) => s.getBoundingClientRect().height);
  check("6 zoom groter: noten worden groter (het blad loopt langer door, de pagina krijgt geen horizontale scroll)", after > before * 1.1 && (await overflow(page)) <= 0, `${before} -> ${after}`);
  await page.locator("[data-hymns-zoom-out]").click();
  const scrollable = await page.locator("[data-hymns-scroll]").evaluate((el) => el.scrollHeight > el.clientHeight + 40);
  check("7 het blad scrolt verticaal in de leesruimte", scrollable);
  const bar = await page.locator("[data-hymns-controls]").boundingBox();
  const box = await page.locator("[data-hymns-scroll]").boundingBox();
  check("8 bladmuziek overlapt de bediening niet", box.y + box.height <= bar.y + 1, `${box.y + box.height} <= ${bar.y}`);
  await page.locator("[data-hymns-view-toggle]").click();
  check("9 weergavewissel (sheet → couplet) werkt", await page.locator("[data-hymns-stanza]").count() === 1);
  check("9b geen paginafouten", errors.length === 0, errors.slice(0, 2).join(" ; "));
  await browser.close();
}
// --- zonder notatie: lofzang 1 blijft leesbaar
{
  const { browser, page } = await session({ width: 390, height: 844 });
  await open(page, 1);
  await page.locator("[data-hymns-sheet-state], [data-hymns-stanza]").first().waitFor({ timeout: 20000 });
  check("10 lofzang zonder notatie: melding en leesbare tekst", (await page.locator("[data-hymns-sheet-state]").count()) === 1 && (await page.locator("[data-hymns-stanza]").count()) === 1);
  await browser.close();
}
// --- coupletgravure zonder tekstkoppeling (lofzang 6: regelkoppeling)
{
  const { browser, page } = await session({ width: 390, height: 844 });
  await open(page, 6);
  await rendered(page);
  const statuses = await page.locator("[data-hymns-sheet]").evaluate((el) => el.getAttribute("data-hymns-sheet-status"));
  check("11 couplet zonder betrouwbare koppeling: noten zonder verzonnen tekst, eerlijke melding", statuses !== "ok" ? (await page.locator("[data-hymns-sheet-note]").count()) === 1 : true, statuses);
  await browser.close();
}
// --- schermen en thema's
for (const [name, vp, opts] of [
  ["320", { width: 320, height: 640 }, {}],
  ["landschap", { width: 844, height: 390 }, {}],
  ["tablet", { width: 820, height: 1180 }, {}],
  ["desktop", { width: 1280, height: 800 }, { mobile: false }],
  ["donker", { width: 390, height: 844 }, { dark: true }],
]) {
  const { browser, page } = await session(vp, opts);
  await open(page, 24);
  const ok = await rendered(page);
  await page.waitForTimeout(800);
  check(`12 ${name}: rendert zonder overflow`, ok && (await overflow(page)) <= 0, String(await overflow(page)));
  await page.screenshot({ path: `${SHOTS}/sheet-24-${name}.png` });
  await browser.close();
}
// --- beveiliging
{
  const { browser, ctx } = await session({ width: 390, height: 844 }, { admin: false });
  const r = await ctx.request.get(`${BASE}/api/hymns/24/sheet`);
  check("13 gewone gebruiker: bladmuziek-API geeft 404", r.status() === 404, String(r.status()));
  await browser.close();
}
{
  const { browser, ctx } = await session({ width: 390, height: 844 });
  const r = await ctx.request.get(`${BASE}/api/hymns/24/sheet`);
  check("14 beheerder: 200 met notatie", r.status() === 200 && Boolean((await r.json()).sheet?.notation));
  const anon = await (await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })).newContext();
  const a = await anon.request.get(`${BASE}/api/hymns/24/sheet`);
  check("15 niet ingelogd: 404", a.status() === 404, String(a.status()));
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} geslaagd`);
process.exit(failed.length ? 1 : 0);
