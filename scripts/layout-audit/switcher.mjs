// Controle van de bovenbalk met contentkiezer (docs/LAYOUT.md): header →
// contentkiezer (in de headerrij) → terugbalk → pagina-inhoud, op meerdere
// breedtes, licht en donker, vóór en na hydratie, tijdens scrollen,
// terugnavigeren en content wisselen. Draait tegen een lopende app waarin de
// contentkiezer aanstaat (of voor een beheerder). Gebruik:
//   PLAYWRIGHT_MODULE=/pad/naar/playwright AUDIT_BASE_URL=http://localhost:3100 \
//   AUDIT_IDENTIFIER=mail AUDIT_PASSWORD=wachtwoord node scripts/layout-audit/switcher.mjs
// Opties (JSON): widths, height. Exitcode 1 bij een gevonden probleem.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";
const cfg = JSON.parse(process.argv[2] || "{}");
const WIDTHS = cfg.widths ?? [320, 390, 768, 1200];
const H = cfg.height ?? 700;
const WITH_BACK = "/tools/dictionary";
const WITHOUT_BACK = "/dashboard";
const SAFE_TOP = 47;

const problems = [];
const fail = (ctx, msg) => problems.push(`${ctx}: ${msg}`);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
const boot = await browser.newContext();
const login = await boot.request.post(`${BASE}/api/auth/login`, { data: { identifier: process.env.AUDIT_IDENTIFIER, password: process.env.AUDIT_PASSWORD } });
if (!login.ok()) { console.error(`inloggen mislukt (${login.status()})`); process.exit(2); }
const state = await boot.storageState();
await boot.close();


// Wachten op "gehydrateerd" in plaats van op netwerkstilte: de afbeeldingsoptimalisatie van Next kan
// op een koude cache lang doorlopen, en ShellMetrics zet --header-height pas nadat de pagina leeft.
async function gotoReady(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--header-height").trim() !== "", null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

// Geometrie van de bovenbalk in de pagina zelf.
function snapshot() {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }; };
  const sw = document.querySelector('[data-kompas-target="content-switcher"]');
  const sb = sw?.getBoundingClientRect();
  const hit = sb && sb.width > 0 ? document.elementFromPoint(sb.left + Math.min(12, sb.width / 2), sb.top + sb.height / 2) : null;
  const main = document.querySelector("main");
  return {
    wrapper: r("[data-sticky-header]"), header: r("[data-app-global-header]"), sw: sb ? r('[data-kompas-target="content-switcher"]') : null,
    back: r("[data-subpage-back-bar]"), nav: r("[data-main-nav]"),
    swClickable: sw ? sw.contains(hit) : false,
    mainPadTop: main ? parseFloat(getComputedStyle(main).paddingTop) : 0,
    mainTop: main ? main.getBoundingClientRect().top + scrollY : 0,
    vw: innerWidth, vh: innerHeight, docW: document.documentElement.scrollWidth,
    wrapperPos: getComputedStyle(document.querySelector("[data-sticky-header]")).position,
  };
}

function checkBars(ctx, s, expectBack, { scrolled = false } = {}) {
  if (!s.sw || s.sw.width < 24 || s.sw.height < 24) return fail(ctx, `contentkiezer niet zichtbaar (${JSON.stringify(s.sw)})`);
  if (!s.swClickable) fail(ctx, "contentkiezer wordt bedekt door een ander element");
  if (s.sw.top < s.header.top - 0.5 || s.sw.bottom > s.header.bottom + 0.5) fail(ctx, "contentkiezer valt buiten de header");
  if (s.sw.left < -0.5 || s.sw.right > s.vw + 0.5) fail(ctx, "contentkiezer valt buiten het scherm");
  if (expectBack === true && !s.back) fail(ctx, "terugbalk ontbreekt");
  if (expectBack === false && s.back) fail(ctx, "terugbalk onverwacht aanwezig");
  if (s.back && s.back.top < s.header.bottom - 0.5) fail(ctx, `terugbalk overlapt de header (${s.back.top} < ${s.header.bottom})`);
  if (s.back && s.sw.bottom > s.back.top + 0.5) fail(ctx, "contentkiezer overlapt de terugbalk");
  if (!scrolled && s.wrapperPos === "fixed" && s.mainTop + s.mainPadTop < s.wrapper.bottom - 0.5) fail(ctx, `inhoud begint onder de balken (${s.mainTop + s.mainPadTop} < ${s.wrapper.bottom})`);
  if (s.docW > s.vw + 1) fail(ctx, `horizontale overflow (${s.docW} > ${s.vw})`);
  // Op desktop (vanaf lg) bestaat de onderbalk niet; dan is zijn rechthoek leeg.
  if (s.nav && s.nav.height > 0 && Math.abs(s.nav.bottom - s.vh) > 1) fail(ctx, `onderbalk staat niet onderaan (${s.nav.bottom} vs ${s.vh})`);
}

for (const scheme of ["light", "dark"]) {
  for (const width of WIDTHS) {
    const tag = (p) => `${scheme} ${width}px ${p}`;
    const phone = width <= 430;
    const ctx = await browser.newContext({ viewport: { width, height: H }, colorScheme: scheme, storageState: state, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 3 : 1 });
    const page = await ctx.newPage();
    const press = (locator) => (phone ? locator.tap() : locator.click());
    for (const [path, expectBack] of [[WITHOUT_BACK, false], [WITH_BACK, true]]) {
      await gotoReady(page, BASE + path);
      await page.waitForTimeout(400);
      const top = await page.evaluate(snapshot);
      checkBars(tag(path), top, expectBack);
      // Scrollen: de balken en de kiezer blijven staan waar ze stonden.
      await page.evaluate(() => scrollTo(0, 700));
      await page.waitForTimeout(250);
      const scrolled = await page.evaluate(snapshot);
      checkBars(tag(`${path} (gescrold)`), scrolled, expectBack, { scrolled: true });
      if (scrolled.wrapperPos === "fixed" && Math.abs(scrolled.sw.top - top.sw.top) > 0.5) fail(tag(path), "contentkiezer verschuift bij scrollen");
      // Menu: volledig zichtbaar (raster van meetpunten), niet geclipt, boven de onderbalk, en sluitbaar.
      await page.evaluate(() => scrollTo(0, 0));
      const trigger = page.locator('[data-kompas-target="content-switcher"] > button');
      const openMenu = async () => { await press(trigger); await page.waitForSelector("[data-content-menu]", { timeout: 3000 }); await page.waitForTimeout(150); };
      const menuProbe = () => page.evaluate(() => {
        const m = document.querySelector("[data-content-menu]");
        if (!m) return null;
        const b = m.getBoundingClientRect();
        let hits = 0, total = 0;
        for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const fy of [0.1, 0.3, 0.5, 0.7, 0.9]) { total++; const el = document.elementFromPoint(b.left + b.width * fx, Math.min(b.top + b.height * fy, innerHeight - 2)); if (el && m.contains(el)) hits++; }
        const nav = document.querySelector("[data-main-nav]");
        const nb = nav && nav.getBoundingClientRect().height > 0 ? nav.getBoundingClientRect() : null;
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height, hits, total, vh: innerHeight, navTop: nb ? nb.top : null, position: getComputedStyle(m).position, parent: m.parentElement === document.body };
      });
      const probeMenu = async (label) => {
        const m = await menuProbe();
        if (!m) return fail(tag(label), "menu opent niet");
        if (m.hits !== m.total) fail(tag(label), `menu wordt bedekt (${m.total - m.hits} van ${m.total} meetpunten)`);
        if (m.height < 100) fail(tag(label), `menu is bijna onzichtbaar (hoogte ${Math.round(m.height)})`);
        if (m.bottom > m.vh + 1 || m.left < -0.5 || m.right > width + 0.5) fail(tag(label), `menu valt buiten beeld ${JSON.stringify(m)}`);
        if (m.navTop !== null && m.bottom > m.navTop + 1) fail(tag(label), "menu overlapt de onderbalk");
        if (m.position !== "fixed" || !m.parent) fail(tag(label), "menu is geen fixed portal op <body>");
      };
      await openMenu();
      await probeMenu(`${path} menu`);
      // Sluiten: Escape (focus terug op de kiezer), een tik buiten het menu, en een tweede tik op de kiezer.
      await page.keyboard.press("Escape");
      if (await page.locator("[data-content-menu]").count()) fail(tag(path), "Escape sluit het menu niet");
      if (!(await trigger.evaluate((el) => document.activeElement === el))) fail(tag(path), "focus keert na Escape niet terug naar de kiezer");
      await openMenu();
      const urlBefore = page.url();
      if (phone) await page.touchscreen.tap(width / 2, H - 6); else await page.mouse.click(width / 2, H - 6);
      await page.waitForTimeout(200);
      if (await page.locator("[data-content-menu]").count()) fail(tag(path), "een tik buiten het menu sluit het menu niet");
      if (page.url() !== urlBefore) fail(tag(path), "een tik buiten het menu activeerde iets eronder");
      await openMenu();
      const box = await trigger.boundingBox();
      if (phone) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);
      if (await page.locator("[data-content-menu]").count()) fail(tag(path), "een tweede tik op de kiezer sluit het menu niet");
      // Stresstest: een afkappende voorouder (zoals WebKit de balk kan behandelen) mag het menu niet raken.
      await page.addStyleTag({ content: "[data-sticky-header]{overflow:hidden !important;contain:paint !important;transform:translateZ(0)}" });
      await openMenu();
      await probeMenu(`${path} menu met afkappende balk`);
      await page.keyboard.press("Escape");
    }
    // Pre-hydratie, met een inkeping: de standaardhoogte moet kloppen vóór de meting.
    for (const [path, expectBack] of [[WITHOUT_BACK, false], [WITH_BACK, true]]) {
      const bare = await browser.newContext({ viewport: { width, height: H }, colorScheme: scheme, storageState: state });
      await bare.route(/_next\/static\/.*\.js/, (route) => route.abort());
      const p = await bare.newPage();
      await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
      await p.addStyleTag({ content: `:root{--safe-area-inset-top:${SAFE_TOP}px}` });
      await p.waitForTimeout(250);
      const s = await p.evaluate(snapshot);
      if (s.mainTop + s.mainPadTop < s.wrapper.bottom - 0.5) fail(tag(`${path} vóór hydratie, notch`), `inhoud onder de balken (${Math.round(s.mainTop + s.mainPadTop)} < ${Math.round(s.wrapper.bottom)})`);
      if (Boolean(s.back) !== expectBack) fail(tag(path), "terugbalk-verwachting klopt niet vóór hydratie");
      await bare.close();
    }
    // Terugnavigeren: zelfde lijst, zelfde scrollpositie, balken ongewijzigd.
    await gotoReady(page, `${BASE}${WITH_BACK}?q=gel`);
    await page.evaluate(() => scrollTo(0, 300));
    await page.waitForTimeout(300);
    const before = (await page.evaluate(() => scrollY));
    // Klik via de DOM: Playwright zou het resultaat eerst in beeld scrollen, en dat meet dan de verkeerde positie.
    await page.locator('a[href^="/tools/dictionary/"]').nth(4).evaluate((a) => a.click());
    await page.waitForURL(/dictionary\/.+/);
    await page.waitForTimeout(500);
    checkBars(tag("woordpagina"), await page.evaluate(snapshot), true);
    await page.goBack();
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => scrollY);
    if (Math.abs(after - before) > 40) fail(tag("terug"), `scrollpositie niet hersteld (${before} → ${after})`);
    checkBars(tag("terug"), await page.evaluate(snapshot), true);
    await ctx.close();
  }
}

// Content wisselen: de kiezer blijft op zijn plek en bedienbaar, en de wissel wordt teruggezet.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: H }, storageState: state });
  const page = await ctx.newPage();
  await gotoReady(page, BASE + WITH_BACK);
  const options = page.locator("[role=option]");
  await page.click('[data-kompas-target="content-switcher"] button');
  const count = await options.count();
  if (count > 1) {
    const original = await options.nth(0).innerText();
    await options.nth(1).click();
    await page.waitForTimeout(1500);
    checkBars("content wisselen", await page.evaluate(snapshot), undefined);
    // Bestaat de pagina niet in de nieuwe content, dan vraagt de app eerst bevestiging: blijf dan bij de huidige content.
    const dialog = page.locator("dialog[open]");
    if (await dialog.count()) {
      checkBars("content wisselen (melding open)", await page.evaluate(snapshot), undefined);
      await dialog.locator(".btn-secondary").click();
      await page.waitForTimeout(500);
    } else {
      await page.click('[data-kompas-target="content-switcher"] button');
      const names = await options.allInnerTexts();
      const back = names.findIndex((n) => n.includes(original.trim().split("\n").pop()));
      await options.nth(Math.max(back, 0)).click();
      await page.waitForTimeout(1200);
    }
    checkBars("na content wisselen", await page.evaluate(snapshot), undefined);
  }
  await ctx.close();
}

await browser.close();
if (problems.length) { console.log(`${problems.length} probleem/problemen:\n- ${problems.join("\n- ")}`); process.exit(1); }
console.log("geen problemen gevonden");
