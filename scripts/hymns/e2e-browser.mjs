// Browsertest van Lofzangen met de nep-microfoon van Chromium (een WAV-bestand dient als microfoon).
// Vereist een draaiende productie-app en Playwright (niet in package.json):
//   npx tsx scripts/hymns/make-service-audio.ts 82 /tmp/dienst82.wav heel-pauze 2
//   PLAYWRIGHT_MODULE=/pad/naar/playwright CHROMIUM_PATH=/pad/naar/chrome WAV=/tmp/dienst82.wav HYMN=82 \
//     PROMOTE_DB_URL=postgresql://... AUDIT_BASE_URL=http://localhost:3100 SHOTS_DIR=/tmp/shots \
//     node scripts/hymns/e2e-browser.mjs [--quick]
// Maakt zelf een testaccount aan; PROMOTE_DB_URL (wegwerpdatabase) maakt dat account beheerder, want Lofzangen
// is in productie alleen voor beheerders. Dit is Chromium met viewport-emulatie en gesimuleerde safe areas:
// GEEN bewijs voor iPhone-Safari of een WKWebView. Screenshots komen in SHOTS_DIR.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";
const WAV = process.env.WAV ?? "/tmp/dienst82.wav";
const HYMN = process.env.HYMN ?? "82";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const QUICK = process.argv.includes("--quick");
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
const mic = (p = page) => p.evaluate(() => ({ g: window.__mic.getUserMedia, a: window.__mic.audioContexts, live: window.__mic.tracks.filter((t) => t.readyState === "live").length }));
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const bar = (name) => ({ name, exact: true });

// ---------- 1. openen vanuit de contentkiezer; scherm A (lofzang kiezen)
await page.goto(`${BASE}/content`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.locator("[data-admin-hymns-link]").waitFor({ timeout: 120000 });
await page.locator("[data-admin-hymns-link]").click();
await page.waitForURL("**/dev/lofzangen", { timeout: 60000 });
await page.locator("h1").first().waitFor({ timeout: 60000 });
const shell = await page.evaluate(() => {
  const vis = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
  return {
    mode: document.querySelector("[data-shell-mode]")?.getAttribute("data-shell-mode"),
    header: vis(document.querySelector("[data-app-global-header]")),
    nav: vis(document.querySelector("nav[data-main-nav]")),
    back: vis(document.querySelector("[data-subpage-back-bar]")),
    backText: document.querySelector("[data-subpage-back-bar]")?.textContent?.trim(),
    h1: [...document.querySelectorAll("h1")].map((h) => h.textContent?.trim()),
    privacyVisible: /Er wordt niets verzonden/.test(document.body.innerText),
    introVisible: /De telefoon luistert naar het orgel/.test(document.body.innerText),
    docScroll: document.documentElement.scrollHeight - window.innerHeight,
  };
});
check("focus mode: globale header en onderbalk weg, terugbalk blijft", shell.mode === "focus" && !shell.header && !shell.nav && shell.back, JSON.stringify(shell));
check("geen dubbele titel: terugbalk 'Lofzangen', pagina 'Kies een lofzang'", /Lofzangen/.test(shell.backText ?? "") && shell.h1.length === 1 && shell.h1[0] === "Kies een lofzang", JSON.stringify(shell.h1));
check("beginscherm: geen lange introductie en geen privacyblok", !shell.privacyVisible && !shell.introVisible);
check("beginscherm: het document scrolt niet", shell.docScroll <= 1, String(shell.docScroll));
await page.locator("[data-hymn-number]").first().waitFor({ timeout: 60000 });
check("beginscherm: de volledige bibliotheek van 205 lofzangen is selecteerbaar", (await page.locator("[data-hymn-number]").count()) === 205, String(await page.locator("[data-hymn-number]").count()));
check("beginscherm: alleen nummer en titel in de lijst (geen technische labels)", await page.evaluate(() => ![...document.querySelectorAll("[data-hymn-number]")].some((b) => /gevalideerd|bladmuziek|herkenning|woordvolging|onzeker/i.test(b.textContent ?? ""))));
check("beginscherm: 'Herken lofzang' is beschikbaar", (await page.getByRole("button", bar("Herken lofzang")).count()) === 1);
// zoeken: nummer, titel, deel van de titel; geen verzoek per toetsaanslag
const netBeforeSearch = net.length;
const search = page.locator("[data-hymns-search]");
await search.fill("24");
check("zoeken op nummer: 24 staat bovenaan", (await page.locator("[data-hymn-number]").first().getAttribute("data-hymn-number")) === "24");
await search.fill("ere de man");
check("zoeken op titel: Ere de man (lofzang 24)", (await page.locator("[data-hymn-number]").first().getAttribute("data-hymn-number")) === "24");
await search.fill("kom volg");
check("zoeken op een deel van de titel", (await page.locator("[data-hymn-number]").count()) >= 1);
await search.fill("zzzzqq");
check("zoeken zonder resultaat toont een nette melding", (await page.locator("[data-hymns-no-results]").count()) === 1);
check("zoeken veroorzaakt geen verzoeken naar de server", net.length === netBeforeSearch, String(net.length - netBeforeSearch));
await search.fill("");
// lofzang zonder tekst (licentie) en zonder bladmuziek
await page.locator('[data-hymn-number="54"]').click();
await page.locator("[data-hymns-license]").waitFor({ timeout: 20000 });
check("lofzang 54: nette melding dat de tekst niet beschikbaar is (rechtenbeperking)", /rechtenbeperkingen/.test((await page.locator("[data-hymns-license]").textContent()) ?? ""));
check("lofzang 54: geen luisterknop", (await page.getByRole("button", bar("Start luisteren")).count()) === 0);
await page.getByRole("button", bar("Andere lofzang")).click();
await page.locator('[data-hymn-number="86"]').click();
await page.locator("[data-hymns-text-only]").waitFor({ timeout: 20000 });
check("lofzang 86: volledig leesbaar zonder bladmuziek", (await page.locator("[data-hymns-scroll] p").count()) >= 8 && (await page.getByRole("button", bar("Start luisteren")).count()) === 0);
await page.screenshot({ path: `${SHOTS}/01b-alleen-tekst.png` });
await page.getByRole("button", bar("Andere lofzang")).click();
await page.locator('[data-hymn-number="82"]').click();
await page.getByRole("button", bar("Start luisteren")).waitFor({ timeout: 20000 });
check("lofzang 82 geopend: 'Start luisteren' en 'Andere lofzang'", (await page.getByRole("button", bar("Start luisteren")).count()) === 1 && (await page.getByRole("button", bar("Andere lofzang")).count()) === 1);
await page.getByRole("button", bar("Andere lofzang")).click();
await page.locator("[data-hymn-number]").first().waitFor({ timeout: 20000 });
check("technische gegevens zijn standaard niet zichtbaar", (await page.locator("[data-hymns-technical]").count()) === 0);
await page.screenshot({ path: `${SHOTS}/01-kiezen.png` });
await page.getByRole("button", { name: "Privacy", exact: true }).click();
check("privacy-uitleg is compact en uitklapbaar in het instellingenpaneel (standaard dicht)", (await page.locator("dialog[open] details[data-hymns-privacy]").count()) === 1 && (await page.locator("dialog[open] details[data-hymns-privacy][open]").count()) === 0);
await page.locator("dialog[open] details[data-hymns-privacy] summary").click();
check("privacy-uitleg klapt open en bevat de uitleg over lokaal verwerken", (await page.locator("dialog[open]").getByText("Er wordt niets verzonden").isVisible()));
await page.getByRole("button", { name: "Sluiten", exact: true }).click();
check("het paneel sluit met de sluitknop", (await page.locator("dialog[open]").count()) === 0);

// ---------- 2. herkennen en automatisch volgen in één sessie
await page.getByRole("button", bar("Herken lofzang")).click();
await page.getByText("Microfoon is actief").first().waitFor({ timeout: 10000 });
await page.locator("[data-hymns-recognition]").waitFor({ timeout: 20000 });
const rtext = (await page.locator("[data-hymns-recognition-status]").textContent())?.trim();
check("tijdens het herkennen: één rustige status 'Luistert naar muziek' en de uitleg", rtext === "Luistert naar muziek" && /Versado probeert de lofzang te herkennen/.test((await page.locator("[data-hymns-recognition]").textContent()) ?? ""), String(rtext));
check("tijdens het herkennen: geen percentage en geen dubbele 'Luisteren…'", !/%/.test((await page.locator("[data-hymns-recognition]").textContent()) ?? "") && (await page.getByText(/Luistert…|Luisteren…/).count()) === 0);
const prelude = await waitStatus(/Voorspel|Volgt muziek|Handmatig/, 60000);
check("de lofzang wordt automatisch herkend en gevolgd", !!prelude, String(prelude));
check("de titel toont nummer en naam van de herkende lofzang", (await page.locator("h1").first().textContent())?.startsWith(`${HYMN}.`), await page.locator("h1").first().textContent());
const c1 = await mic();
check("herkennen en volgen delen één microfoonsessie (1x getUserMedia, 1x AudioContext)", c1.g === 1 && c1.a === 1 && c1.live === 1, JSON.stringify(c1));
if (/Voorspel/.test(prelude ?? "")) {
  check("tijdens het voorspel is er geen actief woord of regel en staat de tekst klaar", (await page.locator('p[aria-current="true"]').count()) === 0 && (await page.locator("[data-hymns-scroll] p").count()) >= 4);
  check("tijdens het voorspel is 'Zang begint' beschikbaar", (await page.getByRole("button", { name: "Zang begint", exact: true }).count()) === 1);
  await page.screenshot({ path: `${SHOTS}/02-voorspel.png` });
}
const sing = await waitStatus(/Volgt muziek|Handmatig/, 60000);
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
check("het actieve woord: accentkleur, geen achtergrond, zwaarder", accent.count === 1 && accent.color === accent.accentColor && /rgba\(0, 0, 0, 0\)|transparent/.test(accent.background) && Number(accent.weight) >= 700, JSON.stringify(accent));
await page.screenshot({ path: `${SHOTS}/03-zingen.png` });
const bottomBar = await page.evaluate(() => [...document.querySelectorAll("[data-hymns-bar] button")].map((b) => b.textContent?.trim()));
check("tijdens het zingen: alleen 'Opnieuw synchroniseren' en 'Stop' in de bediening", JSON.stringify(bottomBar) === JSON.stringify(["Opnieuw synchroniseren", "Stop"]), JSON.stringify(bottomBar));

// fase-bewijs vóór de UI-wijzigingen: de technische gegevens (standaard dicht) melden dat het zingen begonnen is
const tech = async () => {
  await page.locator("[data-hymns-settings]").click();
  await page.locator("[data-hymns-technical-open]").click();
  const text = (await page.locator("[data-hymns-technical]").textContent())?.replace(/\s+/g, " ") ?? "";
  await page.getByRole("button", { name: "Sluiten", exact: true }).click();
  return text;
};
const t0 = await tech();
check("technische gegevens (beheerder): positie, zangstatus en bewijs", /beat/.test(t0) && /Zangbegonnen/.test(t0) && /Bewijs zangbegin/.test(t0), t0.slice(0, 200));

// ---------- 3. UI-wijzigingen tijdens het luisteren herstarten de engine niet
const beat = (text) => Number(/beat ([\d.]+)/.exec(text)?.[1] ?? NaN);
await page.locator("[data-hymns-settings]").click();
check("instellingen openen als paneel: de zangtekst blijft staan", (await page.locator("dialog[open]").count()) === 1 && (await page.locator("[data-hymns-scroll] p").count()) >= 4);
await page.getByRole("button", { name: "Karaoke per regel", exact: true }).click();
await page.getByRole("button", { name: "Groot", exact: true }).click();
await page.getByRole("button", { name: "Extra groot", exact: true }).click();
await page.getByRole("button", { name: "Normaal", exact: true }).click();
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Escape sluit het instellingenpaneel", (await page.locator("dialog[open]").count()) === 0);
const c2 = await mic();
const t1 = await tech();
check("instellingen, weergave en tekstgrootte: dezelfde microfoonsessie", c2.g === 1 && c2.a === 1 && c2.live === 1, JSON.stringify(c2));
check("instellingen, weergave en tekstgrootte: het zingen blijft 'begonnen' en de lofzang blijft staan", /Zangbegonnen/.test(t1) && (await page.locator("h1").first().textContent())?.startsWith(`${HYMN}.`));
check("de muzikale positie loopt door (geen reset)", Number.isFinite(beat(t1)) && Number.isFinite(beat(t0)) && (beat(t1) !== beat(t0)), `${beat(t0)} -> ${beat(t1)}`);
check("de status blijft 'Volgt muziek'", /Volgt muziek|Handmatig/.test((await status()) ?? ""), String(await status()));
await page.screenshot({ path: `${SHOTS}/04-karaoke.png` });
await page.locator("[data-hymns-view-toggle]").click();
check("de snelle weergavewissel in de kop schakelt terug naar volledig couplet", (await page.locator("[data-hymns-view]").getAttribute("data-hymns-view")) === "stanza");

// couplet en volgorde
await page.getByRole("button", { name: "Couplet 3", exact: true }).click();
await page.waitForTimeout(400);
check("tikken op couplet 3 toont couplet 3 en de microfoon blijft actief", (await page.locator("[data-hymns-scroll] h3").first().textContent())?.includes("Couplet 3") && (await page.getByText("Microfoon is actief").count()) > 0);
await page.locator("[data-hymns-order]").click();
await page.locator("dialog[open]").getByRole("button", { name: "1", exact: true }).click();
await page.locator("dialog[open]").getByRole("button", { name: "4", exact: true }).click();
check("volgorde 1 → 4 wordt getoond in het coupletpaneel", (await page.locator("dialog[open]").getByText("Volgorde: 1 → 4").count()) === 1);
await page.locator("dialog[open]").getByRole("button", { name: "Klaar", exact: true }).click();
check("de gekozen volgorde staat subtiel bij de coupletten (1 → 4)", (await page.locator("[data-hymns-order-label]").textContent())?.trim() === "1 → 4");

// ---------- 4. eigen scrollen pauzeert het meescrollen en raakt de engine niet
await page.setViewportSize({ width: 390, height: 520 });
await page.locator("[data-hymns-settings]").click();
await page.getByRole("button", { name: "Extra groot", exact: true }).click();
await page.getByRole("button", { name: "Sluiten", exact: true }).click();
await page.mouse.move(200, 300);
await page.mouse.wheel(0, 300);
await page.waitForTimeout(600);
const resume = page.getByRole("button", { name: "Automatisch volgen hervatten", exact: true });
check("na eigen scrollen verschijnt 'Zelf bladeren' met 'Automatisch volgen hervatten'", (await resume.count()) === 1);
check("het document zelf scrolt niet (alleen de leesruimte)", await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1 && window.scrollY === 0));
check("de muziekvolging loopt door tijdens eigen scrollen", /Volgt muziek|Handmatig|onzeker/i.test((await status()) ?? ""), String(await status()));
if ((await resume.count()) === 1) { await resume.click(); await page.waitForTimeout(300); }
check("na 'Automatisch volgen hervatten' sluit de tekst weer aan, of er komt een melding dat de synchronisatie nog onzeker is", (await resume.count()) === 0 || (await page.locator("[data-hymns-resume-note]").count()) === 1);
check("scrollen veroorzaakte geen nieuwe microfoonsessie", (await mic()).g === 1);
await page.setViewportSize({ width: 390, height: 844 });

// ---------- 5. netwerk
const bigWs = wsFrames.filter((f) => f.bytes > 1000 && !new URL(f.url).pathname.startsWith("/_next/hmr"));
check("geen grote WebSocket-frames verstuurd (geen audiostream)", bigWs.length === 0, JSON.stringify(bigWs.map((f) => [new URL(f.url).pathname, f.bytes])));
check("geen verzoeken met inhoud naar lofzang-eindpunten", net.filter((r) => r.post > 0 && /lofzang|hymn/i.test(r.url)).length === 0);

// ---------- 6. stoppen en terug navigeren tijdens het luisteren
await page.getByRole("button", { name: "Stop", exact: true }).click();
await page.getByText("Microfoon is uit").first().waitFor({ timeout: 5000 });
check("microfoon uit na Stop", await page.evaluate(() => window.__mic.tracks.every((t) => t.readyState === "ended")));
check("na Stop: 'Start luisteren' en 'Andere lofzang' in de bediening", (await page.getByRole("button", bar("Start luisteren")).count()) === 1 && (await page.getByRole("button", bar("Andere lofzang")).count()) === 1);
await page.getByRole("button", bar("Start luisteren")).click();
await page.getByText("Microfoon is actief").first().waitFor({ timeout: 10000 });
await page.getByRole("button", { name: "Terug" }).click();
await page.waitForURL("**/content", { timeout: 20000 });
check("terugknop navigeert tijdens het luisteren naar de contentkiezer", new URL(page.url()).pathname === "/content");
check("de microfoon stopt bij het verlaten van de pagina", await page.evaluate(() => window.__mic.tracks.every((t) => t.readyState === "ended")));
check("geen paginafouten", errors.filter((e) => !/favicon|hydrat|sw\.js|caret-color|Failed to load resource/i.test(e)).length === 0, errors.slice(0, 3).join(" | "));

// ---------- 7. schermmaten, thema, tekstschaal, landscape en gesimuleerde safe areas
// (de microfoon draait met de nep-opname; de controles zijn lay-outmetingen)
const ONLY = process.env.ONLY_SIZES?.split(",") ?? null;
const SIZES0 = QUICK
  ? [[320, 700, "p"], [390, 844, "p"], [844, 390, "l"]]
  : [[320, 700, "p"], [375, 812, "p"], [390, 844, "p"], [430, 932, "p"], [768, 1024, "p"], [1280, 800, "d"], [844, 390, "l"]];
const SIZES = ONLY ? SIZES0.filter(([w, h]) => ONLY.includes(`${w}x${h}`)) : SIZES0;
const SAFE = { p: { t: 47, b: 34, l: 0, r: 0 }, l: { t: 0, b: 21, l: 47, r: 47 }, d: { t: 0, b: 0, l: 0, r: 0 } };

async function layoutChecks(p, label) {
  // klikken scrolt de werkruimte soms naar de bediening; de metingen beginnen bovenaan
  await p.evaluate(() => { document.querySelector(".hymns-workspace").scrollTop = 0; });
  const m = await p.evaluate(() => {
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const back = r(document.querySelector("[data-subpage-back-bar]"));
    const h1 = r(document.querySelector("h1"));
    const region = r(document.querySelector("[data-hymns-scroll]"));
    const barEl = document.querySelector("[data-hymns-bar]");
    const barR = r(barEl);
    const scroller = document.querySelector("[data-hymns-scroll]");
    const chips = [...document.querySelectorAll("[data-hymns-view] button[aria-label^='Couplet ']")].map((b) => r(b));
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      docScroll: document.documentElement.scrollHeight - window.innerHeight,
      backBottom: back?.bottom ?? 0, h1Top: h1?.top ?? 0,
      regionTop: region?.top ?? 0, regionBottom: region?.bottom ?? 0,
      barTop: barR?.top ?? 0, barBottom: barR?.bottom ?? 0, barHeight: barR?.height ?? 0,
      scrollFits: scroller ? scroller.scrollHeight <= scroller.clientHeight + 1 : true,
      chipBottom: Math.max(0, ...chips.map((c) => c.bottom)), chipRight: Math.max(0, ...chips.map((c) => c.right)), chipLeft: Math.min(9999, ...chips.map((c) => c.left)),
      chipCount: chips.length,
      techHidden: document.querySelectorAll("[data-hymns-technical]").length === 0,
      navVisible: !!document.querySelector("nav[data-main-nav]") && getComputedStyle(document.querySelector("nav[data-main-nav]")).display !== "none",
    };
  });
  check(`${label}: geen horizontale overflow en het document scrolt niet`, m.overflowX <= 1 && m.docScroll <= 1, `x=${m.overflowX} y=${m.docScroll}`);
  check(`${label}: kop onder de terugbalk, geen onderbalk`, m.h1Top >= m.backBottom - 1 && !m.navVisible, `h1 ${m.h1Top} terugbalk ${m.backBottom}`);
  check(`${label}: leesruimte en bediening overlappen niet (tekst nooit achter de balk)`, m.regionBottom <= m.barTop + 1 && m.regionTop >= m.backBottom - 1, `leesruimte ${m.regionTop}-${m.regionBottom}, bar ${m.barTop}`);
  check(`${label}: coupletknoppen binnen het scherm en boven de bediening`, m.chipCount > 0 && m.chipBottom <= m.regionTop + 1 && m.chipLeft >= 0 && m.chipRight <= m.vw, JSON.stringify({ n: m.chipCount, b: m.chipBottom, rt: m.regionTop, l: m.chipLeft, r: m.chipRight }));
  // Zeer grote tekst op een klein scherm: de werkruimte scrolt zelf; de bediening is dan na scrollen onderaan bereikbaar.
  const reach = await p.evaluate(() => {
    const ws = document.querySelector(".hymns-workspace");
    const scrolls = ws.scrollHeight > ws.clientHeight + 1;
    ws.scrollTop = ws.scrollHeight;
    const b = document.querySelector("[data-hymns-bar]").getBoundingClientRect();
    const out = { scrolls, barBottom: b.bottom, vh: window.innerHeight, doc: document.documentElement.scrollHeight - window.innerHeight };
    ws.scrollTop = 0;
    return out;
  });
  check(`${label}: bediening onderaan het scherm${reach.scrolls ? " (werkruimte scrolt: zeer grote tekst op klein scherm)" : ""}`, reach.barBottom <= reach.vh + 0.5 && reach.vh - reach.barBottom <= SAFE_BOTTOM + 20 && reach.doc <= 1, JSON.stringify(reach));
  check(`${label}: technische gegevens standaard verborgen`, m.techHidden);
  return m;
}
let SAFE_BOTTOM = 0;

for (const [w, h, kind] of SIZES) {
  for (const scheme of ["light", "dark"]) {
    for (const big of [false, true]) {
      for (const view of ["stanza", "karaoke"]) {
        if (QUICK && (scheme === "dark" || (big && view === "karaoke"))) continue;
        const c = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, permissions: ["microphone"] });
        await c.addCookies(await ctx.cookies());
        await c.addInitScript(INSTRUMENT);
        await c.addInitScript((v) => localStorage.setItem("versado:hymns:prefs:v1", JSON.stringify({ view: v, size: "normal", autoScroll: true, calm: false })), view);
        const p = await c.newPage();
        const s = SAFE[kind];
        SAFE_BOTTOM = s.b;
        await p.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded", timeout: 120000 });
        await p.locator("h1").first().waitFor({ timeout: 60000 });
        await p.addStyleTag({ content: `:root{--vs-safe-area-top:${s.t}px !important;--vs-safe-area-bottom:${s.b}px !important;--vs-safe-area-left:${s.l}px !important;--vs-safe-area-right:${s.r}px !important}${big ? "html{font-size:32px !important}" : ""}` });
        await p.waitForTimeout(300);
        const label = `${w}x${h} ${scheme}${big ? " 200%" : ""} ${view}`;
        // kiesscherm
        await p.locator("[data-hymn-number]").first().waitFor({ timeout: 60000 });
        const chooseOk = await p.evaluate(() => ({ x: document.documentElement.scrollWidth - window.innerWidth, y: document.documentElement.scrollHeight - window.innerHeight }));
        check(`${label}: kiesscherm zonder overflow`, chooseOk.x <= 1 && chooseOk.y <= 1, JSON.stringify(chooseOk));
        await p.locator('[data-hymn-number="82"]').click(); // lofzang 82: zes coupletten, de moeilijkste indeling
        await p.getByRole("button", bar("Start luisteren")).click();
        await p.getByText("Microfoon is actief").first().waitFor({ timeout: 15000 });
        await p.waitForTimeout(500);
        const m = await layoutChecks(p, label);
        // laatste regel bereikbaar
        const last = await p.evaluate(() => {
          const sc = document.querySelector("[data-hymns-scroll]");
          sc.scrollTop = sc.scrollHeight;
          const lines = [...sc.querySelectorAll("p")];
          const l = lines[lines.length - 1]?.getBoundingClientRect();
          const c = sc.getBoundingClientRect();
          return l ? { bottom: l.bottom, cb: c.bottom, top: l.top, ct: c.top } : null;
        });
        check(`${label}: de laatste regel is bereikbaar`, !!last && last.bottom <= last.cb + 1 && last.bottom >= last.ct, JSON.stringify(last));
        // bediening blijft staan na scrollen
        const barAfter = await p.evaluate(() => document.querySelector("[data-hymns-bar]").getBoundingClientRect().top);
        check(`${label}: bediening blijft op dezelfde plek na scrollen`, Math.abs(barAfter - m.barTop) <= 1, `${m.barTop} -> ${barAfter}`);
        await p.evaluate(() => { document.querySelector("[data-hymns-scroll]").scrollTop = 0; });
        // karaoke: actieve regel gecentreerd in de leesruimte
        if (view === "karaoke" && m.scrollFits) {
          const cen = await p.evaluate(() => {
            const cur = document.querySelector("[data-hymns-karaoke-current] p")?.getBoundingClientRect();
            const reg = document.querySelector("[data-hymns-scroll]").getBoundingClientRect();
            return cur ? { dy: (cur.top + cur.bottom) / 2 - (reg.top + reg.bottom) / 2 } : null;
          });
          check(`${label}: karaoke centreert de actieve regel in de leesruimte`, !!cen && Math.abs(cen.dy) <= 3, JSON.stringify(cen));
        }
        // instellingenpaneel volledig bedienbaar
        await p.locator("[data-hymns-settings]").click();
        const sh = await p.evaluate(() => {
          const d = document.querySelector("dialog[open]");
          const r = d.getBoundingClientRect();
          const body = d.querySelector("div.overflow-y-auto");
          body.scrollTop = body.scrollHeight;
          const lastBtn = [...d.querySelectorAll("button")].pop().getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: window.innerWidth, vh: window.innerHeight, xo: d.scrollWidth - d.clientWidth, lastBottom: lastBtn.bottom, lastTop: lastBtn.top };
        });
        check(`${label}: instellingenpaneel binnen het scherm, zonder overflow, laatste knop bereikbaar`, sh.top >= 0 && sh.bottom <= sh.vh + 1 && sh.left >= 0 && sh.right <= sh.vw + 1 && sh.xo <= 1 && sh.lastBottom <= sh.bottom + 1 && sh.lastTop >= sh.top, JSON.stringify(sh));
        if (w === 390 && !big && view === "stanza" && scheme === "light") await p.screenshot({ path: `${SHOTS}/05-instellingen-390.png` });
        await p.getByRole("button", { name: "Sluiten", exact: true }).click();
        // viewporthoogte verandert (Safari-balken): alles blijft op zijn plek
        if (kind === "p" && w === 390 && !big && view === "stanza" && scheme === "light") {
          await p.setViewportSize({ width: w, height: h - 90 });
          await p.waitForTimeout(250);
          const after = await p.evaluate(() => ({ vh: window.innerHeight, barBottom: document.querySelector("[data-hymns-bar]").getBoundingClientRect().bottom, docY: document.documentElement.scrollHeight - window.innerHeight, regionBottom: document.querySelector("[data-hymns-scroll]").getBoundingClientRect().bottom, barTop: document.querySelector("[data-hymns-bar]").getBoundingClientRect().top }));
          check(`${label}: na kleinere viewporthoogte (adresbalk) blijft de bediening onderaan en overlapt niets`, after.barBottom <= after.vh + 0.5 && after.vh - after.barBottom <= SAFE_BOTTOM + 14 && after.docY <= 1 && after.regionBottom <= after.barTop + 1, JSON.stringify(after));
          await p.setViewportSize({ width: w, height: h });
        }
        if (!big && scheme === "light" && (w === 320 || w === 390 || kind === "l")) await p.screenshot({ path: `${SHOTS}/06-${w}x${h}-${view}.png` });
        if (big && scheme === "dark" && w === 320) await p.screenshot({ path: `${SHOTS}/07-${w}x${h}-200-donker-${view}.png` });
        // technische gegevens: een eigen paneel, ook dat blijft binnen het scherm
        if (w === 390 && !big && view === "stanza" && scheme === "dark") {
          await p.locator("[data-hymns-settings]").click();
          await p.locator("[data-hymns-technical-open]").click();
          const tp = await p.evaluate(() => { const r = document.querySelector("dialog[open]").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: window.innerHeight, xo: document.querySelector("dialog[open]").scrollWidth - document.querySelector("dialog[open]").clientWidth }; });
          check(`${label}: technisch paneel binnen het scherm`, tp.top >= 0 && tp.bottom <= tp.vh + 1 && tp.xo <= 1, JSON.stringify(tp));
          await p.getByRole("button", { name: "Sluiten", exact: true }).click();
        }
        await c.close();
      }
    }
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gelukt`);
process.exit(failed.length ? 1 : 0);
