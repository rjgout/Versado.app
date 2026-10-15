// Browsertest "bladmuziek + muzieksessie" met de nep-microfoon van Chromium: maatmarkering alleen bij betrouwbare positie,
// handmatig bladeren heeft voorrang (geen terugscroll, 'Zelf bladeren', hervatten) en een weergavewissel start geen nieuwe microfoon.
//   npx tsx scripts/hymns/make-service-audio.ts 82 /tmp/dienst82-3.wav heel-pauze 3
//   PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… WAV=/tmp/dienst82-3.wav HYMN=82 PROMOTE_DB_URL=… AUDIT_BASE_URL=http://localhost:3108 \
//     SHOTS_DIR=/tmp/shots node scripts/hymns/e2e-sheet-sync.mjs
// Chromium-emulatie: GEEN bewijs voor iPhone-Safari of een WKWebView.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3108";
const WAV = process.env.WAV ?? "/tmp/dienst82-3.wav";
const HYMN = process.env.HYMN ?? "82";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "OK  " : "FAIL", name, detail); };
const wait = async (fn, timeout, step = 250) => { const end = Date.now() + timeout; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, step)); } return null; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}%noloop`, "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["microphone"], reducedMotion: "reduce" });
await ctx.addInitScript(() => {
  window.__gum = 0;
  const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => { window.__gum += 1; return g(c); };
  try { localStorage.setItem("versado:hymns:prefs:v1", JSON.stringify({ view: "sheet", size: "normal", autoScroll: true, calm: false, sheetZoom: 100 })); } catch {}
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const em = `sync-${Date.now().toString(36)}@example.test`;
const pw = "Wachtwoord-123!";
await ctx.request.post(`${BASE}/api/auth/register`, { data: { email: em, handle: `Sync ${Math.random().toString(36).slice(2, 7)}`, password: pw } });
execFileSync("psql", [process.env.PROMOTE_DB_URL, "-c", `update "User" set "isAdmin"=true where email='${em}'`]);
await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: em, password: pw } });
await page.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.locator(`[data-hymn-number="${HYMN}"]`).click({ timeout: 120000 });
await page.locator("[data-hymns-sheet] svg").first().waitFor({ timeout: 30000 });
await page.locator("[data-hymns-sheet] [data-seq]").first().waitFor({ timeout: 30000 });

const active = () => page.evaluate(() => { const el = document.querySelector('[data-hymns-sheet] [data-active="true"]'); return el ? Number(el.getAttribute("data-seq")) : -1; });
const scrollTop = () => page.locator("[data-hymns-scroll]").evaluate((el) => el.scrollTop);
const browsing = () => page.locator("[data-hymns-browsing]").count().then((n) => n > 0);

check("1 zonder microfoon: blad zichtbaar, geen markering, geen microfoon gestart", (await active()) === -1 && (await page.evaluate(() => window.__gum)) === 0);
await page.getByRole("button", { name: "Start luisteren", exact: true }).click();
await page.getByText("Microfoon is actief").first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1500);
check("2 voorspel: geen maatmarkering (er wordt nog niet gezongen)", (await active()) === -1, String(await active()));
await page.screenshot({ path: `${SHOTS}/sync-voorspel.png` });
const first = await wait(async () => { const a = await active(); return a >= 0 ? a : null; }, 90000);
check("3 tijdens de zang volgt de actuele maat (gevalideerde gravure, betrouwbare positie)", first !== null, String(first));
await page.screenshot({ path: `${SHOTS}/sync-maat.png` });
const later = await wait(async () => { const a = await active(); return a >= 0 && a !== first ? a : null; }, 30000);
check("4 de markering loopt mee met de muziek", later !== null, `${first} -> ${later}`);
// handmatig bladeren
const box = await page.locator("[data-hymns-scroll]").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, 700);
await page.waitForTimeout(500);
check("5 eigen scrollgebaar: 'Zelf bladeren' + hervatknop", (await browsing()) && (await page.locator("[data-hymns-resume]").count()) === 1);
const st = await scrollTop();
const m1 = await active();
await page.waitForTimeout(3000);
const m2 = await active();
check("6 geen terugscroll terwijl de gebruiker zelf leest; de muziek loopt intussen door", Math.abs((await scrollTop()) - st) <= 2, `${st} -> ${await scrollTop()} (maat ${m1} -> ${m2})`);
check("6b microfoon blijft precies één keer gevraagd", (await page.evaluate(() => window.__gum)) === 1);
// weergavewissel tijdens het luisteren
await page.locator("[data-hymns-view-toggle]").click();
await page.waitForTimeout(500);
check("7 weergavewissel (sheet → couplet) tijdens het luisteren: nog steeds één microfoon", (await page.evaluate(() => window.__gum)) === 1 && (await page.getByText("Microfoon is actief").count()) > 0);
await page.locator("[data-hymns-view-toggle]").click();
await page.locator("[data-hymns-view-toggle]").click();
await page.locator("[data-hymns-sheet] svg").first().waitFor({ timeout: 30000 });
check("7b terug naar bladmuziek: nog één microfoon", (await page.evaluate(() => window.__gum)) === 1);
// hervatten
if (await page.locator("[data-hymns-resume]").count()) {
  await page.locator("[data-hymns-resume]").click();
  await page.waitForTimeout(800);
  const resumed = !(await browsing());
  const note = (await page.locator("[data-hymns-resume-note]").count()) === 1;
  check("8 'Automatisch volgen hervatten': hervat bij betrouwbare positie, anders een nette melding", resumed || note, `hervat=${resumed} melding=${note}`);
}
check("9 geen paginafouten", errors.length === 0, errors.slice(0, 2).join(" ; "));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} geslaagd`);
process.exit(failed.length ? 1 : 0);
