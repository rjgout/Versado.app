// Browsertest van foutsituaties in de live audioketen (Chromium, nep-microfoon met een echt bestand):
//   SCENARIO=bundle500   de herkenningsbundel geeft een serverfout
//   SCENARIO=bundleslow  de herkenningsbundel komt pas na 12 s
//   SCENARIO=idbhang     IndexedDB (iOS-gedrag) antwoordt nooit
//   SCENARIO=bundleselect  bundlefout, daarna kiest de gebruiker zelf lofzang 82: de telefoon moet die direct volgen
//   SCENARIO=bundleretry   bundlefout, daarna 'Opnieuw proberen': de lofzang wordt alsnog herkend
//   SCENARIO=noaudio       de worklet levert nooit audiobuffers (kapotte of onderbroken audioketen): dat moet zichtbaar worden
//   SCENARIO=unknown     een melodie die niet in de bibliotheek zit, > 2 minuten (de microfoon mag niet stoppen)
// De microfoon mag in geen enkel scenario vanzelf stoppen; een fout moet zichtbaar zijn.
//   PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… WAV=… UNKNOWN_WAV=… PROMOTE_DB_URL=… AUDIT_BASE_URL=… SCENARIO=… node scripts/hymns/e2e-live-failures.mjs
// Chromium-emulatie: GEEN bewijs voor een echte iPhone-microfoon.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3109";
const SCENARIO = process.env.SCENARIO ?? "bundle500";
const WAV = SCENARIO === "unknown" ? (process.env.UNKNOWN_WAV ?? "/tmp/audio82/unknown48.wav") : (process.env.WAV ?? "/tmp/audio82/acc48.wav");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "OK  " : "FAIL", name, detail); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}%noloop`, "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["microphone"], reducedMotion: "reduce" });
await ctx.addInitScript((scenario) => {
  window.__mic = { gum: 0, tracks: [], ended: [] };
  const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => { window.__mic.gum += 1; const s = await g(c); s.getTracks().forEach((t) => { window.__mic.tracks.push(t); t.addEventListener("ended", () => window.__mic.ended.push(Date.now())); }); return s; };
  if (scenario === "noaudio") {
    const Real = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Real { constructor(...a) { super(...a); Object.defineProperty(this.port, "onmessage", { set() {}, get() { return null; } }); } };
  }
  if (scenario === "idbhang") { indexedDB.open = () => ({}); } // zoals een iOS-Safari waarbij open() nooit antwoordt: geen onsuccess, geen onerror
}, SCENARIO);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror " + e));
let bundleCalls = 0;
if (SCENARIO === "bundleretry") await page.route("**/api/hymns/recognition", (r) => { bundleCalls += 1; return bundleCalls <= 2 ? r.fulfill({ status: 500, body: "{}" }) : r.continue(); });
if (SCENARIO === "bundle500" || SCENARIO === "bundleselect") await page.route("**/api/hymns/recognition", (r) => r.fulfill({ status: 500, body: "{}" }));
if (SCENARIO === "bundleslow") await page.route("**/api/hymns/recognition", async (r) => { await new Promise((x) => setTimeout(x, 12000)); await r.continue(); });
const em = `fail-${Date.now().toString(36)}@example.test`;
const pw = "Wachtwoord-123!";
await ctx.request.post(`${BASE}/api/auth/register`, { data: { email: em, handle: `Fail ${Math.random().toString(36).slice(2, 7)}`, password: pw } });
execFileSync("psql", [process.env.PROMOTE_DB_URL, "-c", `update "User" set "isAdmin"=true where email='${em}'`]);
await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: em, password: pw } });
await page.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.getByRole("button", { name: "Herken lofzang", exact: true }).waitFor({ timeout: 120000 });
const micInfo = () => page.evaluate(() => ({ gum: window.__mic.gum, live: window.__mic.tracks.filter((t) => t.readyState === "live").length, ended: window.__mic.ended.length }));
const status = async () => (await page.locator("[data-hymns-status], [data-hymns-recognition-status]").first().textContent({ timeout: 500 }).catch(() => null))?.trim() ?? null;
const bodyText = async () => (await page.locator("body").innerText({ timeout: 1000 }).catch(() => "")) ?? "";
let lastStatus = null, stoppedAt = null, locked = null, sawError = false, sawDiag = false;
const t0 = Date.now();
await page.getByRole("button", { name: "Herken lofzang", exact: true }).click();
if (SCENARIO === "bundleselect") {
  await page.locator("[data-hymns-bundle-error]").waitFor({ timeout: 40000 });
  await page.locator(`[data-hymn-number="82"]`).click();
}
if (SCENARIO === "bundleretry") {
  await page.locator("[data-hymns-bundle-retry]").waitFor({ timeout: 40000 });
  await page.locator("[data-hymns-bundle-retry]").click();
}
if (SCENARIO === "noaudio") {
  await page.locator("[data-hymns-no-audio]").waitFor({ timeout: 15000 }).catch(() => {});
  sawError = (await page.locator("[data-hymns-no-audio]").count()) > 0;
  await page.locator("[data-hymns-settings]").click();
  await page.locator("[data-hymns-technical-open]").click().catch(() => {});
  sawDiag = (await page.locator("[data-hymns-diagnostics]").count()) > 0;
  console.log("  diagnostiek:", ((await page.locator("[data-hymns-diagnostics]").innerText().catch(() => "")) ?? "").replace(/\n+/g, " | ").slice(0, 400));
}
const limit = (SCENARIO === "unknown" ? 150 : SCENARIO === "noaudio" ? 5 : 70) * 1000;

while (Date.now() - t0 < limit) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await status(); if (s) lastStatus = s;
  const m = await micInfo();
  if (!m.live && stoppedAt === null && Date.now() - t0 > 2500) stoppedAt = (Date.now() - t0) / 1000;
  if (s && /Volgt muziek/.test(s) && locked === null) locked = (Date.now() - t0) / 1000;
  const txt = await bodyText();
  if (/herkenningsgegevens/i.test(txt)) sawError = true;
  if (await page.locator("[data-hymns-diagnostics]").count()) sawDiag = true;
  if (locked !== null && (Date.now() - t0) / 1000 > locked + 5) break;
}
const m = await micInfo();
console.log(JSON.stringify({ scenario: SCENARIO, lastStatus, stoppedAt, locked, mic: m, sawError, sawDiag, errors: errors.slice(0, 3) }));
check(`${SCENARIO}: de microfoon stopt niet vanzelf`, stoppedAt === null && m.live > 0 && m.ended === 0, JSON.stringify({ stoppedAt, ...m }));
if (SCENARIO === "noaudio") check("noaudio: 'Geen geluid ontvangen' is zichtbaar én de diagnostiek toont 0 buffers", sawError && sawDiag);
if (SCENARIO === "bundle500") check("bundle500: de fout is zichtbaar (melding over de herkenningsgegevens)", sawError);
if (["bundleslow", "idbhang", "bundleselect", "bundleretry"].includes(SCENARIO)) check(`${SCENARIO}: de lofzang wordt alsnog herkend en gevolgd`, locked !== null, String(locked));
if (SCENARIO === "unknown") check("unknown: een onbekende melodie laat de microfoon > 2 minuten actief en toont 'niet herkend'", (Date.now() - t0) > 140000 && /niet herkend|Mogelijke|Geen van|Luistert|herkend/.test(lastStatus ?? ""), String(lastStatus));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} geslaagd`);
process.exit(failed.length ? 1 : 0);
