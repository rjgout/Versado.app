// Layout-audit van de shell (docs/LAYOUT.md): meet per pagina, schermbreedte,
// tekstgrootte en taal of de vaste balken op hun plek blijven en niets
// horizontaal overloopt. Draait tegen een lopende app; Playwright is bewust
// geen dependency van het project. Gebruik:
//   PLAYWRIGHT_MODULE=/pad/naar/playwright AUDIT_BASE_URL=http://localhost:3100 \
//     node scripts/layout-audit/audit.mjs '{"widths":[320,390],"fonts":[100,200],"langs":["nl","de"]}'
// Opties (JSON): widths, fonts (%), langs, height, pages, focus, shots.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import fs from "node:fs";
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";
const cfg = JSON.parse(process.argv[2] || "{}");
const WIDTHS = cfg.widths ?? [320, 360, 390];
const FONTS = cfg.fonts ?? [100, 200];
const LANGS = cfg.langs ?? ["nl"];
const H = cfg.height ?? 700;
const NORMAL = cfg.pages ?? ["/dashboard", "/courses", "/live", "/mysteries", "/profile", "/profile?view=language", "/friends", "/groups", "/competition", "/activity", "/streak", "/xp", "/tools", "/shop", "/feedback", "/kompas", "/kompas/learn"];
const FOCUS = cfg.focus ?? ["/word-game", "/jigsaw", "/lesson/0f20b4db-20e8-4330-982a-dc380ec9e91b"];
const stamp = Date.now();
const email = `layout-${stamp}@test.invalid`;
await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, handle: "Layout", password: "wachtwoord123" }) });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const boot = await browser.newContext();
await boot.request.post(`${BASE}/api/auth/login`, { data: { identifier: email, password: "wachtwoord123" } });
await boot.request.post(`${BASE}/api/onboarding/complete`, { data: { kompasSeen: true } });
const states = {};
for (const l of LANGS) { await boot.request.patch(`${BASE}/api/account`, { data: { uiLanguage: l } }); states[l] = await boot.storageState(); }
await boot.close();

const problems = [];
let count = 0;
function measure() {
  const vw = innerWidth, vh = innerHeight;
  const doc = document.documentElement;
  const hdr = document.querySelector("[data-sticky-header]");
  const nav = document.querySelector("[data-main-nav]");
  const r = (e) => e.getBoundingClientRect();
  const hr = hdr && getComputedStyle(hdr).display !== "none" ? r(hdr) : null;
  const navVisible = nav && r(nav).height > 0;
  const main = document.querySelector("main");
  const inScroller = (e) => { for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) { const ox = getComputedStyle(n).overflowX; if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true; } return false; };
  const wide = [...document.querySelectorAll("body *")].filter((e) => { const b = r(e); return b.width > 0 && b.right > doc.clientWidth + 1 && !e.closest("[aria-hidden=true]") && !inScroller(e); }).slice(0, 3).map((e) => e.tagName + "." + String(e.className).slice(0, 40));
  // eerste zichtbare inhoud van main
  let firstTop = null;
  if (main) { const kids = [...main.querySelectorAll("h1,h2,p,button,a,img,section,div")].filter((e) => r(e).height > 4 && r(e).width > 4); if (kids.length) firstTop = Math.min(...kids.slice(0, 40).map((e) => r(e).top)) + 0; }
  return {
    vw, vh, clientW: doc.clientWidth, scrollW: doc.scrollWidth, vvScale: visualViewport.scale, vvW: visualViewport.width, vvH: visualViewport.height,
    hdr: hr && { top: hr.top, bottom: hr.bottom, pos: getComputedStyle(hdr).position }, mainTop: main ? r(main).top : null, firstTop,
    nav: navVisible ? { top: r(nav).top, bottom: r(nav).bottom, scrollW: nav.scrollWidth, clientW: nav.clientWidth } : null,
    wide, scrollY: scrollY, docH: doc.scrollHeight,
  };
}
for (const lang of LANGS) for (const font of FONTS) for (const width of WIDTHS) {
  const ctx = await browser.newContext({ storageState: states[lang], viewport: { width, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: lang });
  await ctx.addInitScript((f) => { document.addEventListener("DOMContentLoaded", () => { if (f !== 100) document.documentElement.style.fontSize = f + "%"; }); }, font);
  const page = await ctx.newPage();
  const tag = `${lang} ${width}px ${font}%`;
  for (const url of [...NORMAL.map((u) => [u, "normal"]), ...FOCUS.map((u) => [u, "focus"])]) {
    count++;
    const [path, kind] = url;
    try { await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 20000 }); } catch { problems.push(`${tag} ${path}: laden mislukt`); continue; }
    if (!new URL(page.url()).pathname.startsWith(path.split("?")[0].slice(0, 6))) { problems.push(`${tag} ${path}: redirect naar ${page.url()}`); continue; }
    await page.waitForTimeout(500);
    const m = await page.evaluate(measure);
    const bad = [];
    if (m.scrollW > m.clientW + 1) bad.push(`horizontale overflow ${m.scrollW}>${m.clientW}`);
    if (m.vw !== width) bad.push(`layout-viewport ${m.vw} ≠ ${width} (uitgezoomd)`);
    if (m.wide.length) bad.push(`te breed: ${m.wide.join(", ")}`);
    if (kind === "normal") {
      if (!m.hdr) bad.push("geen header");
      else {
        if (m.hdr.top !== 0 && m.hdr.pos === "fixed") bad.push(`header top ${m.hdr.top}`);
        if (m.hdr.bottom > m.vh * 0.45) bad.push(`header neemt ${Math.round((m.hdr.bottom / m.vh) * 100)}% van het scherm`);
        if (m.firstTop !== null && m.firstTop < m.hdr.bottom - 1 && m.scrollY === 0) bad.push(`inhoud (${Math.round(m.firstTop)}) onder header (${Math.round(m.hdr.bottom)})`);
        if (m.firstTop !== null && m.firstTop - m.hdr.bottom > 90 && m.scrollY === 0) bad.push(`lege ruimte ${Math.round(m.firstTop - m.hdr.bottom)}px onder header`);
      }
      if (!m.nav) bad.push("geen onderbalk");
      else {
        if (Math.abs(m.nav.bottom - m.vvH) > 1.5) bad.push(`onderbalk bottom ${Math.round(m.nav.bottom)} ≠ scherm ${Math.round(m.vvH)}`);
        if (m.nav.scrollW > m.nav.clientW + 1) bad.push(`onderbalk loopt over ${m.nav.scrollW}>${m.nav.clientW}`);
      }
      // scroll
      await page.evaluate(() => scrollTo(0, 300)); await page.waitForTimeout(150);
      const m2 = await page.evaluate(measure);
      if (m.nav && m2.nav && Math.abs(m2.nav.bottom - m.nav.bottom) > 1.5) bad.push(`onderbalk beweegt bij scrollen ${m.nav.bottom}→${m2.nav.bottom}`);
      if (m.hdr && m2.hdr && m2.hdr.pos === "fixed" && Math.abs(m2.hdr.top - m.hdr.top) > 1.5) bad.push(`header beweegt bij scrollen`);
      for (let i = 0; i < 3; i++) { await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(400); } // lijsten die bij het scrollen meer laden
      const cover = await page.evaluate(() => { const nav = document.querySelector("[data-main-nav]"); if (!nav) return null; const nt = nav.getBoundingClientRect().top; const hidden = []; for (const e of document.querySelectorAll("main *")) { if (e.children.length) continue; const b = e.getBoundingClientRect(); if (b.height <= 0 || b.width <= 0 || b.bottom <= nt || b.top >= nt + 1 && b.top > visualViewport.height) continue; const y = Math.min(Math.max((Math.max(b.top, nt) + Math.min(b.bottom, visualViewport.height)) / 2, nt + 1), visualViewport.height - 1); nav.style.pointerEvents = "none"; const hit = document.elementFromPoint(Math.min(Math.max(b.left + b.width / 2, 1), innerWidth - 1), y); nav.style.pointerEvents = ""; /* geraakt zonder balk = echt achter de balk; afgeknipte inhoud telt niet */ if (hit && (hit === e || e.contains(hit)) && b.top < nt - 2) hidden.push(e.tagName + "." + String(e.className).slice(0, 30)); } return { hidden, nt }; });
      if (cover && cover.hidden.length) bad.push(`inhoud onder de onderbalk: ${cover.hidden.slice(0, 2).join(", ")}`);
    } else {
      if (m.nav) bad.push("onderbalk zichtbaar in focus mode");
      if (m.docH > H * 1.6) { await page.evaluate(() => scrollTo(0, 1500)); await page.waitForTimeout(150); const m3 = await page.evaluate(measure); if (m3.hdr && m3.hdr.pos === "fixed" && Math.abs(m3.hdr.top) > 1) bad.push(`terugbalk scrolt weg bij scrollen (top ${Math.round(m3.hdr.top)})`); }
      if (m.hdr && m.hdr.top < -1) bad.push("terugbalk buiten beeld");
      if (m.hdr && m.firstTop !== null && m.firstTop < m.hdr.bottom - 1 && m.scrollY === 0) bad.push(`focus: inhoud (${Math.round(m.firstTop)}) onder terugbalk (${Math.round(m.hdr.bottom)})`);
    }
    if (bad.length) problems.push(`${tag} ${path}: ${bad.join("; ")}`);
    if (cfg.shots && bad.length) await page.screenshot({ path: `shots/${lang}-${width}-${font}-${path.replace(/[^a-z0-9]/gi, "_")}.png` });
  }
  await ctx.close();
}
await browser.close();
fs.mkdirSync("shots", { recursive: true });
console.log(`${count} metingen, ${problems.length} problemen`);
const groups = {};
for (const p of problems) { const key = p.replace(/^[^:]*: /, "").replace(/\d+/g, "#"); (groups[key] ||= []).push(p.split(":")[0]); }
for (const [k, v] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length).slice(0, 25)) console.log(`${v.length}× ${k}\n    bv. ${v.slice(0, 3).join(" | ")}`);
