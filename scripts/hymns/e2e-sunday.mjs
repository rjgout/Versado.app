// Browsertest: eigen groep "Zang & muziek" in de contentkiezer en de zondagkaart op Vandaag (Chromium-emulatie, geen echt toestel).
//   De server draait met een nagebootste klok (zie docs/CONTENT-AVAILABILITY.md); de tijdzone van de gebruiker bepaalt de zondag.
//   NOODSTOP=1 : server met HYMNS_POC=0 (kaart nergens zichtbaar).
//   PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… PROMOTE_DB_URL=… AUDIT_BASE_URL=http://localhost:3124 SHOTS_DIR=/tmp/shots node scripts/hymns/e2e-sunday.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3124";
const DB = process.env.PROMOTE_DB_URL;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/shots-sunday";
const NOOD = process.env.NOODSTOP === "1";
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "OK  " : "FAIL", name, detail); };
const sql = (q) => execFileSync("psql", [DB, "-At", "-c", q]).toString().trim();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });

async function account(label, { admin = false, tz = "Europe/Amsterdam" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  await ctx.request.post(`${BASE}/api/auth/register`, { data: { email, handle: `${label} ${Math.random().toString(36).slice(2, 6)}`, password: "Wachtwoord-123!" } });
  sql(`update "User" set "onboardingSeenAt"=now(), "avatarCharacterId"='sariah', "isAdmin"=${admin}, "timeZone"='${tz}' where email='${email}'`);
  await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: email, password: "Wachtwoord-123!" } });
  return { ctx, email };
}
const snapshot = (email) => sql(`select coalesce("activeContentCollectionId",''),"contentLanguage","xpTotal","currentStreak" from "User" where email='${email}'`);
const setVisible = (v) => sql(`insert into "ContentSwitcherSettings"(id,enabled,"hymnsVisibleToUsers") values('singleton',true,${v}) on conflict(id) do update set "hymnsVisibleToUsers"=${v}`);
async function card(ctx) { const p = await ctx.newPage(); await p.goto(`${BASE}/dashboard`); await p.waitForLoadState("networkidle"); const n = await p.locator("[data-today-hymns]").count(); return { p, n }; }

try {
  // --- toegang en tijdzone (nagebootste klok: zondag 18 okt 10:00 UTC)
  setVisible(false);
  const admin = await account("beheer", { admin: true });
  const user = await account("gebruiker");
  const tzNames = { "Europe/Amsterdam": 1, "Pacific/Auckland": 1, "America/Los_Angeles": 1, "Pacific/Kiritimati": 0, "Pacific/Pago_Pago": 0 };
  const a = await card(admin.ctx);
  check(NOOD ? "noodstop: beheerder ziet geen zondagkaart" : "zondag: beheerder ziet de kaart op Vandaag", a.n === (NOOD ? 0 : 1));
  if (NOOD) { for (const w of [320, 1280]) { await a.p.setViewportSize({ width: w, height: 900 }); } await a.p.screenshot({ path: `${SHOTS}/noodstop-today.png` }); }
  else {
    const u0 = await card(user.ctx);
    check("gewone gebruiker zonder toestemming ziet geen kaart", u0.n === 0);
    setVisible(true);
    const u1 = await card(user.ctx);
    check("gewone gebruiker met toestemming ziet de kaart", u1.n === 1);
    setVisible(false);
    const u2 = await card(user.ctx);
    check("toestemming ingetrokken: kaart weer weg", u2.n === 0);
    setVisible(true);
    for (const [tz, want] of Object.entries(tzNames)) {
      sql(`update "User" set "timeZone"='${tz}' where email='${user.email}'`);
      const r = await card(user.ctx);
      check(`tijdzone ${tz}: kaart ${want ? "zichtbaar" : "verborgen"} (zondag 10:00 UTC)`, r.n === want);
    }
    sql(`update "User" set "timeZone"='Europe/Amsterdam' where email='${user.email}'`);

    // --- alle contentbronnen: de kaart blijft, de selectie blijft ongewijzigd
    const ids = sql(`select id from "ContentCollection" order by id`).split("\n").filter(Boolean);
    let all = true; let unchanged = true;
    for (const id of ids) {
      sql(`update "User" set "activeContentCollectionId"='${id}' where email='${admin.email}'`);
      const before = snapshot(admin.email);
      const r = await card(admin.ctx);
      if (r.n !== 1) all = false;
      if (snapshot(admin.email) !== before) unchanged = false;
      await r.p.close();
    }
    check(`kaart zichtbaar bij elk van ${ids.length} actieve bronnen`, all);
    check("bezoek aan Vandaag wijzigt bron, taal, XP of reeks niet", unchanged);

    // --- Vandaag zonder dagtekst of spellen: alleen de kaart, geen foutmelding, geen taak
    const p = a.p; await p.reload(); await p.waitForLoadState("networkidle");
    check("Vandaag zonder tekst/spellen toont de kaart zonder foutmelding", (await p.locator("[data-today-hymns]").count()) === 1 && (await p.locator("text=/something went wrong|Application error/i").count()) === 0);
    check("kaart telt niet als openstaande taak (geen voortgangsteller, geen XP-aanduiding)", !(await p.locator("[data-today-hymns]").innerText()).match(/XP|\d+\s*\/\s*\d+/));

    // --- kiezer: volgorde, eigen groep, geen selectie, terugnavigatie
    const pk = await admin.ctx.newPage();
    let writes = 0; pk.on("request", (r) => { if (r.url().includes("/api/content-context") && r.method() === "PUT") writes += 1; });
    await pk.goto(`${BASE}/content`); await pk.waitForLoadState("networkidle");
    const groups = await pk.locator("[data-content-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-content-group")));
    const order = [...groups, "language"].join(">");
    const lang = await pk.locator("[data-content-language]").count();
    const full = await pk.evaluate(() => [...document.querySelectorAll("[data-content-group],[data-content-language]")].map((e) => e.getAttribute("data-content-group") ?? "language"));
    check("kiezervolgorde: Schriften, Zang & muziek, Studieprogramma's, Taal", full.join(">") === "scriptures>music>studyPrograms>language", full.join(">"));
    check("Lofzangen staat niet in Studieprogramma's", (await pk.locator('[data-content-group="studyPrograms"] [data-hymns-link]').count()) === 0 && (await pk.locator('[data-content-group="music"] [data-hymns-link]').count()) === 1);
    const before = snapshot(admin.email);
    await pk.locator("[data-hymns-link]").click(); await pk.waitForURL(`${BASE}/dev/lofzangen`);
    check("Lofzangenkaart opent de bestaande Lofzangen-pagina zonder selectieverzoek", writes === 0 && snapshot(admin.email) === before);
    await pk.goBack(); await pk.waitForURL(`${BASE}/content`);
    check("terugnavigatie vanaf Lofzangen brengt terug naar de kiezer", (await pk.locator('[data-content-group="music"]').count()) === 1);
    const gUser = await user.ctx.newPage(); await gUser.goto(`${BASE}/content`); await gUser.waitForLoadState("networkidle");
    check("gewone gebruiker met toestemming ziet de muziekgroep", (await gUser.locator('[data-content-group="music"]').count()) === 1);
    setVisible(false); await gUser.reload(); await gUser.waitForLoadState("networkidle");
    check("zonder toestemming geen muziekgroep (geen lege kop)", (await gUser.locator('[data-content-group="music"]').count()) === 0);
    setVisible(true);

    // --- schermen: 320 px met 200% tekst, 390 donker, 1280 licht
    for (const [w, scheme, big] of [[320, "light", true], [390, "dark", false], [1280, "light", false]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme, hasTouch: w < 500 });
      await ctx.addCookies(await admin.ctx.cookies());
      for (const [name, url, sel] of [["kiezer", "/content", '[data-content-group="music"]'], ["vandaag", "/dashboard", "[data-today-hymns]"]]) {
        const pg = await ctx.newPage(); await pg.goto(BASE + url); await pg.waitForLoadState("networkidle");
        if (big) await pg.addStyleTag({ content: "html{font-size:200% !important}" });
        await pg.locator(sel).scrollIntoViewIfNeeded();
        const ov = await pg.evaluate(() => ({ w: innerWidth, s: document.documentElement.scrollWidth }));
        check(`${name} ${w}px ${scheme}${big ? " 200% tekst" : ""}: geen horizontale overflow`, ov.s <= ov.w + 1, JSON.stringify(ov));
        const box = await pg.locator(sel).first().boundingBox();
        check(`${name} ${w}px: element binnen het scherm`, box && box.x >= -1 && box.x + box.width <= w + 1);
        await pg.screenshot({ path: `${SHOTS}/${name}-${w}-${scheme}${big ? "-200" : ""}.png` });
        await pg.close();
      }
      await ctx.close();
    }
  }
} catch (e) { check("onverwachte fout", false, String(e)); }
await browser.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad}/${results.length} geslaagd`);
fs.writeFileSync(`${SHOTS}/results${NOOD ? "-noodstop" : ""}.json`, JSON.stringify(results, null, 2));
process.exit(bad ? 1 : 0);
