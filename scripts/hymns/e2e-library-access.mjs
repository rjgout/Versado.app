// Toegang, gegevensomvang en lokale opslag van de Lofzangen-bibliotheek, in een echte browser.
//  - een gewone gebruiker krijgt 404 op de pagina en op alle /api/hymns/*-routes en ziet geen link in de contentkiezer;
//  - een beheerder krijgt de gegevens; de grootte van index, één lofzang en de herkenningsbundel wordt gemeten;
//  - na een eerste keer laden staan index, geopende lofzangen en herkenningsgegevens lokaal (IndexedDB): zonder API
//    blijft de lijst en een eerder geopende lofzang bruikbaar.
// Aanroep zoals e2e-browser.mjs (PLAYWRIGHT_MODULE, CHROMIUM_PATH, PROMOTE_DB_URL, AUDIT_BASE_URL).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";
const stamp = Date.now().toString(36);
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "OK  " : "FAIL", name, detail); };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

async function account(label, admin) {
  // serviceWorkers "block": de passthrough-service worker van de app zou anders het geblokkeerde API-verkeer om de routing heen sturen
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const email = `${label}-${stamp}@example.test`;
  let r = await ctx.request.post(`${BASE}/api/auth/register`, { data: { email, handle: `${label} ${stamp}`, password: "Wachtwoord-123!" } });
  if (!r.ok()) throw new Error(`registratie ${label}: ${r.status()}`);
  if (admin) execFileSync("psql", [process.env.PROMOTE_DB_URL, "-c", `update "User" set "isAdmin"=true where email='${email}'`]);
  r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: email, password: "Wachtwoord-123!" } });
  if (!r.ok()) throw new Error(`login ${label}: ${r.status()}`);
  return ctx;
}

// De allereerste registratie wordt automatisch beheerder: maak eerst een wegwerpaccount zodat het volgende gewoon is.
const filler = await account("vulling", false);
await filler.close();
const normal = await account("gewoon", false);
const admin = await account("beheer", true);

// ---------- gewone gebruiker en anonieme bezoeker
const anon = await browser.newContext();
const routes = ["/api/hymns/index", "/api/hymns/24", "/api/hymns/recognition", "/api/hymns/report"];
for (const route of routes) {
  const a = await anon.request.get(`${BASE}${route}`);
  const n = await normal.request.get(`${BASE}${route}`);
  check(`${route}: anoniem 404 en gewone gebruiker 404`, a.status() === 404 && n.status() === 404, `${a.status()}/${n.status()}`);
}
const np = await normal.newPage();
const resp = await np.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded" });
check("/dev/lofzangen: gewone gebruiker krijgt 404", resp?.status() === 404, String(resp?.status()));
await np.goto(`${BASE}/content`, { waitUntil: "domcontentloaded", timeout: 120000 });
await np.waitForTimeout(2500);
check("contentkiezer: gewone gebruiker ziet geen Lofzangen-link", (await np.locator("[data-admin-hymns-link]").count()) === 0);

// ---------- beheerder
const get = async (route) => { const r = await admin.request.get(`${BASE}${route}`); const b = await r.body(); return { status: r.status(), bytes: b.length, json: r.status() === 200 ? JSON.parse(b.toString()) : null }; };
const idx = await get("/api/hymns/index");
check("beheerder: index met 205 lofzangen", idx.status === 200 && idx.json.hymns.length === 205, `${idx.bytes} bytes`);
const h24 = await get("/api/hymns/24");
check("beheerder: lofzang 24 met tekst en compositie", h24.status === 200 && h24.json.hymn.text.stanzas.length === 4 && !!h24.json.hymn.composition, `${h24.bytes} bytes`);
const h54 = await get("/api/hymns/54");
check("beheerder: lofzang 54 zonder tekst (licentie), nummer en titel blijven", h54.status === 200 && h54.json.hymn.text === null && h54.json.hymn.unavailableReason === "license" && h54.json.hymn.title.length > 0);
const h86 = await get("/api/hymns/86");
check("beheerder: lofzang 86 met tekst maar zonder compositie", h86.status === 200 && h86.json.hymn.text.stanzas.length >= 2 && h86.json.hymn.composition === null);
const h999 = await get("/api/hymns/999");
check("lofzang 999 bestaat niet: 404", h999.status === 404);
const rec = await get("/api/hymns/recognition");
check("beheerder: herkenningsbundel", rec.status === 200 && rec.json.compositions.length > 100, `${rec.bytes} bytes, ${rec.json?.compositions.length} composities`);
const rep = await get("/api/hymns/report");
check("beheerder: kwaliteitsoverzicht met exacte aantallen", rep.status === 200 && rep.json.counts.official === 205 && Array.isArray(rep.json.incomplete), JSON.stringify(rep.json?.counts).slice(0, 160));
const recRes = await admin.request.get(`${BASE}/api/hymns/recognition`, { headers: { "Accept-Encoding": "gzip" } });
console.log(`HEADERS herkenning content-encoding=${recRes.headers()["content-encoding"] ?? "geen"} content-length=${recRes.headers()["content-length"] ?? "?"}`);
console.log(`GROOTTE index=${idx.bytes} hymn24=${h24.bytes} herkenning=${rec.bytes} rapport=${rep.bytes}`);

// ---------- lokale opslag: eerst online laden, daarna de API blokkeren
const page = await admin.newPage();
const apiHits = [];
page.on("request", (r) => { if (r.url().includes("/api/hymns/")) apiHits.push(new URL(r.url()).pathname); });
await page.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.locator("[data-hymn-number]").first().waitFor({ timeout: 60000 });
check("eerste bezoek: index opgehaald", apiHits.filter((p) => p === "/api/hymns/index").length === 1, JSON.stringify(apiHits));
await page.locator('[data-hymn-number="24"]').click();
await page.getByRole("button", { name: "Start luisteren", exact: true }).waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Andere lofzang", exact: true }).click();
await page.locator('[data-hymn-number="24"]').click();
await page.getByRole("button", { name: "Start luisteren", exact: true }).waitFor({ timeout: 20000 });
check("dezelfde lofzang twee keer openen: één verzoek (geheugen en lokale opslag)", apiHits.filter((p) => p === "/api/hymns/24").length === 1, JSON.stringify(apiHits));
await page.getByRole("button", { name: "Andere lofzang", exact: true }).click();
await page.getByRole("button", { name: "Start luisteren", exact: true }).click();
await page.locator("[data-hymns-recognition]").waitFor({ timeout: 20000 });
check("herkenningsgegevens worden bij het starten van de herkenning geladen", apiHits.includes("/api/hymns/recognition"), JSON.stringify(apiHits));
await page.waitForTimeout(500);

// IndexedDB zit per browsercontext; dezelfde context hergebruiken voor de herlaadtest
await admin.route("**/api/hymns/**", (route) => route.abort());
const page2 = await admin.newPage();
await page2.goto(`${BASE}/dev/lofzangen`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page2.locator("[data-hymn-number]").first().waitFor({ timeout: 30000 });
check("zonder API: de lijst komt uit de lokale opslag (205 lofzangen)", (await page2.locator("[data-hymn-number]").count()) === 205);
check("zonder API: de lijst meldt dat het de lokaal bewaarde lijst is", (await page2.getByText("lokaal bewaarde lijst").count()) === 1);
await page2.locator('[data-hymn-number="24"]').click();
await page2.getByRole("button", { name: "Start luisteren", exact: true }).waitFor({ timeout: 20000 });
check("zonder API: een eerder geopende lofzang is volledig bruikbaar", (await page2.locator("[data-hymns-scroll] p").count()) >= 8);
await page2.getByRole("button", { name: "Andere lofzang", exact: true }).click();
await page2.locator('[data-hymn-number="100"]').click();
await page2.locator("[data-hymns-choose] [role=alert]").waitFor({ timeout: 20000 });
check("zonder API: een niet eerder geopende lofzang geeft een nette foutmelding", /kon niet worden geladen/.test((await page2.locator("[data-hymns-choose] [role=alert]").first().textContent()) ?? ""));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gelukt`);
process.exit(failed.length ? 1 : 0);
