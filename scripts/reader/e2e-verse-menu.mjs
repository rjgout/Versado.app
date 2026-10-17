// Browsertest: aansluitende verzen, tikmenu en "Voorlezen vanaf vers" in de verslezer (Chromium-emulatie).
//   PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… PROMOTE_DB_URL=… AUDIT_BASE_URL=http://localhost:3130 node scripts/reader/e2e-verse-menu.mjs
// Vereist een geïsoleerde database met het Boek van Mormon (nooit productie). Zet tijdelijk audio op één hoofdstuk en herstelt dat.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3130";
const DB = process.env.PROMOTE_DB_URL;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(ok ? "OK  " : "FAIL", name, detail); };
const sql = (q) => execFileSync("psql", [DB, "-At", "-c", q]).toString().trim();
const chapter = (book, n) => sql(`select c.id from "Chapter" c join "Book" b on b.id=c."bookId" where b.name='${book}' and c.number=${n} limit 1`);
const TTS = chapter("1 Nephi", 1);
const REC = chapter("1 Nephi", 2);
const verseId = (chapterId, n) => sql(`select id from "Verse" where "chapterId"='${chapterId}' and number=${n}`);
const verseText = (chapterId, n) => sql(`select text from "Verse" where "chapterId"='${chapterId}' and number=${n}`);
const oldAudio = sql(`select coalesce("audioUrl",'') from "Chapter" where id='${REC}'`);
sql(`update "Chapter" set "audioUrl"='https://example.test/n2.mp3' where id='${REC}'`);
sql(`update "Verse" set "audioStart"=number*10 where "chapterId"='${REC}'`);

const STUBS = () => {
  const spoken = []; let queued = 0; const audio = []; let podcastStops = 0, cancels = 0;
  window.__t = { spoken, audio, get podcastStops() { return podcastStops; }, get cancels() { return cancels; } };
  window.addEventListener("jehovaapp:stop-podcast", () => { podcastStops += 1; });
  const synth = {
    speaking: false, paused: false, pending: false, onvoiceschanged: null,
    getVoices: () => [], pause() {}, resume() {},
    cancel() { cancels += 1; queued = 0; },
    speak(u) { spoken.push(u.text); if (queued++ === 0) setTimeout(() => u.onstart?.(), 0); },
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  const proto = HTMLMediaElement.prototype; const times = new WeakMap();
  Object.defineProperty(proto, "currentTime", { configurable: true, get() { return times.get(this) ?? 0; }, set(v) { times.set(this, v); } });
  proto.load = function () { setTimeout(() => this.onloadedmetadata?.(), 0); };
  proto.pause = function () {};
  proto.play = function () { audio.push({ src: this.src, at: this.currentTime }); return Promise.resolve(); };
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const email = `reader-${Date.now()}@example.test`;
  await ctx.request.post(`${BASE}/api/auth/register`, { data: { email, handle: `lezer ${Math.random().toString(36).slice(2, 6)}`, password: "Wachtwoord-123!" } });
  sql(`update "User" set "onboardingSeenAt"=now(), "avatarCharacterId"='sariah' where email='${email}'`);
  await ctx.request.post(`${BASE}/api/auth/login`, { data: { identifier: email, password: "Wachtwoord-123!" } });
  await ctx.addInitScript(STUBS);

  async function openReader(id, path = "lesson") {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/${path}/${id}`); await page.waitForSelector("#vers-3"); await page.waitForTimeout(800);
    return page;
  }
  const dialog = (page) => page.locator("dialog[data-annotation-dialog][open]");
  const tapVerse = async (page, n) => { await page.locator(`#vers-${n} p`).evaluate((el) => el.scrollIntoView({ block: "center" })); const r = await page.locator(`#vers-${n} p`).boundingBox(); await page.touchscreen.tap(r.x + r.width - 12, r.y + r.height - 6); };

  // ===== Indeling =====
  let page = await openReader(TTS);
  const count = await page.locator("[id^=vers-]").count();
  check("indeling: geen aparte actierij of puntjes per vers", (await page.locator("#vers-3 > :not(p)").count()) === 0 && (await page.locator("#vers-3 svg.lucide-ellipsis").count()) === 0 && !/Bladwijzer|Privénotitie/.test(await page.locator("#vers-3").innerText()));
  check("indeling: elk vers heeft één semantische versnummerknop", (await page.locator("[id^=vers-] button[data-annotation-trigger]").count()) === count);
  const gaps = await page.evaluate(() => [...document.querySelectorAll("[id^=vers-]")].slice(0, -1).map((el, i, all) => document.querySelectorAll("[id^=vers-]")[i + 1].getBoundingClientRect().top - el.getBoundingClientRect().bottom));
  check("indeling: opeenvolgende verzen hoogstens 8px uit elkaar", gaps.every((g) => g <= 8), `max ${Math.max(...gaps)}`);
  check("indeling: geen horizontale overflow op 390px", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const label = await page.locator("#vers-5 button[data-annotation-trigger]").getAttribute("aria-label");
  check("toegankelijkheid: versnummerknop heeft de naam 'Acties voor vers 5'", label === "Acties voor vers 5", String(label));
  check("toegankelijkheid: de verstekst staat als gewone tekst naast de knop", (await page.locator("#vers-5 p").innerText()).includes(verseText(TTS, 5).slice(0, 25)));

  // ===== Tikmenu =====
  await tapVerse(page, 5); await dialog(page).waitFor({ timeout: 3000 });
  check("tik: opent het menu van vers 5", await dialog(page).isVisible());
  check("tik: eerste actie is 'Voorlezen vanaf vers 5', dan bladwijzer", /Voorlezen vanaf vers 5/.test(await dialog(page).locator("button:not([aria-label='Sluiten'])").first().innerText()));
  const spokenBefore = await page.evaluate(() => window.__t.spoken.length);
  check("tik: alleen het menu openen start geen audio", spokenBefore === 0 && (await page.evaluate(() => window.__t.audio.length)) === 0);
  const put = page.waitForRequest((r) => r.url().includes("/api/annotations") && r.method() === "PUT");
  await dialog(page).locator("button[aria-pressed]").first().click();
  const body = (await put).postDataJSON();
  check("tik: de bladwijzer hoort bij vers 5", body.target?.verseId === verseId(TTS, 5), JSON.stringify(body.target));
  await page.waitForTimeout(500);
  check("tik: bladwijzermarkering bij het versnummer, zonder extra regel", (await page.locator("#vers-5 button svg").count()) >= 1);
  await dialog(page).locator("button[aria-label='Sluiten']").click(); await page.waitForTimeout(300);

  // ===== Voorlezen vanaf vers (computerstem) =====
  await tapVerse(page, 12); await dialog(page).waitFor();
  check("stem: menu openen pauzeert of start niets", (await page.evaluate(() => window.__t.spoken.length)) === 0 && (await page.evaluate(() => window.__t.cancels)) === 0);
  await dialog(page).locator("[data-annotation-read-aloud]").click();
  await page.waitForTimeout(500);
  let t = await page.evaluate(() => ({ s: window.__t.spoken.slice(), stops: window.__t.podcastStops }));
  check("stem: begint bij vers 12 en leest tot het einde van het hoofdstuk", t.s[0] === verseText(TTS, 12) && t.s.length === count - 11, `${t.s.length} van ${count - 11}`);
  check("stem: menu sluit na de keuze en podcast wordt gestopt", !(await dialog(page).count()) && t.stops === 1);
  check("stem: voorgelezen vers 12 krijgt de rustige markering", /ring-brand-300/.test((await page.locator("#vers-12").getAttribute("class")) ?? ""));
  // wissel van vers terwijl het voorlezen loopt
  await tapVerse(page, 3); await dialog(page).waitFor();
  const mid = await page.evaluate(() => window.__t.spoken.length);
  await page.waitForTimeout(300);
  check("wissel: menu openen tijdens voorlezen verandert niets aan de audio", mid === t.s.length && (await page.evaluate(() => window.__t.spoken.length)) === mid);
  await dialog(page).locator("[data-annotation-read-aloud]").click(); await page.waitForTimeout(400);
  t = await page.evaluate(() => ({ s: window.__t.spoken.slice(-1)[0], n: window.__t.spoken.length }));
  check("wissel: springt naar vers 3 en leest verder vanaf daar", t.s === verseText(TTS, 20) && t.n === mid + count - 2);

  // ===== Beveiliging tegen onbedoeld openen =====
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector("#vers-8 p")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.locator("#vers-9 p").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const r7 = await page.locator("#vers-9 p").boundingBox();
  await page.mouse.click(r7.x + 40, r7.y + 6); await page.waitForTimeout(300);
  check("selectie: een tik terwijl tekst geselecteerd is opent geen menu", (await dialog(page).count()) === 0);
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.locator("#vers-4 p").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const r4 = await page.locator("#vers-4 p").boundingBox();
  await page.mouse.move(r4.x + 30, r4.y + 6); await page.mouse.down(); await page.mouse.move(r4.x + 150, r4.y + 6, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
  check("selectie: slepen om tekst te selecteren opent geen menu en laat de selectie staan", (await dialog(page).count()) === 0 && (await page.evaluate(() => getSelection().toString().length)) > 0);
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.mouse.wheel(0, 300); await page.waitForTimeout(300);
  check("scrollen opent geen menu", (await dialog(page).count()) === 0);

  // ===== Toetsenbord =====
  await page.locator("#vers-6 button[data-annotation-trigger]").focus();
  await page.keyboard.press("Enter"); await dialog(page).waitFor();
  check("toetsenbord: Enter op het versnummer opent het menu precies één keer", (await page.locator("dialog[data-annotation-dialog]").count()) === 1);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  check("toetsenbord: Escape sluit en focus keert terug naar het versnummer", (await dialog(page).count()) === 0 && (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Acties voor vers 6");
  await page.keyboard.press("Space"); await dialog(page).waitFor();
  check("toetsenbord: Space opent het menu ook", await dialog(page).isVisible());
  await page.keyboard.press("Escape"); await page.close();

  // ===== Opgenomen audio, midden in de les =====
  page = await openReader(REC);
  await page.waitForTimeout(500);
  await tapVerse(page, 4); await dialog(page).waitFor();
  check("opname: voorleesactie is beschikbaar zodra de talen geladen zijn", await dialog(page).locator("[data-annotation-read-aloud]").isEnabled());
  await dialog(page).locator("[data-annotation-read-aloud]").click(); await page.waitForTimeout(500);
  const rec = await page.evaluate(() => ({ audio: window.__t.audio.slice(), spoken: window.__t.spoken.length }));
  check("opname: de opgenomen bron start op de begintijd van vers 4", rec.audio.length === 1 && rec.audio[0].src.endsWith("/n2.mp3") && rec.audio[0].at === 40 && rec.spoken === 0, JSON.stringify(rec));
  await page.close();

  // ===== Alleen lezen: geen acties =====
  page = await openReader(TTS, "scripture");
  check("preview: geen versknoppen en geen audioactie", (await page.locator("button[data-annotation-trigger]").count()) === 0);
  await page.locator("#vers-5 p").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const rp = await page.locator("#vers-5 p").boundingBox();
  await page.mouse.click(rp.x + rp.width - 12, rp.y + rp.height - 6); await page.waitForTimeout(300);
  check("preview: tikken op een vers opent niets", (await dialog(page).count()) === 0);
  await page.close();
} finally {
  sql(`update "Verse" set "audioStart"=null where "chapterId"='${REC}'`);
  sql(`update "Chapter" set "audioUrl"=${oldAudio ? `'${oldAudio}'` : "null"} where id='${REC}'`);
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks geslaagd`);
process.exit(failed.length ? 1 : 0);
