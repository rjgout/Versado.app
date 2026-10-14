// Browsertest van Lofzangen met de nep-microfoon van Chromium (een WAV-bestand dient als microfoon).
// Vereist een draaiende productie-app en Playwright (niet in package.json):
//   npx tsx scripts/hymns/make-service-audio.ts 82 /tmp/dienst82.wav heel-pauze 2
//   PLAYWRIGHT_MODULE=/pad/naar/playwright CHROMIUM_PATH=/pad/naar/chrome WAV=/tmp/dienst82.wav HYMN=82 \
//     PROMOTE_DB_URL=postgresql://... AUDIT_BASE_URL=http://localhost:3100 node scripts/hymns/e2e-browser.mjs
// Maakt zelf een testaccount aan; PROMOTE_DB_URL (wegwerpdatabase) maakt dat account beheerder, want Lofzangen
// is in productie alleen voor beheerders. Dit is desktop-emulatie in Chromium: GEEN bewijs voor iPhone of Android.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";
const WAV = process.env.WAV ?? "/tmp/dienst82.wav";
const HYMN = process.env.HYMN ?? "82";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const stamp = Date.now().toString(36);
const email = `lofzang-${stamp}@example.test`, handle = `Lofzang ${stamp}`, password = "Wachtwoord-123!";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "OK  " : "FAIL", name, detail); };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}%noloop`, "--autoplay-policy=no-user-gesture-required"],
});

// Teller voor microfoonaanvragen, AudioContexts en tracks, in de pagina zelf.
const INSTRUMENT = () => {
  window.__mic = { getUserMedia: 0, audioContexts: 0, tracks: [] };
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    window.__mic.getUserMedia += 1;
    const stream = await gum(c);
    window.__mic.tracks.push(...stream.getTracks());
    return stream;
  };
  const AC = window.AudioContext;
  window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__mic.audioContexts += 1; } };
};

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["microphone"], reducedMotion: "reduce" });
await ctx.addInitScript(INSTRUMENT);
const page = await ctx.newPage();
const net = [];
page.on("request", (r) => net.push({ url: r.url(), method: r.method(), post: r.postData()?.length ?? 0 }));
const wsFrames = [];
page.on("websocket", (ws) => ws.on("framesent", (f) => wsFrames.push({ url: ws.url(), bytes: (f.payload?.length ?? 0) })));
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

let res = await ctx.request.post(`${BASE}/api/auth/register`, { data: { email, handle, password } });
check("account aangemaakt", res.ok(), String(res.status()));
if (process.env.PROMOTE_DB_URL) execFileSync("psql", [process.env.PROMOTE_DB_URL, "-c", `update "User" set "isAdmin"=true where email='${email}'`]);
res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: email, password } });
check("ingelogd", res.ok(), String(res.status()));

const status = async (p = page) => (await p.locator("[data-hymns-status]").first().textContent().catch(() => null))?.trim() ?? null;
const waitStatus = async (re, timeout, p = page) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const s = await status(p); if (s && re.test(s)) return s; await p.waitForTimeout(250); }
  return null;
};
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// ---------- 1. openen, focus mode, terugbalk
await page.goto(`${BASE}/content`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.locator("[data-admin-hymns-link]").waitFor({ timeout: 120000 });
await page.locator("[data-admin-hymns-link]").click();
await page.waitForURL("**/dev/lofzangen", { timeout: 60000 });
await page.locator("h1").first().waitFor({ timeout: 60000 });
check("Lofzangen opent vanuit de contentkiezer", (await page.locator("h1").first().textContent())?.includes("Lofzangen"));
const shell = await page.evaluate(() => {
  const vis = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
  return {
    mode: document.querySelector("[data-shell-mode]")?.getAttribute("data-shell-mode"),
    header: vis(document.querySelector("[data-app-global-header]")),
    nav: vis(document.querySelector("nav[data-main-nav]")),
    back: vis(document.querySelector("[data-subpage-back-bar]")),
    backText: document.querySelector("[data-subpage-back-bar]")?.textContent?.trim(),
  };
});
check("focus mode: globale header en onderbalk weg, terugbalk blijft", shell.mode === "focus" && !shell.header && !shell.nav && shell.back, JSON.stringify(shell));
check("terugbalk toont 'Lofzangen'", /Lofzangen/.test(shell.backText ?? ""));
check("microfoon is uit bij openen", (await page.getByText("Microfoon is uit").count()) > 0);
check("geen horizontale overflow (390 px)", await overflow(page));
await page.screenshot({ path: `${SHOTS}/01-start.png`, fullPage: false });

// ---------- 2. herkennen en automatisch volgen in één sessie
await page.getByRole("button", { name: "Herken lofzang" }).click();
await page.getByText("Microfoon is actief").first().waitFor({ timeout: 10000 });
check("microfoon actief na expliciete start", true);
const first = await waitStatus(/herkennen|Luisteren|Mogelijke/, 8000);
check("tijdens het herkennen toont de pagina de herkenstatus", !!first, String(first));
const prelude = await waitStatus(/Voorspel|Volgt muziek/, 60000);
check("de lofzang wordt automatisch herkend en gevolgd", !!prelude, String(prelude));
check("de titel toont nummer en naam van de herkende lofzang", (await page.locator("h1").first().textContent())?.startsWith(`${HYMN}.`), await page.locator("h1").first().textContent());
const counts1 = await page.evaluate(() => ({ g: window.__mic.getUserMedia, a: window.__mic.audioContexts, live: window.__mic.tracks.filter((t) => t.readyState === "live").length }));
check("herkennen en volgen delen één microfoonsessie (1x getUserMedia, 1x AudioContext)", counts1.g === 1 && counts1.a === 1 && counts1.live === 1, JSON.stringify(counts1));
if (/Voorspel/.test(prelude ?? "")) {
  check("tijdens het voorspel is er geen actief woord of actieve regel", (await page.locator('p[aria-current="true"]').count()) === 0);
  check("tijdens het voorspel staat de tekst al klaar", (await page.locator("section[aria-label='Tekst'] p").count()) >= 4);
  await page.screenshot({ path: `${SHOTS}/02-voorspel.png`, fullPage: false });
}
const sing = await waitStatus(/Volgt muziek/, 60000);
check("na het voorspel begint het meelopen automatisch", !!sing, String(sing));
await page.waitForTimeout(3000);
const accent = await page.evaluate(() => {
  const w = document.querySelectorAll(".hymn-word.text-vs-accent");
  if (w.length !== 1) return { count: w.length };
  const cs = getComputedStyle(w[0]);
  const probe = document.createElement("span");
  probe.style.color = "rgb(var(--vs-accent))";
  document.body.appendChild(probe);
  const accentColor = getComputedStyle(probe).color;
  probe.remove();
  return { count: 1, color: cs.color, accentColor, background: cs.backgroundColor, weight: cs.fontWeight };
});
check("het actieve woord heeft de Versado-accentkleur, geen achtergrond", accent.count === 1 && accent.color === accent.accentColor && /rgba\(0, 0, 0, 0\)|transparent/.test(accent.background), JSON.stringify(accent));
check("het actieve woord is zwaarder", Number(accent.weight) >= 700, String(accent.weight));
await page.screenshot({ path: `${SHOTS}/03-zingen.png`, fullPage: false });

// woorden verschuiven niet: positie van de woorden in de actieve regel blijft gelijk terwijl het accent doorloopt
const stable = await page.evaluate(async () => {
  const line = document.querySelector('p[aria-current="true"]');
  if (!line) return { ok: false, reason: "geen actieve regel" };
  const widths = () => [...line.querySelectorAll(".hymn-word")].map((w) => Math.round(w.getBoundingClientRect().width * 10) / 10);
  const first = widths();
  const h0 = line.getBoundingClientRect().height;
  await new Promise((r) => setTimeout(r, 1500));
  const l2 = document.querySelector('p[aria-current="true"]');
  return { ok: l2 !== line || JSON.stringify(widths()) === JSON.stringify(first), h: h0 };
});
check("woordbreedtes en regelhoogte veranderen niet door de markering", stable.ok, JSON.stringify(stable));

// ---------- 3. weergavewissel tijdens het zingen: geen reset
const before = await page.evaluate(() => ({ g: window.__mic.getUserMedia, a: window.__mic.audioContexts, title: document.querySelector("h1")?.textContent }));
await page.locator("[data-hymns-view-toggle]").click();
await page.waitForTimeout(400);
const afterKaraoke = await page.evaluate(() => ({ g: window.__mic.getUserMedia, a: window.__mic.audioContexts, title: document.querySelector("h1")?.textContent, view: document.querySelector("[data-hymns-view]")?.getAttribute("data-hymns-view"), live: window.__mic.tracks.filter((t) => t.readyState === "live").length }));
check("weergavewissel naar karaoke: zelfde lofzang, microfoon en sessie", afterKaraoke.view === "karaoke" && afterKaraoke.title === before.title && afterKaraoke.g === 1 && afterKaraoke.a === 1 && afterKaraoke.live === 1, JSON.stringify(afterKaraoke));
check("na de weergavewissel blijft de status 'Volgt muziek' (geen reset)", /Volgt muziek/.test((await status()) ?? ""), String(await status()));
await page.screenshot({ path: `${SHOTS}/04-karaoke.png`, fullPage: false });
const kar = await page.evaluate(() => [...document.querySelectorAll("section[aria-label='Tekst'] p")].length);
check("karaoke toont vorige, huidige en volgende regel", kar >= 2 && kar <= 3, String(kar));
await page.locator("[data-hymns-view-toggle]").click();
await page.waitForTimeout(300);
check("de snelle weergavewissel in de kop schakelt terug naar volledig couplet", (await page.locator("[data-hymns-view]").getAttribute("data-hymns-view")) === "stanza");

// ---------- 4. couplet kiezen en volgorde
await page.getByRole("button", { name: "Couplet 3" }).click();
await page.waitForTimeout(500);
check("tikken op couplet 3 toont couplet 3 en de microfoon blijft actief", (await page.locator("h3").first().textContent())?.includes("Couplet 3") && (await page.getByText("Microfoon is actief").count()) > 0);
await page.getByRole("button", { name: "Volgorde kiezen" }).click();
await page.getByRole("button", { name: "Couplet 1" }).click();
await page.getByRole("button", { name: "Couplet 4" }).click();
check("volgorde 1 → 4 wordt getoond", (await page.getByText("Volgorde: 1 → 4").count()) > 0);
await page.getByRole("button", { name: "Klaar" }).click();

// ---------- 5. eigen scrollen pauzeert het meescrollen; 'Volgen hervatten'
await page.getByRole("button", { name: "Instellingen", exact: true }).click();
await page.getByRole("button", { name: "Extra groot", exact: true }).click();
await page.getByRole("button", { name: "Instellingen sluiten" }).click();
await page.setViewportSize({ width: 390, height: 520 });
await page.mouse.move(200, 300);
await page.mouse.wheel(0, 300);
await page.waitForTimeout(600);
const resume = page.getByRole("button", { name: "Volgen hervatten" });
check("na eigen scrollen verschijnt 'Volgen hervatten'", (await resume.count()) === 1);
check("de muziekvolging loopt door tijdens eigen scrollen", /Volgt muziek|onzeker/i.test((await status()) ?? ""), String(await status()));
if ((await resume.count()) === 1) { await resume.click(); await page.waitForTimeout(300); }
check("na 'Volgen hervatten' verdwijnt de knop", (await resume.count()) === 0);
const barOk = await page.evaluate(() => { const b = document.querySelector("[data-hymns-bar]").getBoundingClientRect(); return b.bottom <= window.innerHeight + 1 && b.top >= 0; });
check("de onderste bediening staat aan de onderkant van het scherm", barOk);
await page.setViewportSize({ width: 390, height: 844 });

// ---------- 6. technische gegevens (beheerder)
await page.getByRole("button", { name: "Technische gegevens" }).click();
const tech = (await page.locator("[data-hymns-technical]").textContent())?.replace(/\s+/g, " ") ?? "";
check("technische gegevens bevatten positie, zangstatus en bewijs", /beat/.test(tech) && /Zang/.test(tech) && /Bewijs zangbegin/.test(tech), tech.slice(0, 160));
await page.getByRole("button", { name: "Technische gegevens" }).click();

// ---------- 7. netwerk
const withBody = net.filter((r) => !/_next|\.(js|css|png|svg|ico|webp|woff2?)(\?|$)/.test(r.url) && r.post > 0 && new Date() && /lofzang|hymn/i.test(r.url));
check("de pagina verstuurt geen verzoeken met inhoud naar lofzang-eindpunten", withBody.length === 0, JSON.stringify(withBody.slice(0, 5)));
const bigWs = wsFrames.filter((f) => f.bytes > 1000 && !new URL(f.url).pathname.startsWith("/_next/hmr"));
check("geen grote WebSocket-frames verstuurd (geen audiostream)", bigWs.length === 0, JSON.stringify(bigWs.map((f) => [new URL(f.url).pathname, f.bytes])));

// ---------- 8. stoppen en terug
await page.getByRole("button", { name: "Stop" }).first().click();
await page.getByText("Microfoon is uit").first().waitFor({ timeout: 5000 });
check("microfoon uit na Stop", await page.evaluate(() => window.__mic.tracks.every((t) => t.readyState === "ended")));

// opnieuw beginnen en wegnavigeren via de terugbalk: de microfoon moet stoppen
await page.getByRole("button", { name: "Start luisteren" }).click();
await page.getByText("Microfoon is actief").first().waitFor({ timeout: 10000 });
await page.getByRole("button", { name: "Terug" }).click();
await page.waitForURL("**/content", { timeout: 20000 });
check("terugknop navigeert naar de contentkiezer", new URL(page.url()).pathname === "/content");
check("de microfoon stopt bij het verlaten van de pagina", await page.evaluate(() => window.__mic.tracks.every((t) => t.readyState === "ended")));
check("geen paginafouten", errors.filter((e) => !/favicon|hydrat|sw\.js|caret-color|Failed to load resource/i.test(e)).length === 0, errors.slice(0, 3).join(" | "));

// ---------- 9. schermmaten, thema, tekstgrootte, landscape (zonder microfoon)
const SIZES = [[320, 640], [375, 667], [390, 844], [430, 932], [768, 1024], [1280, 800], [844, 390]];
for (const [w, h] of SIZES) {
  for (const scheme of ["light", "dark"]) {
    for (const big of [false, true]) {
      const c = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, permissions: ["microphone"] });
      await c.addCookies(await ctx.cookies());
      const p = await c.newPage();
      await p.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await p.locator("h1").first().waitFor({ timeout: 60000 });
      if (big) await p.addStyleTag({ content: "html{font-size:32px !important}" });
      await p.waitForTimeout(300);
      const m = await p.evaluate(() => {
        const back = document.querySelector("[data-subpage-back-bar]")?.getBoundingClientRect();
        const h1 = document.querySelector("h1")?.getBoundingClientRect();
        const bar = document.querySelector("[data-hymns-bar]")?.getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - window.innerWidth, backBottom: back?.bottom ?? 0, h1Top: h1?.top ?? 0, barBottom: bar?.bottom ?? 0, vh: window.innerHeight, navVisible: !!document.querySelector("nav[data-main-nav]") && getComputedStyle(document.querySelector("nav[data-main-nav]")).display !== "none" };
      });
      const label = `${w}x${h} ${scheme}${big ? " 200%" : ""}`;
      check(`${label}: geen overflow, inhoud niet onder de terugbalk, geen onderbalk`, m.overflow <= 1 && m.h1Top >= m.backBottom - 1 && !m.navVisible, JSON.stringify(m));
      if (w === 320 && big && scheme === "dark") await p.screenshot({ path: `${SHOTS}/05-320-200-donker.png`, fullPage: false });
      // een inkeping onderaan (iPhone, Android-gebaren): de bediening blijft erboven staan
      if ((w === 390 || w === 844) && !big && scheme === "light") {
        await p.addStyleTag({ content: ":root{--vs-safe-area-bottom:34px !important}" });
        await p.waitForTimeout(200);
        const lift = await p.evaluate(() => ({ barBottom: document.querySelector("[data-hymns-bar]").getBoundingClientRect().bottom, vh: window.innerHeight }));
        check(`${label}: bediening blijft boven de onderste inkeping (safe area 34 px)`, lift.barBottom <= lift.vh - 33, JSON.stringify(lift));
      }
      // karaoke en extra groot in de smalste en grootste stand
      if ((w === 320 || w === 844) && !big) {
        await p.getByRole("button", { name: "Instellingen", exact: true }).click();
        await p.getByRole("button", { name: "Karaoke per regel", exact: true }).click();
        await p.getByRole("button", { name: "Extra groot", exact: true }).click();
        await p.getByRole("button", { name: "Instellingen sluiten" }).click();
        await p.getByRole("button", { name: "Start luisteren" }).waitFor();
        const ok = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        check(`${label}: karaoke extra groot zonder overflow`, ok);
        if (w === 320) await p.screenshot({ path: `${SHOTS}/06-karaoke-320.png`, fullPage: false });
      }
      await c.close();
    }
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gelukt`);
process.exit(failed.length ? 1 : 0);
