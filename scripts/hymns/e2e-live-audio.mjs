// Browsertest van de volledige live audioketen met een ECHT audiobestand als nep-microfoon van Chromium
// (microfoon -> AudioWorklet -> extractor -> herkenner of volger -> UI). Geen synthese.
//   ffmpeg -i bron.mp3 -ac 1 -ar 48000 /tmp/audio82/acc48.wav     (de bron blijft buiten git: bronrechten)
//   PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… WAV=/tmp/audio82/acc48.wav PROMOTE_DB_URL=… AUDIT_BASE_URL=http://localhost:3109 \
//     MODE=recognize|follow HYMN=82 TITLE="Kom, volg Mij na" node scripts/hymns/e2e-live-audio.mjs
// Dit is Chromium met een nep-microfoon: het test de webketen, NIET de microfoon, AudioContext of achtergrondgedrag van een iPhone.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3109";
const WAV = process.env.WAV ?? "/tmp/audio82/acc48.wav";
const MODE = process.env.MODE ?? "recognize";
const HYMN = process.env.HYMN ?? "82";
const TITLE = process.env.TITLE ?? "Kom, volg Mij na";
const LIMIT = Number(process.env.LIMIT_S ?? 150) * 1000;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "OK  " : "FAIL", name, detail); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}%noloop`, "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["microphone"], reducedMotion: "reduce" });
await ctx.addInitScript(() => {
  window.__mic = { gum: 0, tracks: [], ended: [] };
  const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => { window.__mic.gum += 1; const s = await g(c); s.getTracks().forEach((t) => { window.__mic.tracks.push(t); t.addEventListener("ended", () => window.__mic.ended.push(Date.now())); }); return s; };
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror " + e));
page.on("console", (m) => { if (m.type() === "error") errors.push("console " + m.text()); });
const failedReq = [];
page.on("response", (r) => { if (r.url().includes("/api/hymns") && !r.ok()) failedReq.push(`${r.status()} ${r.url()}`); });
const em = `live-${Date.now().toString(36)}@example.test`;
const pw = "Wachtwoord-123!";
await ctx.request.post(`${BASE}/api/auth/register`, { data: { email: em, handle: `Live ${Math.random().toString(36).slice(2, 7)}`, password: pw } });
if (process.env.PROMOTE_DB_URL) execFileSync("psql", [process.env.PROMOTE_DB_URL, "-c", `update "User" set "isAdmin"=true where email='${em}'`]);
await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: em, password: pw } });
await page.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.getByRole("button", { name: "Herken lofzang" }).or(page.locator(`[data-hymn-number="${HYMN}"]`)).first().waitFor({ timeout: 120000 });

const status = async () => (await page.locator("[data-hymns-status]").first().textContent({ timeout: 500 }).catch(() => null))?.trim() ?? null;
const micInfo = () => page.evaluate(() => ({ gum: window.__mic.gum, live: window.__mic.tracks.filter((t) => t.readyState === "live").length, ended: window.__mic.ended.length }));
const micText = async () => (await page.locator("[data-hymns-mic]").first().textContent({ timeout: 500 }).catch(() => null))?.trim() ?? null;
const t0 = Date.now();
if (MODE === "recognize") {
  await page.getByRole("button", { name: "Herken lofzang", exact: true }).click();
} else {
  const byNumber = page.locator(`[data-hymn-number="${HYMN}"]`);
  if (await byNumber.count()) await byNumber.click(); else await page.getByRole("button", { name: new RegExp(TITLE) }).first().click();
  await page.getByRole("button", { name: "Start luisteren", exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Start luisteren", exact: true }).click();
}
const seen = new Map();
let followedAt = null, lockedAt = null, singing = null, lastMic = null;
while (Date.now() - t0 < LIMIT) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await status();
  const m = await micInfo();
  const txt = await micText();
  lastMic = { ...m, txt };
  if (s && !seen.has(s)) { seen.set(s, ((Date.now() - t0) / 1000).toFixed(0)); console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s status="${s}" mic=${JSON.stringify(m)} ${txt ?? ""}`); }
  if (s && /Volgt muziek/.test(s) && lockedAt === null) lockedAt = (Date.now() - t0) / 1000;
  if (await page.locator("[data-hymns-karaoke], [data-hymns-stanza]").count() && followedAt === null && !(await page.locator("[data-hymns-recognition]").count())) followedAt = (Date.now() - t0) / 1000;
  if (!m.live && Date.now() - t0 > 3000) { console.log("  microfoon gestopt:", JSON.stringify(m), txt); break; }
  if (lockedAt !== null && (Date.now() - t0) / 1000 > lockedAt + 25) break;
}
const m = await micInfo();
console.log(JSON.stringify({ mode: MODE, lockedAt, followedAt, mic: m, statuses: [...seen.entries()], failedReq, errors: errors.slice(0, 5) }));
check(`${MODE}: de synchronisatie ('Volgt muziek') wordt bereikt`, lockedAt !== null, String(lockedAt));
check(`${MODE}: de microfoon bleef actief`, m.live > 0 && m.ended === 0, JSON.stringify(m));
check(`${MODE}: geen mislukte /api/hymns-verzoeken en geen paginafouten`, failedReq.length === 0 && errors.length === 0, [...failedReq, ...errors].slice(0, 3).join(" ; "));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} geslaagd`);
process.exit(failed.length ? 1 : 0);
