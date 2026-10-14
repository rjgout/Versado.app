// Browsertest van de Lofzangen-proef met de nep-microfoon van Chromium (een WAV-bestand dient als microfoon).
// Vereist een draaiende app (dev, met HYMNS_POC=1 in productie) en Playwright (niet in package.json):
//   npx tsx scripts/hymns/make-test-audio.ts 82 /tmp/mic82.wav 100 3 48000
//   PLAYWRIGHT_MODULE=/pad/naar/playwright CHROMIUM_PATH=/pad/naar/chrome WAV=/tmp/mic82.wav HYMN=82 \
//     AUDIT_BASE_URL=http://localhost:3100 node scripts/hymns/e2e-browser.mjs
// Maakt zelf een testaccount aan (de eerste registratie op een verse installatie wordt beheerder).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";
const WAV = process.env.WAV ?? "/tmp/mic82.wav";
const HYMN = process.env.HYMN ?? "82";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const stamp = Date.now().toString(36);
const email = `lofzang-${stamp}@example.test`, handle = `Lofzang ${stamp}`, password = "Wachtwoord-123!";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "OK  " : "FAIL", name, detail); };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}`, "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["microphone"], reducedMotion: "reduce" });
const page = await ctx.newPage();
const net = [];
page.on("request", (r) => net.push({ url: r.url(), method: r.method(), post: r.postData()?.length ?? 0 }));
const wsFrames = [];
page.on("websocket", (ws) => ws.on("framesent", (f) => wsFrames.push({ url: ws.url(), bytes: (f.payload?.length ?? 0) })));
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

// account (eerste of nieuwe gebruiker), daarna inloggen via de gewone route
let res = await ctx.request.post(`${BASE}/api/auth/register`, { data: { email, handle, password } });
check("account aangemaakt", res.ok(), String(res.status()));
res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: email, password } });
check("ingelogd", res.ok(), String(res.status()));

await page.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded", timeout: 120000 }); await page.locator("h1").first().waitFor({ timeout: 120000 });
check("proefpagina bereikbaar", (await page.locator("h1").first().textContent())?.includes("Lofzangen"));
await page.screenshot({ path: `${SHOTS}/01-start.png`, fullPage: true });
check("microfoon is uit bij openen", (await page.getByText("Microfoon is uit").count()) > 0);
check("geen horizontale overflow (390 px)", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

await page.selectOption("#hymn-select", HYMN);
const requestsBeforeMic = net.length;
await page.getByRole("button", { name: "Start luisteren" }).click();
await page.getByText("Microfoon is actief").first().waitFor({ timeout: 10000 });
check("microfoon actief na expliciete start", true);

const statusText = async () => (await page.locator('[aria-live="polite"]').first().textContent())?.trim();
const activeLine = async () => (await page.locator('p[aria-current="true"]').first().textContent().catch(() => null))?.trim() ?? null;
const samples = [];
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000);
  const s = await statusText(); const l = await activeLine();
  samples.push({ t: (i + 1) * 2, status: s, line: l });
  if (i === 3 || i === 10 || i === 20) await page.screenshot({ path: `${SHOTS}/02-volgen-${i}.png`, fullPage: false });
}
console.log(samples.map((s) => `${s.t}s ${s.status} | ${s.line}`).join("\n"));
check("gesynchroniseerd na enkele seconden", samples.slice(0, 8).some((s) => s.status === "Gesynchroniseerd"), samples.slice(0, 8).map((s) => s.status).join(","));
const lines = new Set(samples.map((s) => s.line).filter(Boolean));
check("de actieve regel verandert mee met de muziek", lines.size >= 4, `${lines.size} verschillende regels`);

// handmatig couplet kiezen terwijl de microfoon actief is
const before = await page.getByText("Microfoon is actief").count();
await page.getByRole("button", { name: "Couplet 4" }).click();
await page.waitForTimeout(500);
check("tikken op couplet 4 toont couplet 4", (await page.locator("h3").first().textContent())?.includes("Couplet 4"));
check("microfoon bleef actief na couplet kiezen", (await page.getByText("Microfoon is actief").count()) === before && before > 0);
await page.waitForTimeout(3000);
check("na handmatige keuze blijft couplet 4 staan", (await page.locator("h3").first().textContent())?.includes("Couplet 4"));
await page.screenshot({ path: `${SHOTS}/03-couplet4.png`, fullPage: false });

// volgorde kiezen
await page.getByRole("button", { name: "Volgorde kiezen" }).click();
await page.getByRole("button", { name: "Couplet 1" }).click();
await page.getByRole("button", { name: "Couplet 4" }).click();
check("volgorde 1 → 4 wordt getoond", (await page.getByText("Volgorde: 1 → 4").count()) > 0);
await page.getByRole("button", { name: "Klaar" }).click();

// netwerkverkeer tijdens luisteren: geen requests naar de server met audio-achtige payloads
const during = net.slice(requestsBeforeMic).filter((r) => !/_next|\.(js|css|png|svg|ico|webp|woff2?)(\?|$)/.test(r.url));
const withBody = during.filter((r) => r.post > 0);
check("tijdens luisteren verstuurt de pagina geen enkel verzoek met inhoud (geen audio naar de server)", withBody.length === 0, JSON.stringify(withBody.slice(0, 5)));
// de ontwikkelserver van Next stuurt zelf grote HMR-frames; die tellen niet mee
const bigWs = wsFrames.filter((f) => f.bytes > 1000 && !new URL(f.url).pathname.startsWith("/_next/hmr"));
check("geen grote WebSocket-frames verstuurd (geen audiostream)", bigWs.length === 0, `${wsFrames.length} frames; groot: ${JSON.stringify(bigWs.map((f) => [new URL(f.url).pathname, f.bytes]))}`);
console.log("achtergrondverkeer van de app zelf tijdens luisteren:", JSON.stringify(during.filter((r) => r.method !== "GET").map((r) => `${r.method} ${new URL(r.url).pathname}`)));

// stoppen
await page.getByRole("button", { name: "Stop" }).first().click();
await page.getByText("Microfoon is uit").first().waitFor({ timeout: 5000 });
check("microfoon uit na Stop", true);
// de pagina ziet geen actieve track meer
const live = await page.evaluate(async () => { const d = await navigator.mediaDevices.enumerateDevices(); return d.length; });
console.log("devices", live);

// herkenmodus
await page.getByRole("button", { name: "Herken lofzang" }).click();
await page.getByRole("button", { name: "Start luisteren" }).click();
await page.getByText("Microfoon is actief").first().waitFor({ timeout: 10000 });
await page.waitForTimeout(25000);
const rec = (await page.locator('section[aria-label="Herkenning"]').textContent())?.replace(/\s+/g, " ");
console.log("herkenning:", rec);
await page.screenshot({ path: `${SHOTS}/04-herken.png`, fullPage: false });
check("herkenning toont een uitspraak", !!rec && /Luisteren|Mogelijke|Dit lijkt|Meerdere|Geen van/.test(rec));
await page.getByRole("button", { name: "Stop" }).first().click();

// verlaten van de pagina stopt de microfoon
await page.getByRole("button", { name: "Herken lofzang" }).click();
await page.getByRole("button", { name: "Start luisteren" }).click();
await page.getByText("Microfoon is actief").first().waitFor({ timeout: 10000 });
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
check("navigeren weg van de proef gaat zonder fouten", errors.filter((e) => !/favicon|hydrat|sw\.js|caret-color|Failed to load resource/i.test(e)).length === 0, errors.slice(0, 3).join(" | "));

// donker, 320 px, grote tekst
const dark = await browser.newContext({ viewport: { width: 320, height: 700 }, colorScheme: "dark", permissions: ["microphone"] });
const cookies = await ctx.cookies();
await dark.addCookies(cookies);
const p2 = await dark.newPage();
await p2.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded", timeout: 120000 }); await p2.locator("h1").first().waitFor({ timeout: 60000 });
await p2.addStyleTag({ content: "html{font-size:32px !important}" });
await p2.waitForTimeout(500);
check("geen horizontale overflow bij 320 px en 200% tekst (donker)", await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await p2.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
await p2.screenshot({ path: `${SHOTS}/05-donker-320-200.png`, fullPage: true });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gelukt`);
process.exit(failed.length ? 1 : 0);
