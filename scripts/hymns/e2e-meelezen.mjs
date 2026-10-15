// Browsertest "vloeiend meelezen en vooruitkijken" (Lofzangen) met de nep-microfoon van Chromium en een ECHT audiobestand,
// optioneel met een gat (syncverlies) midden in het zingen.
//   WAV=/tmp/audio82/drop72.wav VIEW=stanza|karaoke|sheet VP=portrait|landscape RUN_S=150 PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… \
//     PROMOTE_DB_URL=… AUDIT_BASE_URL=http://localhost:3112 SHOTS_DIR=/tmp/shots node scripts/hymns/e2e-meelezen.mjs
// Meet: het volgende couplet staat klaar, de markering loopt tijdens het gat door (geschat) en springt bij herstel niet terug, een vanzelf
// doorschakelend couplet veroorzaakt geen scrollsprong, de bladmuziek van het volgende couplet is al gegraveerd, en de microfoon start niet opnieuw.
// Chromium-emulatie: GEEN bewijs voor een echte iPhone.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3112";
const WAV = process.env.WAV ?? "/tmp/audio82/drop72.wav";
const VIEW = process.env.VIEW ?? "stanza";
const VP = process.env.VP ?? "portrait";
const RUN_MS = Number(process.env.RUN_S ?? 150) * 1000;
const HYMN = process.env.HYMN ?? "82";
const GAP = process.env.GAP ? process.env.GAP.split("-").map(Number) : [72, 78]; // seconden sinds de start van het bestand
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "OK  " : "FAIL", name, detail); };

const viewport = VP === "landscape" ? { width: 844, height: 390 } : { width: 390, height: 844 };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}%noloop`, "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport, permissions: ["microphone"], reducedMotion: process.env.REDUCE ? "reduce" : "no-preference", hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await ctx.addInitScript((view) => {
  window.__gum = 0;
  const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => { window.__gum += 1; return g(c); };
  // elke frame: welk couplet getoond wordt en waar de coupletblokken staan (om een sprong van een glijbeweging te onderscheiden)
  window.__frames = [];
  const loop = () => {
    const box = document.querySelector("[data-hymns-scroll]");
    if (box) {
      const rect = box.getBoundingClientRect();
      const shown = Number(document.querySelector('button[aria-pressed="true"][aria-label^="Couplet"]')?.getAttribute("aria-label")?.replace(/\D/g, "") ?? 0);
      const blocks = {};
      document.querySelectorAll("[data-stanza-block]").forEach((b) => { blocks[b.getAttribute("data-stanza-block")] = Math.round(b.getBoundingClientRect().top - rect.top); });
      if (window.__frames.length < 60000) window.__frames.push({ t: performance.now(), shown, blocks, st: Math.round(box.scrollTop) });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try { localStorage.setItem("versado:hymns:prefs:v1", JSON.stringify({ view, size: "normal", autoScroll: true, calm: false, sheetZoom: 100 })); } catch {}
}, VIEW);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const em = `lees-${Date.now().toString(36)}@example.test`;
await ctx.request.post(`${BASE}/api/auth/register`, { data: { email: em, handle: `Lees ${Math.random().toString(36).slice(2, 7)}`, password: "Wachtwoord-123!" } });
execFileSync("psql", [process.env.PROMOTE_DB_URL, "-c", `update "User" set "isAdmin"=true where email='${em}'`]);
await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: em, password: "Wachtwoord-123!" } });
await page.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.locator(`[data-hymn-number="${HYMN}"]`).click({ timeout: 120000 });
await page.locator("[data-hymns-scroll]").waitFor({ timeout: 30000 });
if (VIEW === "sheet") await page.locator("[data-hymns-sheet] svg").first().waitFor({ timeout: 30000 });

// Het volgende couplet staat al klaar vóór er gezongen wordt
const previewBefore = VIEW === "sheet" ? null : (await page.locator("[data-hymns-preview]").first().innerText().catch(() => "")).replace(/\s+/g, " ");
if (VIEW !== "sheet") {
  check(`${VIEW}/${VP}: het volgende couplet staat klaar onder het huidige (vóór het luisteren)`, /Volgend couplet 2/i.test(previewBefore ?? ""), previewBefore?.slice(0, 60));
  const inView = await page.evaluate(() => { const box = document.querySelector("[data-hymns-scroll]").getBoundingClientRect(); const p = document.querySelector("[data-hymns-preview]"); if (!p) return false; const r = p.getBoundingClientRect(); return r.top < box.bottom; });
  if (VP === "portrait" && VIEW === "karaoke") check(`${VIEW}/${VP}: het voorbeeld van het volgende couplet begint binnen het scherm`, inView);
}
await page.getByRole("button", { name: "Start luisteren", exact: true }).click();
const t0 = Date.now();

const sample = () => page.evaluate((view) => {
  const box = document.querySelector("[data-hymns-scroll]");
  const rect = box.getBoundingClientRect();
  const shown = Number(document.querySelector('button[aria-pressed="true"][aria-label^="Couplet"]')?.getAttribute("aria-label")?.replace(/\D/g, "") ?? 0);
  const out = { shown, scrollTop: Math.round(box.scrollTop), status: document.querySelector("[data-hymns-status]")?.textContent?.trim() ?? null, h: rect.height, top: rect.top };
  if (view === "sheet") {
    const a = document.querySelector('[data-hymns-sheet] [data-active="true"]');
    out.active = a ? Number(a.getAttribute("data-seq")) : -1;
    out.estimated = Boolean(document.querySelector('[data-hymns-sheet] [data-estimated="true"]'));
    const s = document.querySelector("[data-hymns-sheet]");
    out.ready = s?.getAttribute("data-hymns-sheet-ready") === "true";
    out.next = s?.getAttribute("data-hymns-sheet-next");
  } else {
    const line = document.querySelector('[data-hymns-scroll] [data-seq][aria-current="true"]');
    out.line = line ? Number(line.getAttribute("data-seq")) : -1;
    out.lineY = line ? Math.round(line.getBoundingClientRect().top - rect.top) : null;
    const words = [...document.querySelectorAll("[data-hymns-scroll] .hymn-word")];
    const idx = words.findIndex((w) => w.classList.contains("text-vs-accent") && w.classList.contains("font-bold"));
    out.word = line && idx >= 0 ? words[idx].textContent : null;
    out.wordIdx = idx;
    out.estimated = Boolean(document.querySelector('[data-hymns-scroll] [data-estimated="true"]'));
    const blocks = Object.fromEntries([...document.querySelectorAll("[data-stanza-block]")].map((b) => [b.getAttribute("data-stanza-block"), Math.round(b.getBoundingClientRect().top - rect.top)]));
    out.blocks = blocks;
  }
  return out;
}, VIEW);

const rows = [];
let gumMax = 1;
while (Date.now() - t0 < RUN_MS) {
  await new Promise((r) => setTimeout(r, 200));
  const s = await sample().catch(() => null);
  if (s) rows.push({ t: (Date.now() - t0) / 1000, ...s });
}
gumMax = await page.evaluate(() => window.__gum);
await page.screenshot({ path: `${SHOTS}/meelezen-${VIEW}-${VP}.png` });
const log = rows.filter((r, i) => i === 0 || r.status !== rows[i - 1].status || r.shown !== rows[i - 1].shown || r.estimated !== rows[i - 1].estimated);
for (const r of log) console.log(`  ${r.t.toFixed(0)}s status="${r.status}" couplet=${r.shown} geschat=${r.estimated} regel=${r.line ?? r.active}`);

// 1. er is gemarkeerd
const marked = rows.filter((r) => (VIEW === "sheet" ? r.active >= 0 : r.line >= 0));
check(`${VIEW}/${VP}: tijdens het zingen wordt gemarkeerd`, marked.length > 20, `${marked.length} samples`);
// 2. tijdens het gat: de markering loopt door als geschat (alleen bij echte gaten)
const gapAbs = [t0 / 1000, 0];
const estimatedRows = rows.filter((r) => r.estimated);
if (process.env.EXPECT_ESTIMATE === "0") check(`${VIEW}/${VP}: zonder storing wordt er nooit geschat (alleen gemeten markering)`, estimatedRows.length === 0, `${estimatedRows.length} geschatte samples`);
if (process.env.EXPECT_ESTIMATE !== "0") {
  check(`${VIEW}/${VP}: bij syncverlies loopt de markering geschat door (data-estimated)`, estimatedRows.length >= 5, `${estimatedRows.length} samples`);
  if (estimatedRows.length) {
    const first = estimatedRows[0], last = estimatedRows[estimatedRows.length - 1];
    const progressed = VIEW === "sheet" ? last.active !== first.active : (last.line !== first.line || last.wordIdx !== first.wordIdx);
    check(`${VIEW}/${VP}: de geschatte markering beweegt (loopt door) en bevriest niet direct`, progressed, `${first.line ?? first.active}/${first.wordIdx ?? ""} -> ${last.line ?? last.active}/${last.wordIdx ?? ""}`);
  }
}
// 3. nooit terug (binnen één couplet)
let backwards = 0;
for (let i = 1; i < marked.length; i += 1) {
  const a = marked[i - 1], b = marked[i];
  if (a.shown !== b.shown) continue;
  const ka = VIEW === "sheet" ? a.active : a.line * 1000 + a.wordIdx;
  const kb = VIEW === "sheet" ? b.active : b.line * 1000 + b.wordIdx;
  if (kb < ka - (VIEW === "sheet" ? 0 : 1)) { backwards += 1; console.log(`  terug op ${b.t.toFixed(1)}s: ${VIEW === "sheet" ? `maat ${a.active} -> ${b.active}` : `${ka} -> ${kb}`} (couplet ${a.shown}->${b.shown}, status "${a.status}"->"${b.status}", geschat ${a.estimated}->${b.estimated})`); }
}
check(`${VIEW}/${VP}: de markering springt nooit terug (ook niet bij herstel)`, backwards === 0, `${backwards} keer terug`);
// 4. coupletwissel zonder scrollsprong
const frames = await page.evaluate(() => window.__frames);
let fsw = -1;
for (let i = 1; i < frames.length; i += 1) if (frames[i].shown !== frames[i - 1].shown && frames[i - 1].shown > 0) { fsw = i; break; }
if (fsw > 0 && VIEW !== "sheet") {
  const n = frames[fsw].shown;
  const prevTop = frames[fsw - 1].blocks[n];
  const seq = frames.slice(fsw, fsw + 60).map((f) => f.blocks[n]).filter((v) => v !== undefined);
  const first = seq[0];
  let maxStep = 0;
  for (let i = 1; i < seq.length; i += 1) maxStep = Math.max(maxStep, Math.abs(seq[i] - seq[i - 1]));
  check(`${VIEW}/${VP}: couplet ${frames[fsw - 1].shown}->${n} schakelt door zonder sprong: het nieuwe couplet begint waar het voorbeeld stond en glijdt (frame voor frame gemeten)`,
    prevTop !== undefined && Math.abs(first - prevTop) <= 60 && maxStep <= 50, `voorbeeld ${prevTop}px, eerste frame ${first}px, grootste stap ${maxStep}px/frame, eind ${seq[seq.length - 1]}px`);
}
const sw = rows.findIndex((r, i) => i > 0 && r.shown !== rows[i - 1].shown && rows[i - 1].shown > 0);
if (sw > 0 && VIEW !== "sheet") {
  console.log(`  doorgeschakeld op ${rows[sw].t.toFixed(0)}s`);
} else if (VIEW !== "sheet") console.log("  (geen coupletwissel binnen de testduur)");
if (sw > 0 && VIEW === "sheet") {
  const around = rows.slice(Math.max(0, sw - 3), sw + 5);
  check(`${VIEW}/${VP}: de bladmuziek van het volgende couplet was al gegraveerd (geen leeg blad bij de wissel)`, around.every((r) => r.ready), JSON.stringify(around.map((r) => r.ready)));
}
if (VIEW === "sheet") {
  const preRendered = rows.filter((r) => r.next && Number(r.next) === r.shown + 1);
  check(`${VIEW}/${VP}: het volgende couplet wordt alvast gegraveerd`, preRendered.length > 5, `${preRendered.length} samples`);
}
// 5. vooruitkijken: actieve regel hoog op het scherm (karaoke/volledig couplet)
if (VIEW !== "sheet") {
  const ys = marked.map((r) => r.lineY).filter((y) => y !== null);
  // p90: tijdens een vloeiende scroll of de glijbeweging bij een coupletwissel staat de regel kort tussen twee plekken
  const fr = ys.map((y) => y / marked[0].h).sort((a, b) => a - b);
  const p90 = fr[Math.floor(fr.length * 0.9)];
  check(`${VIEW}/${VP}: de actieve regel staat (p90) in de bovenste ~58% (ruimte om vooruit te lezen)`, p90 <= 0.58, `p90 ${p90.toFixed(2)}, max ${fr[fr.length - 1].toFixed(2)}`);
}
// 6. microfoon, overflow, fouten
check(`${VIEW}/${VP}: één microfoonaanvraag, geen paginafouten`, gumMax === 1 && errors.length === 0, `gum=${gumMax} ${errors.slice(0, 2).join(" ; ")}`);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(`${VIEW}/${VP}: geen horizontale overflow`, overflow <= 0, String(overflow));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} geslaagd`);
process.exit(failed.length ? 1 : 0);
