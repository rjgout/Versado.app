// Verslezer: aansluitende verzen, tikmenu en "Voorlezen vanaf vers". Eigen productiebuild en wegwerp-PostgreSQL
// (zie assertReferenceTestEnvironment: fail-closed). Alle hoofdstukken zijn synthetisch en worden zelf aangemaakt en verwijderd;
// bestaande audiogegevens worden nooit aangepast.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { SESSION_COOKIE } from "../src/lib/auth.ts";
import { referenceAccount, assertReferenceTestEnvironment } from "./fixtures/reference-content.mjs";
import { getT } from "../src/lib/i18n/index.ts";

const base = assertReferenceTestEnvironment();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const t = getT("nl");
const output = "/tmp/versado-reader-verse-menu-browser";
mkdirSync(output, { recursive: true });
const VERSES = 8;
const created = [];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(ok ? "OK  " : "FAIL", name, detail); assert.ok(ok, `${name} ${detail}`); };

async function chapterFixture(audio) {
  const book = await prisma.book.create({ data: { slug: `reader-menu-${randomUUID()}`, key: `bofm/reader-menu-${randomUUID().slice(0, 8)}`, name: "Lezertest", order: 900, contentCollectionId: "content_bom" } });
  const chapter = await prisma.chapter.create({
    data: {
      bookId: book.id, number: 1, order: 900, audioUrl: audio ? "https://example.test/reader-menu.mp3" : null,
      verses: { create: Array.from({ length: VERSES }, (_, i) => ({ number: i + 1, text: `Synthetisch vers ${i + 1} over een rustige lezer.`, audioStart: audio ? (i + 1) * 10 : null })) },
    },
    include: { verses: { orderBy: { number: "asc" } } },
  });
  created.push({ bookId: book.id, chapterId: chapter.id });
  return chapter;
}

// Vervangt spraak en audio door een logboek, zodat de test exact ziet wat er start.
const STUBS = () => {
  const spoken = []; const audio = []; let queued = 0, podcastStops = 0, cancels = 0;
  window.__t = { spoken, audio, get podcastStops() { return podcastStops; }, get cancels() { return cancels; } };
  window.addEventListener("jehovaapp:stop-podcast", () => { podcastStops += 1; });
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    speaking: false, paused: false, pending: false, onvoiceschanged: null, getVoices: () => [], pause() {}, resume() {},
    cancel() { cancels += 1; queued = 0; },
    speak(u) { spoken.push({ text: u.text, lang: u.lang }); if (queued++ === 0) setTimeout(() => u.onstart?.(), 0); },
  } });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  const proto = HTMLMediaElement.prototype; const times = new WeakMap();
  Object.defineProperty(proto, "currentTime", { configurable: true, get() { return times.get(this) ?? 0; }, set(v) { times.set(this, v); } });
  proto.load = function () { setTimeout(() => this.onloadedmetadata?.(), 0); };
  proto.pause = function () {};
  proto.play = function () { audio.push({ src: this.src, at: this.currentTime }); return Promise.resolve(); };
};

const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
try {
  const owner = await referenceAccount(false);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block" });
  await context.addCookies([{ name: SESSION_COOKIE, value: owner.token, url: base }]);
  await context.addInitScript(STUBS);
  const errors = [];
  const dialog = (page) => page.locator("dialog[data-annotation-dialog][open]");
  const tapVerse = async (page, n) => {
    await page.locator(`#vers-${n} p`).evaluate((el) => el.scrollIntoView({ block: "center" }));
    const r = await page.locator(`#vers-${n} p`).boundingBox();
    await page.touchscreen.tap(r.x + r.width - 12, r.y + r.height - 6);
  };
  const openReader = async (id, path = "lesson") => {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/${path}/${id}`);
    await page.waitForSelector("#vers-3");
    await page.waitForTimeout(600);
    return page;
  };
  const tts = await chapterFixture(false);
  const rec = await chapterFixture(true);
  const text = (c, n) => c.verses.find((v) => v.number === n).text;
  const readFrom = (n) => t("annotations.readFrom", { number: n });

  // ===== Indeling =====
  let page = await openReader(tts.id);
  check("indeling: geen aparte actierij of puntjes per vers", (await page.locator("#vers-3 > :not(p)").count()) === 0 && (await page.locator("#vers-3 svg.lucide-ellipsis").count()) === 0 && !/Bladwijzer|Privénotitie/.test(await page.locator("#vers-3").innerText()));
  check("indeling: elk vers heeft één semantische versnummerknop", (await page.locator("[id^=vers-] button[data-annotation-trigger]").count()) === VERSES);
  const gaps = await page.evaluate(() => { const rows = [...document.querySelectorAll("[id^=vers-]")]; return rows.slice(0, -1).map((el, i) => rows[i + 1].getBoundingClientRect().top - el.getBoundingClientRect().bottom); });
  check("indeling: opeenvolgende verzen hoogstens 8px uit elkaar", gaps.every((g) => g <= 8), `max ${Math.max(...gaps)}`);
  check("indeling: geen horizontale overflow op 390px", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addStyleTag({ content: "html{font-size:200%}" });
  check("indeling: geen horizontale overflow op 320px met 200% tekst", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 390, height: 844 });
  check("toegankelijkheid: versnummerknop heet 'Acties voor vers 5'", (await page.locator("#vers-5 button[data-annotation-trigger]").getAttribute("aria-label")) === t("annotations.verseActions", { number: 5 }));

  // ===== Tikmenu =====
  await tapVerse(page, 5); await dialog(page).waitFor({ timeout: 3000 });
  check("tik: eerste actie is 'Voorlezen vanaf vers 5'", (await dialog(page).locator("button:not([aria-label])").first().innerText()).includes(readFrom(5)));
  check("tik: alleen het menu openen start geen audio", (await page.evaluate(() => window.__t.spoken.length + window.__t.audio.length)) === 0);
  const put = page.waitForRequest((r) => r.url().includes("/api/annotations") && r.method() === "PUT");
  await dialog(page).locator("button[aria-pressed]").first().click();
  check("tik: de bladwijzer hoort bij vers 5", (await put).postDataJSON().target?.verseId === tts.verses[4].id);
  await page.waitForTimeout(500);
  await dialog(page).locator("button[aria-label]").first().click(); await page.waitForTimeout(300);

  // ===== Voorlezen vanaf vers (computerstem) =====
  await tapVerse(page, 4); await dialog(page).waitFor();
  check("stem: menu openen pauzeert of start niets", (await page.evaluate(() => window.__t.spoken.length + window.__t.cancels)) === 0);
  await dialog(page).locator("[data-annotation-read-aloud]").click(); await page.waitForTimeout(500);
  let state = await page.evaluate(() => ({ s: window.__t.spoken.map((x) => x.text), stops: window.__t.podcastStops }));
  check("stem: begint bij vers 4 en leest tot het einde van het hoofdstuk", state.s[0] === text(tts, 4) && state.s.length === VERSES - 3);
  check("stem: menu sluit na de keuze en podcast wordt gestopt", !(await dialog(page).count()) && state.stops === 1);
  check("stem: voorgelezen vers krijgt de rustige markering", /ring-brand-300/.test((await page.locator("#vers-4").getAttribute("class")) ?? ""));
  await tapVerse(page, 2); await dialog(page).waitFor();
  const mid = await page.evaluate(() => window.__t.spoken.length);
  check("wissel: menu openen tijdens voorlezen verandert niets aan de audio", mid === state.s.length);
  await dialog(page).locator("[data-annotation-read-aloud]").click(); await page.waitForTimeout(400);
  state = await page.evaluate(() => ({ last: window.__t.spoken.at(-1).text, n: window.__t.spoken.length }));
  check("wissel: springt naar vers 2 en leest verder vanaf daar", state.last === text(tts, VERSES) && state.n === mid + VERSES - 1);

  // ===== Selectie, slepen, scrollen =====
  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector("#vers-6 p")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.locator("#vers-7 p").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const r7 = await page.locator("#vers-7 p").boundingBox();
  await page.mouse.click(r7.x + 40, r7.y + 6); await page.waitForTimeout(300);
  check("selectie: een tik terwijl tekst geselecteerd is opent geen menu", (await dialog(page).count()) === 0);
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.locator("#vers-3 p").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const r3 = await page.locator("#vers-3 p").boundingBox();
  await page.mouse.move(r3.x + 30, r3.y + 6); await page.mouse.down(); await page.mouse.move(r3.x + 150, r3.y + 6, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
  check("selectie: slepen opent geen menu en laat de selectie staan", (await dialog(page).count()) === 0 && (await page.evaluate(() => getSelection().toString().length)) > 0);
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.mouse.wheel(0, 300); await page.waitForTimeout(300);
  check("scrollen opent geen menu", (await dialog(page).count()) === 0);

  // ===== Toetsenbord =====
  await page.locator("#vers-6 button[data-annotation-trigger]").focus();
  await page.keyboard.press("Enter"); await dialog(page).waitFor();
  check("toetsenbord: Enter opent het menu precies één keer", (await page.locator("dialog[data-annotation-dialog]").count()) === 1);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  check("toetsenbord: Escape sluit en focus keert terug naar het versnummer", (await dialog(page).count()) === 0 && (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === t("annotations.verseActions", { number: 6 }));
  await page.keyboard.press("Space"); await dialog(page).waitFor();
  check("toetsenbord: Space opent het menu ook", await dialog(page).isVisible());
  await page.keyboard.press("Escape"); await page.close();

  // ===== Onopgeslagen notitie beschermt de audioactie =====
  page = await openReader(tts.id);
  await tapVerse(page, 3); await dialog(page).waitFor();
  await dialog(page).locator("textarea:not([disabled])").waitFor();
  await dialog(page).locator("textarea").fill("Concept dat niet verloren mag gaan");
  await dialog(page).locator("[data-annotation-read-aloud]").click(); await page.waitForTimeout(300);
  check("notitie: audio vraagt eerst bevestiging en start nog niet", (await dialog(page).getByText(t("annotations.unsaved")).count()) === 1 && (await page.evaluate(() => window.__t.spoken.length)) === 0);
  await dialog(page).getByRole("button", { name: t("annotations.cancel"), exact: true }).click();
  check("notitie: annuleren laat tekst en sheet staan en start geen audio", (await dialog(page).locator("textarea").inputValue()) === "Concept dat niet verloren mag gaan" && (await page.evaluate(() => window.__t.spoken.length)) === 0);
  await dialog(page).locator("[data-annotation-read-aloud]").click();
  await dialog(page).getByRole("button", { name: t("annotations.discard"), exact: true }).click(); await page.waitForTimeout(400);
  state = await page.evaluate(() => window.__t.spoken.map((x) => x.text));
  check("notitie: na bewust verlaten start de audio bij vers 3 en sluit de sheet", state[0] === text(tts, 3) && !(await dialog(page).count()));
  await page.evaluate(() => window.speechSynthesis.cancel());

  // ===== Lopende en onzekere mutatie =====
  await tapVerse(page, 5); await dialog(page).waitFor();
  await dialog(page).locator("textarea:not([disabled])").waitFor();
  const sent = [];
  let attempts = 0;
  await page.route("**/api/annotations", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    sent.push(route.request().postDataJSON().actionId);
    attempts += 1;
    if (attempts === 1) { await new Promise((r) => setTimeout(r, 1200)); return route.abort(); }
    return route.continue();
  });
  await dialog(page).locator("textarea").fill("Onzekere notitie");
  await dialog(page).getByRole("button", { name: t("annotations.save"), exact: true }).click();
  check("mutatie: tijdens het opslaan is de audioactie uitgeschakeld", await dialog(page).locator("[data-annotation-read-aloud]").isDisabled());
  await dialog(page).getByRole("button", { name: t("annotations.retry"), exact: true }).waitFor();
  check("mutatie: na een onzekere opslag blijft audio uitgeschakeld", await dialog(page).locator("[data-annotation-read-aloud]").isDisabled());
  await dialog(page).getByRole("button", { name: t("annotations.retry"), exact: true }).click();
  await dialog(page).getByText(t("annotations.saved")).waitFor();
  check("mutatie: herstel hergebruikt dezelfde actionId", sent.length === 2 && sent[0] === sent[1]);
  check("mutatie: na herstel is audio weer beschikbaar", await dialog(page).locator("[data-annotation-read-aloud]").isEnabled());
  await page.unroute("**/api/annotations");
  await page.close();

  // ===== Mislukte audiotalen: geen stilzwijgende taalwissel =====
  const editions = (verses) => ({ editions: [{ language: "en", url: "https://example.test/en.mp3", verses: verses.map((v) => ({ number: v.number, text: `English verse ${v.number}`, audioStart: v.number * 7 })) }] });
  await context.addInitScript(() => { try { localStorage.setItem("jehovaapp-read-aloud-language", "en"); } catch {} });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  let languageCalls = 0;
  await page.route("**/audio-languages", (route) => {
    languageCalls += 1;
    if (languageCalls === 1) return route.abort();
    return route.fulfill({ json: editions(tts.verses) });
  });
  await page.goto(`${base}/lesson/${tts.id}`);
  await page.waitForSelector("#vers-3");
  await page.waitForTimeout(600);
  await tapVerse(page, 3); await dialog(page).waitFor();
  check("taal: mislukte opvraag schakelt de audioactie niet in", await dialog(page).locator("[data-annotation-read-aloud]").isDisabled() && (await dialog(page).getByText(t("annotations.audioFailed")).count()) === 1);
  await dialog(page).locator("[data-annotation-read-aloud]").click({ force: true, timeout: 500 }).catch(() => {});
  check("taal: geen spraak in een andere taal gestart", (await page.evaluate(() => window.__t.spoken.length + window.__t.audio.length)) === 0);
  await dialog(page).getByRole("button", { name: t("player.retryLanguages"), exact: true }).click();
  await page.waitForFunction(() => { const b = document.querySelector("dialog[open] [data-annotation-read-aloud]"); return b && !b.disabled; });
  check("taal: na herstel is de actie beschikbaar", languageCalls === 2);
  await dialog(page).locator("[data-annotation-read-aloud]").click(); await page.waitForTimeout(500);
  state = await page.evaluate(() => ({ spoken: window.__t.spoken.map((x) => ({ text: x.text, lang: x.lang })), audio: window.__t.audio }));
  check("taal: start na herstel bij vers 3 in de bewust gekozen taal (Engels)", state.spoken[0]?.text === "English verse 3" || (state.audio.length === 1 && state.audio[0].src.endsWith("/en.mp3") && state.audio[0].at === 21), JSON.stringify(state));
  await page.close();

  // ===== Opgenomen audio midden in de les =====
  const clean = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block" });
  await clean.addCookies([{ name: SESSION_COOKIE, value: owner.token, url: base }]);
  await clean.addInitScript(STUBS);
  page = await clean.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/lesson/${rec.id}`); await page.waitForSelector("#vers-3"); await page.waitForTimeout(600);
  await tapVerse(page, 4); await dialog(page).waitFor();
  await page.waitForFunction(() => { const b = document.querySelector("dialog[open] [data-annotation-read-aloud]"); return b && !b.disabled; });
  await dialog(page).locator("[data-annotation-read-aloud]").click(); await page.waitForTimeout(500);
  state = await page.evaluate(() => ({ audio: window.__t.audio.slice(), spoken: window.__t.spoken.length }));
  check("opname: de opgenomen bron start op de begintijd van vers 4", state.audio.length === 1 && state.audio[0].src.endsWith("/reader-menu.mp3") && state.audio[0].at === 40 && state.spoken === 0, JSON.stringify(state));
  await page.close();

  // ===== Alleen lezen: geen acties =====
  page = await openReader(tts.id, "scripture");
  check("preview: geen versknoppen en geen audioactie", (await page.locator("button[data-annotation-trigger]").count()) === 0);
  await page.locator("#vers-5 p").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const rp = await page.locator("#vers-5 p").boundingBox();
  await page.mouse.click(rp.x + rp.width - 12, rp.y + rp.height - 6); await page.waitForTimeout(300);
  check("preview: tikken op een vers opent niets", (await dialog(page).count()) === 0);
  await page.screenshot({ path: `${output}/preview.png` });
  check("geen paginafouten", errors.length === 0, errors.join("|"));
  console.log(`\n${results.length}/${results.length} checks geslaagd`);
} finally {
  for (const { bookId, chapterId } of created) {
    const ids = (await prisma.verse.findMany({ where: { chapterId }, select: { id: true } })).map((v) => v.id);
    await prisma.bookmark.deleteMany({ where: { verseId: { in: ids } } });
    await prisma.note.deleteMany({ where: { verseId: { in: ids } } });
    await prisma.highlight.deleteMany({ where: { verseId: { in: ids } } });
    await prisma.verse.deleteMany({ where: { chapterId } });
    await prisma.chapter.delete({ where: { id: chapterId } });
    await prisma.book.delete({ where: { id: bookId } });
  }
  await browser.close();
  await prisma.$disconnect();
}
