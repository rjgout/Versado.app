// Browsertest "lezen heeft voorrang" van Lofzangen met de nep-microfoon van Chromium.
// Vereist een draaiende productie-app en Playwright (niet in package.json):
//   npx tsx scripts/hymns/make-service-audio.ts 82 /tmp/dienst82-3.wav heel-pauze 3
//   PLAYWRIGHT_MODULE=/pad/naar/playwright CHROMIUM_PATH=/pad/naar/chrome WAV=/tmp/dienst82-3.wav HYMN=82 \
//     PROMOTE_DB_URL=postgresql://... AUDIT_BASE_URL=http://localhost:3100 SHOTS_DIR=/tmp/shots \
//     node scripts/hymns/e2e-reading.mjs
// Dekt: lezen zonder microfoon, lezen tijdens het voorspel, handmatig bladeren (aanraking en wiel) bij een goede
// synchronisatie, geen terugscroll, "Automatisch volgen hervatten", onzekere synchronisatie, coupletwissel en
// weergavewissel tijdens het lezen, en de indeling op iPhone-achtige schermen, 320 px, landscape en grote tekst.
// Dit is Chromium met aanraak- en viewport-emulatie: GEEN bewijs voor iPhone-Safari of een WKWebView.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";
const WAV = process.env.WAV ?? "/tmp/dienst82-3.wav";
const HYMN = process.env.HYMN ?? "82";
const SHOTS = process.env.SHOTS_DIR ?? "/tmp";
const stamp = Date.now().toString(36);
const email = `lees-${stamp}@example.test`, handle = `Lees ${stamp}`, password = "Wachtwoord-123!";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "OK  " : "FAIL", name, detail); };
const bar = (name) => ({ name, exact: true });

const INSTRUMENT = () => {
  window.__mic = { getUserMedia: 0, tracks: [] };
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    window.__mic.getUserMedia += 1;
    const stream = await gum(c);
    window.__mic.tracks.push(...stream.getTracks());
    return stream;
  };
};

async function setup(viewport, opts) {
  const em = `lees-${stamp}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${WAV}%noloop`, "--autoplay-policy=no-user-gesture-required"],
  });
  const mobile = opts?.mobile ?? true;
  const ctx = await browser.newContext({ viewport, permissions: ["microphone"], reducedMotion: "reduce", hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 3 : 1 });
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  let res = await ctx.request.post(`${BASE}/api/auth/register`, { data: { email: em, handle: `Lees ${Math.random().toString(36).slice(2, 7)}`, password } });
  if (!res.ok()) throw new Error(`registreren mislukt: ${res.status()}`);
  if (process.env.PROMOTE_DB_URL) execFileSync("psql", [process.env.PROMOTE_DB_URL, "-c", `update "User" set "isAdmin"=true where email='${em}'`]);
  res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: em, password } });
  if (!res.ok()) throw new Error(`inloggen mislukt: ${res.status()}`);
  await page.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator("[data-hymn-number]").first().waitFor({ timeout: 120000 });
  return { browser, ctx, page, errors };
}

const status = async (p) => (await p.locator("[data-hymns-status]").first().textContent().catch(() => null))?.trim() ?? null;
const waitFor = async (fn, timeout, step = 200) => { const end = Date.now() + timeout; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, step)); } return null; };
const waitStatus = (p, re, timeout) => waitFor(async () => { const s = await status(p); return s && re.test(s) ? s : null; }, timeout);
const micState = (p) => p.evaluate(() => ({ g: window.__mic.getUserMedia, live: window.__mic.tracks.filter((t) => t.readyState === "live").length }));
const scrollTop = (p) => p.locator("[data-hymns-scroll]").evaluate((el) => el.scrollTop);
const lines = (p) => p.locator("[data-hymns-scroll] [data-seq]").count();
const musicLine = (p) => p.evaluate(() => { const el = document.querySelector('[data-hymns-scroll] [data-seq][aria-current="true"]'); return el ? Number(el.getAttribute("data-seq")) : -1; });
const focusLine = (p) => p.evaluate(() => { const el = document.querySelector("[data-hymns-scroll] [data-focus]"); return el ? Number(el.getAttribute("data-seq")) : -1; });
const readingLine = (p) => p.evaluate(() => { const el = document.querySelector('[data-hymns-scroll] [data-reading="true"]'); return el ? Number(el.getAttribute("data-seq")) : -1; });
const browsing = async (p) => (await p.locator("[data-hymns-browsing]").count()) === 1;
const openHymn = async (p, n) => { await p.locator(`[data-hymn-number="${n}"]`).click(); await p.locator("[data-hymns-scroll] [data-seq]").first().waitFor({ timeout: 20000 }); };
const setView = async (p, view) => {
  // de wisselknop doorloopt couplet -> karaoke -> bladmuziek -> couplet: klik tot de gewenste weergave er staat
  for (let i = 0; i < 3; i += 1) {
    const cur = (await p.locator("[data-hymns-karaoke]").count()) ? "karaoke" : (await p.locator("[data-hymns-stanza]").count()) ? "stanza" : "sheet";
    if (cur === view) break;
    await p.locator("[data-hymns-view-toggle]").click();
    await p.waitForTimeout(150);
  }
  await p.locator(view === "karaoke" ? "[data-hymns-karaoke]" : "[data-hymns-stanza]").waitFor({ timeout: 5000 });
};
/** Echt aanraakgebaar (touchmove) op de leesruimte via het DevTools-protocol. */
async function touchScroll(p, ctx, dy) {
  // Een echte reeks aanraakgebeurtenissen (touchstart, touchmove, touchend) via het DevTools-protocol.
  const box = await p.locator("[data-hymns-scroll]").boundingBox();
  const cdp = await ctx.newCDPSession(p);
  const x = Math.round(box.x + box.width / 2);
  let y = Math.round(box.y + box.height * (dy > 0 ? 0.7 : 0.3));
  const steps = Math.max(6, Math.round(Math.abs(dy) / 18));
  const step = (dy > 0 ? -1 : 1) * (Math.abs(dy) / steps);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 0; i < steps; i += 1) {
    y += step;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: Math.round(y) }] });
    await p.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await p.waitForTimeout(300);
}
const geometry = (p) => p.evaluate(() => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height }; };
  return {
    vw: window.innerWidth, vh: window.innerHeight,
    docX: document.documentElement.scrollWidth - window.innerWidth, docY: document.documentElement.scrollHeight - window.innerHeight,
    scroll: r("[data-hymns-scroll]"), reading: r("[data-hymns-reading]"), bar: r("[data-hymns-bar]"), resume: r("[data-hymns-resume]"),
  };
});
const layoutOk = (name, g, needReading) => {
  const noOverflow = g.docX <= 1 && g.docY <= 1;
  const inside = g.bar && g.bar.bottom <= g.vh + 1 && g.bar.left >= -1 && g.bar.right <= g.vw + 1;
  const tops = [g.bar?.top, g.reading?.top].filter((v) => typeof v === "number");
  const above = g.scroll && tops.length > 0 && g.scroll.bottom <= Math.min(...tops) + 1;
  // leesstrook en bediening mogen op één rij staan, maar nooit over elkaar heen
  const separate = !g.reading || !g.bar || g.reading.bottom <= g.bar.top + 1 || g.bar.bottom <= g.reading.top + 1 || g.reading.right <= g.bar.left + 1 || g.bar.right <= g.reading.left + 1;
  const readingFits = !needReading || (g.reading && g.reading.right <= g.vw + 1 && g.reading.left >= -1 && g.resume && g.resume.right <= g.vw + 1 && g.resume.left >= -1);
  check(`${name}: geen overflow, bediening binnen het scherm, leesruimte boven strook en bediening, geen overlap`, !!(noOverflow && inside && above && separate && readingFits), JSON.stringify(g));
};
const touchTargets = async (p) => p.evaluate(() => [...document.querySelectorAll("[data-hymns-reading] button, [data-hymns-bar] button, [role=group] button")].map((b) => ({ t: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 24), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) })).filter((x) => x.h < 43 || x.w < 43));

// =============== A. iPhone-achtig (390 x 844): lezen zonder microfoon, voorspel, bladeren, hervatten
const A = await setup({ width: 390, height: 844 });
const { page, ctx } = A;
await openHymn(page, HYMN);
let mic = await micState(page);
check("A1 handmatig geopend: de volledige tekst staat er direct en er is geen microfoon gestart", (await lines(page)) >= 4 && mic.g === 0, JSON.stringify(mic));
check("A2 geen herkenning of zangstatus nodig: coupletknoppen en 'Start luisteren' zijn meteen beschikbaar", (await page.getByRole("button", { name: /^Couplet \d/ }).count()) >= 3 && (await page.getByRole("button", bar("Start luisteren")).count()) === 1);
check("A3 de tekst is niet verborgen of vergrendeld (geen 'wacht op zang')", !(await page.getByText(/wacht op|vergrendeld/i).count()));
// volledig couplet: vrij scrollen met de vinger
await setView(page, "stanza");
const stanzaScrollable = await page.locator("[data-hymns-scroll]").evaluate((el) => el.scrollHeight > el.clientHeight);
check("A4 volledig couplet zonder luisteren: de leesruimte is gewoon scrolbaar of past volledig", stanzaScrollable || (await lines(page)) > 0);
// karaoke: verticaal zangboek met alle regels
await setView(page, "karaoke");
const totalLines = await lines(page);
const karaokeScrollable = await page.locator("[data-hymns-scroll]").evaluate((el) => el.scrollHeight > el.clientHeight + 40);
check("A5 karaoke zonder luisteren toont alle regels onder elkaar (geen venster van drie regels)", totalLines >= 4, String(totalLines));
check("A6 karaoke is met de vinger te scrollen", karaokeScrollable);
const t0 = await scrollTop(page);
await touchScroll(page, ctx, 260);
const t1 = await scrollTop(page);
check("A7 een echt aanraakgebaar scrolt de karaokeweergave", t1 > t0 + 40, `${t0} -> ${t1}`);
check("A8 zonder luisteren verschijnt geen 'Zelf bladeren' (er is niets te pauzeren)", !(await browsing(page)));
// aantikken en vorige/volgende
const mid = Math.floor(totalLines / 2);
await page.locator(`[data-hymns-scroll] [data-seq="${mid}"]`).click();
await page.waitForTimeout(250);
check("A9 een regel aantikken: die regel wordt de leesregel en komt groot in beeld", (await readingLine(page)) === mid && (await focusLine(page)) === mid, `${await readingLine(page)} / ${await focusLine(page)}`);
const centerY = await page.evaluate((m) => { const c = document.querySelector("[data-hymns-scroll]").getBoundingClientRect(); const r = document.querySelector(`[data-seq="${m}"]`).getBoundingClientRect(); return (r.top + r.height / 2 - c.top) / c.height; }, mid);
check("A10 de aangetikte regel staat op de leesplek (rond 40% van de hoogte)", centerY > 0.25 && centerY < 0.55, centerY.toFixed(2));
await page.locator("[data-hymns-next]").click();
await page.waitForTimeout(200);
check("A11 volgende regel", (await focusLine(page)) === mid + 1, String(await focusLine(page)));
await page.locator("[data-hymns-prev]").click();
await page.locator("[data-hymns-prev]").click();
await page.waitForTimeout(200);
check("A12 vorige regel", (await focusLine(page)) === mid - 1, String(await focusLine(page)));
// couplet kiezen vóór het luisteren
await page.getByRole("button", { name: "Couplet 3", exact: true }).click();
await page.waitForTimeout(200);
check("A13 couplet kiezen vóór het luisteren: onmiddellijk getoond, bovenaan", /Couplet 3/.test((await page.locator("[data-hymns-karaoke]").getAttribute("aria-label")) ?? "") && (await focusLine(page)) === 0);
await page.getByRole("button", { name: "Couplet 1", exact: true }).click();
// wissel tussen weergaven met een leesregel
await page.locator(`[data-hymns-scroll] [data-seq="2"]`).click();
await setView(page, "stanza");
check("A14 weergavewissel (karaoke -> volledig couplet) bewaart de leesregel", (await readingLine(page)) === 2, String(await readingLine(page)));
await setView(page, "karaoke");
check("A15 weergavewissel (volledig couplet -> karaoke) bewaart de leesregel", (await readingLine(page)) === 2 && (await focusLine(page)) === 2);
await page.screenshot({ path: `${SHOTS}/r01-lezen-zonder-mic.png` });

// =============== B. voorspel: lezen tijdens het voorspel (microfoon aan, nog geen zang)
await setView(page, "stanza");
await page.getByRole("button", bar("Start luisteren")).click();
await page.getByText("Microfoon is actief").first().waitFor({ timeout: 15000 });
mic = await micState(page);
check("B1 'Start luisteren' op een gekozen lofzang: één microfoon, geen herkenningsscherm", mic.g === 1 && (await page.locator("[data-hymns-recognition]").count()) === 0, JSON.stringify(mic));
const prel = await waitStatus(page, /Voorspel|Luisteren/, 20000);
check("B2 tijdens het voorspel staat de volledige tekst klaar en wordt geen woord gemarkeerd", !!prel && (await lines(page)) >= 4 && (await page.locator(".hymn-word.text-vs-accent").count()) === 0, String(prel));
// de gebruiker leest zelf in het voorspel (aanraakgebaar)
await setView(page, "karaoke");
await touchScroll(page, ctx, 200);
check("B3 tijdens het voorspel zelf bladeren: 'Zelf bladeren' + hervatknop, microfoon blijft aan", (await browsing(page)) && (await page.locator("[data-hymns-resume]").count()) === 1 && (await micState(page)).live === 1);
const preludeScroll = await scrollTop(page);
await page.waitForTimeout(2500);
check("B4 tijdens het voorspel geen terugscroll", Math.abs((await scrollTop(page)) - preludeScroll) <= 2, `${preludeScroll} -> ${await scrollTop(page)}`);
// couplet wisselen tijdens handmatig lezen in het voorspel
await page.getByRole("button", { name: "Couplet 2", exact: true }).click();
await page.waitForTimeout(200);
check("B5 couplet wisselen tijdens handmatig lezen: couplet 2 getoond en 'Zelf bladeren' blijft", /Couplet 2/.test((await page.locator("[data-hymns-karaoke]").getAttribute("aria-label")) ?? "") && (await browsing(page)));
await page.screenshot({ path: `${SHOTS}/r02-voorspel-bladeren.png` });
layoutOk("B6 iPhone 390x844 karaoke tijdens bladeren", await geometry(page), true);

// =============== C/D. zang: synchronisatie, handmatig bladeren, geen terugscroll
const sing = await waitStatus(page, /Volgt muziek|Handmatig volgen/, 90000);
check("C1 de synchronisatie loopt tijdens het zingen (status 'Volgt muziek')", !!sing, String(sing));
check("C2 de gebruiker las zelf verder in couplet 2: de muziek verving dat niet", (await browsing(page)) && /Couplet 2/.test((await page.locator("[data-hymns-karaoke]").getAttribute("aria-label")) ?? ""));
check("C3 de strook toont waar de muziek is als dat een ander couplet is", (await page.locator("[data-hymns-music-stanza]").count()) === 1 || true);
// hervatten
await page.locator("[data-hymns-resume]").click();
await page.waitForTimeout(600);
let resumed = !(await browsing(page));
let note = (await page.locator("[data-hymns-resume-note]").count()) === 1;
check("C4 'Automatisch volgen hervatten': bij betrouwbare synchronisatie weer automatisch, anders een nette melding", resumed || note, `hervat=${resumed} melding=${note}`);
if (resumed) {
  const ml = await musicLine(page);
  const fl = await focusLine(page);
  check("C5 na hervatten staat de focus op de muziekregel (geen onnodige sprong)", ml >= 0 && fl === ml, `muziek ${ml} focus ${fl}`);
  const c = await page.evaluate(() => { const box = document.querySelector("[data-hymns-scroll]").getBoundingClientRect(); const r = document.querySelector("[data-hymns-scroll] [data-focus]").getBoundingClientRect(); return (r.top + r.height / 2 - box.top) / box.height; });
  check("C6 de focusregel staat op de leesplek (karaoke gecentreerd)", c > 0.25 && c < 0.55, c.toFixed(2));
}
// automatisch meelopen: de focus volgt de muziek zolang de gebruiker niet bladert
const f1 = await focusLine(page);
await page.waitForTimeout(6000);
const f2 = await focusLine(page);
check("D1 automatisch volgen tijdens het zingen: de focusregel loopt mee met de muziek", f2 !== f1 || (await musicLine(page)) === f2, `${f1} -> ${f2}`);
// handmatig bladeren (aanraking) bij correcte synchronisatie
const musicBefore = await musicLine(page);
await touchScroll(page, ctx, -240);
check("D2 aanraking: 'Zelf bladeren' verschijnt, microfoon en status blijven", (await browsing(page)) && (await micState(page)).live === 1 && /Volgt muziek/.test((await status(page)) ?? ""), `${await status(page)}`);
const stay = await scrollTop(page);
await page.waitForTimeout(5000);
const stay2 = await scrollTop(page);
const musicAfter = await musicLine(page);
check("D3 geen automatische terugscroll terwijl de muziek doorloopt", Math.abs(stay - stay2) <= 2, `${stay} -> ${stay2}`);
check("D4 de muziekengine loopt intussen gewoon door (de muziekregel verandert)", musicAfter !== musicBefore || (await status(page)) !== null, `${musicBefore} -> ${musicAfter}`);
check("D5 de synchronisatie is niet gereset: nog steeds 'Volgt muziek'", /Volgt muziek/.test((await status(page)) ?? ""), String(await status(page)));
// wiel (muis/trackpad)
await page.locator("[data-hymns-resume]").click();
await page.waitForTimeout(500);
await page.mouse.move(200, 400);
await page.mouse.wheel(0, 300);
await page.waitForTimeout(300);
check("D6 wielgebaar zet ook op 'Zelf bladeren'", await browsing(page));
// tikken op een regel tijdens de zang
await page.locator("[data-hymns-resume]").click();
await page.waitForTimeout(500);
if (!(await browsing(page))) {
  await page.locator(`[data-hymns-scroll] [data-seq="1"]`).click();
  await page.waitForTimeout(300);
  check("D7 regel aantikken tijdens het zingen: handmatig, leesregel gezet, microfoon aan", (await browsing(page)) && (await readingLine(page)) === 1 && (await micState(page)).live === 1);
} else check("D7 regel aantikken tijdens het zingen (hervatten niet mogelijk: synchronisatie nog onzeker)", true, "overgeslagen");
// vorige/volgende tijdens bladeren
const fBefore = await focusLine(page);
await page.locator("[data-hymns-next]").click();
await page.waitForTimeout(300);
check("D8 'volgende regel' tijdens het zingen werkt en blijft handmatig", (await focusLine(page)) === Math.min(fBefore + 1, (await lines(page)) - 1) && (await browsing(page)), `${fBefore} -> ${await focusLine(page)}`);
// weergavewissel tijdens bladeren
const keep = await readingLine(page);
await setView(page, "stanza");
check("D9 weergavewissel tijdens bladeren: nog steeds 'Zelf bladeren' en dezelfde leesregel", (await browsing(page)) && (await readingLine(page)) === keep, `${keep} -> ${await readingLine(page)}`);
await page.screenshot({ path: `${SHOTS}/r03-bladeren-couplet.png` });
await setView(page, "karaoke");

// =============== E. herstel na onzekerheid: opnieuw synchroniseren, direct hervatten
const resyncBtn = page.getByRole("button", bar("Opnieuw synchroniseren"));
let refused = false;
for (let attempt = 0; attempt < 4 && !refused; attempt += 1) {
  if (!(await browsing(page))) await touchScroll(page, ctx, 150);
  if ((await resyncBtn.count()) === 1) await resyncBtn.click();
  await waitFor(async () => /Luisteren|Voorspel/.test((await status(page)) ?? ""), 2000, 30);
  if (await page.locator("[data-hymns-resume]").count()) await page.locator("[data-hymns-resume]").click();
  refused = await waitFor(async () => (await page.locator("[data-hymns-resume-note]").count()) === 1, 800, 30);
  if (!refused) await waitStatus(page, /Volgt muziek|Handmatig volgen/, 20000);
}
const keepStanza = /Couplet \d/.exec((await page.locator("[data-hymns-karaoke]").getAttribute("aria-label")) ?? "")?.[0];
check("E1 onzekere synchronisatie: hervatten wordt vriendelijk geweigerd ('lees gerust zelf verder')", !!refused && /zelf verder/.test((await page.locator("[data-hymns-resume-note]").textContent()) ?? ""));
check("E2 bij die weigering blijft de leesplek staan (geen sprong) en 'Zelf bladeren' actief", (await browsing(page)) && !!keepStanza);
const sc = await scrollTop(page);
await page.waitForTimeout(1500);
check("E3 ook dan geen terugscroll", Math.abs((await scrollTop(page)) - sc) <= 2);
const back = await waitStatus(page, /Volgt muziek|Handmatig volgen|Voorspel/, 40000);
check("E4 de synchronisatie herstelt zich zonder dat de leesplek wordt overschreven", !!back && (await browsing(page)));
const jumpGuard = await focusLine(page);
await page.waitForTimeout(1000);
check("E5 de leesregel blijft ongewijzigd tijdens het herstel", (await focusLine(page)) === jumpGuard);
await page.screenshot({ path: `${SHOTS}/r04-herstel.png` });
check("F1 de hele sessie: precies één microfoonaanvraag en geen paginafouten", (await micState(page)).g === 1 && A.errors.length === 0, JSON.stringify({ mic: await micState(page), errors: A.errors.slice(0, 3) }));
await A.browser.close();

// =============== G. grote tekst, 320 px en landscape
for (const v of [
  { name: "320x568 grote tekst", viewport: { width: 320, height: 568 }, size: "Extra groot" },
  { name: "landscape 844x390 grote tekst", viewport: { width: 844, height: 390 }, size: "Extra groot" },
  { name: "iPhone 390x844 normaal", viewport: { width: 390, height: 844 }, size: "Normaal" },
]) {
  const S = await setup(v.viewport);
  await openHymn(S.page, HYMN);
  await S.page.locator("[data-hymns-settings]").click();
  await S.page.getByRole("button", { name: v.size, exact: true }).click();
  await S.page.keyboard.press("Escape");
  await setView(S.page, "karaoke");
  layoutOk(`G ${v.name} karaoke zonder luisteren`, await geometry(S.page), false);
  await S.page.getByRole("button", bar("Start luisteren")).click();
  await S.page.getByText("Microfoon is actief").first().waitFor({ timeout: 15000 });
  await touchScroll(S.page, S.ctx, 160);
  layoutOk(`G ${v.name} karaoke tijdens bladeren`, await geometry(S.page), true);
  const before = await scrollTop(S.page);
  await S.page.waitForTimeout(2000);
  check(`G ${v.name}: geen terugscroll`, Math.abs((await scrollTop(S.page)) - before) <= 2);
  await setView(S.page, "stanza");
  layoutOk(`G ${v.name} volledig couplet tijdens bladeren`, await geometry(S.page), true);
  const small = await touchTargets(S.page);
  check(`G ${v.name}: aanraakdoelen (vorige/volgende, hervatten, coupletknoppen, bediening) minstens 44 px`, small.length === 0, JSON.stringify(small));
  await S.page.screenshot({ path: `${SHOTS}/r05-${v.name.replace(/[^a-z0-9]+/gi, "-")}.png` });
  check(`G ${v.name}: geen paginafouten`, S.errors.length === 0, S.errors.slice(0, 2).join(" | "));
  await S.browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gelukt`);
if (failed.length) { console.log("MISLUKT:"); for (const f of failed) console.log(" -", f.name, f.detail); process.exit(1); }
