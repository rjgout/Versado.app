// Fase 4C: Mijn studiemap in een echte browser. Eigen productiebuild en wegwerp-PostgreSQL; alle gegevens zijn synthetisch.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { SESSION_COOKIE } from "../src/lib/auth.ts";
import { mutateAnnotation } from "../src/lib/annotations/service.ts";
import { passageBlocks } from "../src/lib/annotations/contract.ts";
import { referenceFixture, referenceAccount, assertReferenceTestEnvironment } from "./fixtures/reference-content.mjs";
import { getT } from "../src/lib/i18n/index.ts";

const base = assertReferenceTestEnvironment();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const output = "/tmp/versado-study-folder-browser";
mkdirSync(output, { recursive: true });
const t = getT("nl");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(ok ? "OK  " : "FAIL", name, detail); assert.ok(ok, `${name} ${detail}`); };
const created = [];
const command = (kind, target, expectedVersion = 0, extra = {}) => ({ kind, target, expectedVersion, actionId: randomUUID(), ...(kind === "note" ? { text: "Privénotitie" } : {}), ...extra });
async function chapter(collectionId, name, key, count) {
  const book = await prisma.book.create({ data: { slug: `sf-${randomUUID()}`, key, name, order: 810, contentCollectionId: collectionId } });
  const row = await prisma.chapter.create({
    data: { bookId: book.id, number: 1, order: 810, verses: { create: Array.from({ length: count }, (_, i) => ({ number: i + 1, text: `Synthetisch studiemapvers ${i + 1} van ${name}.` })) } },
    include: { verses: { orderBy: { number: "asc" } } },
  });
  created.push({ bookId: book.id, chapterId: row.id });
  return row;
}

const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
try {
  const f = await referenceFixture();
  const owner = f.owner, stranger = await referenceAccount();
  const longNote = "Een heel lange notitie zonder spaties: " + "Abcdefghijklmnopqrstuvwxyz".repeat(8) + "\n" + "Tweede regel met veel woorden. ".repeat(12);
  const small = await chapter("content_bom", "Studiemapboek", `bofm/sf-${randomUUID().slice(0, 6)}`, 8);
  const many = await chapter("content_bom", "Veelboek", `bofm/sf-many-${randomUUID().slice(0, 6)}`, 70);
  const hidden = await chapter("content_dc", "Verborgen boek", `dc-testament/sf-${randomUUID().slice(0, 6)}`, 2);
  const block = passageBlocks(f.dto.lesson.body, f.dto.lesson.body.sections[0].id)[0];
  const lessonTarget = { type: "lesson", lessonEditionId: f.item.lessonEditionId, revisionId: f.item.revisionId, selector: { normalizationVersion: 1, originalRevisionId: f.item.revisionId, sectionAnchor: f.dto.lesson.body.sections[0].id, ranges: [{ blockId: block.id, start: 0, end: [...block.text].length }], exact: block.text, prefix: "", suffix: "" } };
  const verseNote = await mutateAnnotation(owner.actor, command("note", { type: "verse", verseId: small.verses[2].id }, 0, { text: longNote }));
  await mutateAnnotation(owner.actor, command("highlight", { type: "verse", verseId: small.verses[1].id }, 0, { color: "green" }));
  const bookmarkSmall = await mutateAnnotation(owner.actor, command("bookmark", { type: "verse", verseId: small.verses[0].id }));
  const lessonNote = await mutateAnnotation(owner.actor, command("note", lessonTarget, 0, { text: "Notitie bij de studiepassage" }));
  await prisma.bookmark.create({ data: { userId: owner.user.id, verseId: hidden.verses[0].id, targetKey: `verse:${hidden.verses[0].id}` } });
  const now = Date.now();
  await prisma.bookmark.createMany({ data: many.verses.slice(0, 60).map((v, i) => ({ userId: owner.user.id, verseId: v.id, targetKey: `verse:${v.id}`, createdAt: new Date(now - 86_400_000 - i * 1000) })) });

  const open = async (viewport = { width: 390, height: 844 }, { who = owner, scheme = "light", touch = true } = {}) => {
    const context = await browser.newContext({ viewport, serviceWorkers: "block", colorScheme: scheme, hasTouch: touch });
    await context.addCookies([{ name: SESSION_COOKIE, value: who.token, url: base }]);
    return context;
  };
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const errors = [];

  // ===== Contentkiezer =====
  let context = await open(), page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/content`);
  await page.locator("[data-study-folder-link]").waitFor();
  const order = await page.evaluate(() => {
    const root = document.querySelector("[data-content-picker]");
    const kids = [...root.children].map((el) => el.getAttribute("data-content-group") ?? (el.hasAttribute("data-study-folder-entry") ? "study-folder" : el.hasAttribute("data-content-language") ? "language" : el.hasAttribute("data-admin-content-link") ? "admin" : "other"));
    return kids.filter((k) => k !== "other");
  });
  const idx = (name) => order.indexOf(name);
  check("kiezer: Mijn studiemap staat na alle contentgroepen en direct vóór de taalkeuze", idx("study-folder") > idx("studyPrograms") && idx("study-folder") === idx("language") - 1, JSON.stringify(order));
  check("kiezer: de kaart is een gewone interne link", (await page.locator("[data-study-folder-link]").evaluate((a) => a.tagName === "A" && a.getAttribute("href") === "/study-folder")));
  const box = await page.locator("[data-study-folder-link]").boundingBox();
  check("kiezer: aanraakhoogte minimaal 44px en geen horizontale overflow", box.height >= 44 && await noOverflow(page));
  const before = await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } });
  const selectionRequests = [];
  page.on("request", (r) => { if (r.method() !== "GET" && r.url().includes("/api/content-context")) selectionRequests.push(r.url()); });
  await page.locator("[data-study-folder-link]").click();
  await page.waitForURL(`${base}/study-folder`);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } });
  check("kiezer: de kaart wijzigt actieve collectie, taal en context niet", before.activeContentCollectionId === after.activeContentCollectionId && before.contentLanguage === after.contentLanguage && selectionRequests.length === 0);
  await page.getByRole("button", { name: t("common.back") }).click();
  await page.waitForURL(`${base}/content`);
  check("kiezer: terug uit de map brengt de gebruiker naar de contentkiezer", true);
  for (const collection of ["content_bom", "content_bom_en", f.collection.id]) {
    await prisma.user.update({ where: { id: owner.user.id }, data: { activeContentCollectionId: collection } });
    await page.goto(`${base}/content`);
    check(`kiezer: de kaart blijft zichtbaar bij actieve bron ${collection.slice(0, 18)}`, await page.locator("[data-study-folder-link]").isVisible());
  }
  await prisma.user.update({ where: { id: owner.user.id }, data: { activeContentCollectionId: f.collection.id } });
  await page.goto(`${base}/study-folder`);
  const direct = await page.getByRole("button", { name: t("common.back") }).click().then(() => page.waitForURL(`${base}/content`).then(() => true).catch(() => false));
  check("kiezer: direct geopende map gaat terug naar /content (fallback)", direct);

  // ===== Leren, Hulpmiddelen en oude links =====
  await page.goto(`${base}/courses`);
  check("leren: geen studiemapkaart op /courses", (await page.locator('a[href^="/study-folder"]').count()) === 0);
  await page.goto(`${base}/tools`);
  check("hulpmiddelen: geen Bladwijzers- of studiemaptegel op /tools", (await page.locator('a[href="/bookmarks"], a[href^="/study-folder"]').count()) === 0);
  await page.goto(`${base}/bookmarks`);
  await page.waitForURL(`${base}/study-folder?type=bookmark`);
  await page.locator("[data-folder-item]").first().waitFor();
  check("oude /bookmarks-link toont alleen bladwijzers in Mijn studiemap", (await page.locator("[data-folder-item]").evaluateAll((els) => els.every((e) => e.getAttribute("data-folder-item").startsWith("bookmark:")))));
  check("bladwijzerfilter is zichtbaar actief", (await page.locator('[data-folder-type="bookmark"]').getAttribute("aria-pressed")) === "true");

  // ===== Lijst, zoeken, filters en URL =====
  await page.goto(`${base}/study-folder`);
  await page.locator("[data-folder-item]").first().waitFor();
  check("lijst: standaard alle soorten en 25 per pagina", (await page.locator("[data-folder-item]").count()) === 25);
  const kinds = await page.locator("[data-folder-item]").evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute("data-folder-item").split(":")[0]));
  check("lijst: nieuwste eerst (de ontoegankelijke bladwijzer is het laatst gemaakt, daarna de studienotitie)", (await page.locator("[data-folder-item]").first().innerText()).includes(t("studyFolder.sourceUnavailable")) && kinds[1] === "note" && (await page.locator("[data-folder-item]").nth(1).getAttribute("data-folder-item")) === `note:${lessonNote.annotation.id}`, kinds.join(","));
  await page.locator("[data-folder-more]").click();
  await page.waitForFunction(() => document.querySelectorAll("[data-folder-item]").length > 25);
  const ids = await page.locator("[data-folder-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-folder-item")));
  check("lijst: meer laden voegt toe zonder dubbelen", ids.length === 50 && new Set(ids).size === ids.length, String(ids.length));
  while (await page.locator("[data-folder-more]").count()) { await page.locator("[data-folder-more]").click(); await page.waitForTimeout(250); }
  check("lijst: alle annotaties zijn uiteindelijk bereikbaar", (await page.locator("[data-folder-item]").count()) === 60 + 4 + 1);
  const requests = [];
  page.on("request", (r) => { if (r.url().includes("/api/study-folder") && r.url().includes("q=")) requests.push(r.url()); });
  await page.locator('input[type="search"]').fill("");
  await page.locator('input[type="search"]').pressSequentially("studiepassage", { delay: 30 });
  await page.waitForURL(/q=studiepassage/);
  await page.waitForFunction(() => document.querySelectorAll("[data-folder-item]").length === 1);
  check("zoeken: één rustig request voor de eindterm (debounce)", requests.length <= 2 && requests.at(-1).includes("q=studiepassage"), String(requests.length));
  check("zoeken: de term staat in de URL en blijft na herladen", (await (async () => { await page.reload(); await page.locator("[data-folder-item]").first().waitFor(); return (await page.locator('input[type="search"]').inputValue()) === "studiepassage" && (await page.locator("[data-folder-item]").count()) === 1; })()));
  await page.locator('input[type="search"]').fill("");
  await page.waitForFunction(() => !location.search.includes("q="));
  await page.locator('[data-folder-type="note"]').click();
  await page.waitForURL(/type=note/);
  await page.waitForFunction(() => document.querySelectorAll("[data-folder-item]").length === 2);
  check("filter: notities geven alleen notities", (await page.locator("[data-folder-item]").evaluateAll((els) => els.every((e) => e.getAttribute("data-folder-item").startsWith("note:")))));
  await page.locator("[data-folder-source]").selectOption(f.collection.id);
  await page.waitForFunction(() => document.querySelectorAll("[data-folder-item]").length === 1);
  check("filter: bron levert alleen annotaties van die bron", (await page.locator("[data-folder-item]").first().getAttribute("data-folder-item")) === `note:${lessonNote.annotation.id}`);
  check("filter: een verborgen bron staat niet in de bronlijst", !(await page.locator("[data-folder-source] option").allInnerTexts()).some((text) => /Verborgen|Leer en Verbonden/.test(text)));
  await page.locator('input[type="search"]').fill("bestaatniet");
  await page.waitForSelector("[data-folder-empty]");
  check("zoeken: geen resultaten toont een rustige lege staat met filters wissen", (await page.getByRole("button", { name: t("studyFolder.clearFilters") }).count()) === 1);
  await page.getByRole("button", { name: t("studyFolder.clearFilters") }).click();
  await page.waitForFunction(() => location.search === "");

  // ===== Kaarten =====
  await page.goto(`${base}/study-folder?type=note`);
  await page.locator("[data-folder-item]").first().waitFor();
  const noteCard = page.locator(`[data-folder-item="note:${verseNote.annotation.id}"]`);
  check("kaart: lange notitie breekt af en geeft geen horizontale overflow", (await noteCard.innerText()).includes("Tweede regel") && await noOverflow(page));
  check("kaart: bronlabel, kleur-/soortlabel en datum zijn zichtbaar", /Studiemapboek 1:3/.test(await noteCard.innerText()) && (await noteCard.locator("time").count()) === 1);
  await page.goto(`${base}/study-folder`);
  await page.locator("[data-folder-item]").first().waitFor();
  const unavailable = page.locator("[data-folder-item]", { hasText: t("studyFolder.sourceUnavailable") });
  check("kaart: ontoegankelijke bron toont 'Bron niet beschikbaar' zonder Open-link of bronnaam", (await unavailable.count()) >= 1 && (await unavailable.first().locator("[data-folder-open]").count()) === 0 && !/Verborgen boek|Leer en Verbonden/.test(await unavailable.first().innerText()));
  check("kaart: ontoegankelijke bron blijft bewerkbaar of verwijderbaar", (await unavailable.first().locator("[data-folder-edit]").count()) === 1);

  // ===== Vers openen en terugkeren met filters =====
  await page.goto(`${base}/study-folder?type=note&q=Abcdefghijklmnop`);
  await page.locator("[data-folder-item]").first().waitFor();
  await page.locator(`[data-folder-item="note:${verseNote.annotation.id}"] [data-folder-open]`).click();
  await page.waitForURL(/\/lesson\/.+\?vers=3/);
  await page.locator("#vers-3").waitFor();
  await page.waitForTimeout(1200);
  const placement = await page.evaluate(() => { const r = document.querySelector("#vers-3").getBoundingClientRect(); const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) || 0; return { top: r.top, bottom: r.bottom, header, vh: innerHeight }; });
  check("vers: het exacte vers staat zichtbaar onder de vaste header", placement.top >= placement.header - 1 && placement.bottom <= placement.vh + 1, JSON.stringify(placement));
  check("vers: er opent niet vanzelf een annotatiesheet", (await page.locator("dialog[open]").count()) === 0);
  check("vers: de terugbalk noemt Mijn studiemap", /Mijn studiemap/.test(await page.locator("[data-subpage-back-bar]").innerText()));
  await page.getByRole("button", { name: t("common.back") }).click();
  await page.waitForURL(/\/study-folder\?type=note&q=Abcdefghijklmnop/);
  await page.locator("[data-folder-item]").first().waitFor();
  check("terug: filters en zoekterm blijven behouden", (await page.locator('input[type="search"]').inputValue()) === "Abcdefghijklmnop" && (await page.locator('[data-folder-type="note"]').getAttribute("aria-pressed")) === "true");
  // Direct geopend zonder geschiedenis: terug gaat naar de map met dezelfde filters.
  const fresh = await context.newPage();
  const href = await page.locator(`[data-folder-item="note:${verseNote.annotation.id}"] [data-folder-open]`).getAttribute("href");
  await fresh.goto(`${base}${href}`);
  await fresh.locator("#vers-3").waitFor();
  await fresh.getByRole("button", { name: t("common.back") }).click();
  await fresh.waitForURL(/\/study-folder\?type=note&q=Abcdefghijklmnop/);
  check("terug zonder geschiedenis: gaat naar de map met dezelfde filters", true);
  await fresh.close();

  // ===== Studiepassage openen =====
  await page.goto(`${base}/study-folder?q=studiepassage`);
  await page.locator("[data-folder-item]").first().waitFor();
  await page.locator(`[data-folder-item="note:${lessonNote.annotation.id}"] [data-folder-open]`).click();
  await page.waitForURL(/\/study-lesson\//);
  await page.locator("[data-study-reader-body]").waitFor();
  await page.waitForFunction(() => document.querySelector("[data-annotation-focus]"), null, { timeout: 8000 });
  const focused = await page.evaluate(() => { const el = document.querySelector("[data-annotation-focus]"); const r = el.getBoundingClientRect(); return { inView: r.bottom > 0 && r.top < innerHeight, text: el.textContent.slice(0, 20) }; });
  check("studiepassage: de exacte passage wordt gemarkeerd en is zichtbaar", focused.inView && block.text.startsWith(focused.text.trim().slice(0, 10)), JSON.stringify(focused));
  check("studiepassage: geen waarschuwing bij de exacte revisie", (await page.locator("[data-annotation-focus-note]").count()) === 0);
  await page.waitForFunction(() => !document.querySelector("[data-annotation-focus]"), null, { timeout: 8000 });
  check("studiepassage: de markering verdwijnt rustig weer", true);
  await page.getByRole("button", { name: t("common.back") }).click();
  await page.waitForURL(/\/study-folder\?q=studiepassage/);
  check("studiepassage: terug naar de map met de zoekterm", true);

  // ===== Bewerken en verwijderen vanuit de map =====
  await page.goto(`${base}/study-folder?type=note&source=${encodeURIComponent(f.collection.id)}`);
  await page.locator("[data-folder-item]").first().waitFor();
  await page.locator("[data-folder-edit]").first().click();
  const dialog = page.locator("dialog[data-annotation-dialog][open]");
  await dialog.locator("textarea:not([disabled])").waitFor();
  check("bewerken: de bestaande notitie staat in de sheet", (await dialog.locator("textarea").inputValue()) === "Notitie bij de studiepassage");
  await dialog.locator("textarea").fill("Bijgewerkt vanuit de map");
  await dialog.getByRole("button", { name: t("annotations.save"), exact: true }).click();
  await dialog.getByText(t("annotations.saved")).waitFor();
  await dialog.getByRole("button", { name: t("annotations.close") }).click();
  await page.getByText("Bijgewerkt vanuit de map").waitFor();
  check("bewerken: de lijst ververst na annotationsChanged", true);
  await page.goto(`${base}/study-folder?type=bookmark&source=content_bom`);
  await page.locator("[data-folder-item]").first().waitFor();
  const target = page.locator(`[data-folder-item="bookmark:${bookmarkSmall.annotation.id}"]`);
  await target.locator("[data-folder-edit]").click();
  await dialog.locator("button[aria-pressed]").first().click();
  await dialog.getByText(t("annotations.saved")).waitFor();
  await dialog.getByRole("button", { name: t("annotations.close") }).click();
  await page.waitForFunction((id) => !document.querySelector(`[data-folder-item="bookmark:${id}"]`), bookmarkSmall.annotation.id);
  check("verwijderen: de bladwijzer verdwijnt uit de lijst", true);
  const row = await prisma.bookmark.findUniqueOrThrow({ where: { id: bookmarkSmall.annotation.id } });
  check("verwijderen: een tombstone blijft bewaard, geen harde delete", row.deletedAt !== null);

  // ===== Revisie vervangen =====
  await f.publish("updated");
  await page.goto(`${base}/study-folder?type=note&source=${encodeURIComponent(f.collection.id)}`);
  await page.locator("[data-folder-item]").first().waitFor();
  const changed = page.locator(`[data-folder-item="note:${lessonNote.annotation.id}"]`);
  check("revisie: bewezen exact anker, kaart meldt 'Passage gevonden' en toont de oorspronkelijke quote", /Passage gevonden/.test(await changed.innerText()) && (await changed.locator("blockquote").count()) === 1);
  await changed.locator("[data-folder-open]").click();
  await page.waitForURL(/\/study-lesson\//);
  await page.waitForFunction(() => document.querySelector("[data-annotation-focus]"), null, { timeout: 8000 });
  check("revisie: de reader focust de teruggevonden passage zonder waarschuwing", (await page.locator("[data-annotation-focus-note]").count()) === 0 && (await page.locator("[data-annotation-recovery]").count()) === 0);

  // ===== Deeplink naar één annotatie =====
  await page.goto(`${base}/study-folder?item=note:${verseNote.annotation.id}`);
  await page.locator("[data-folder-focus] article").waitFor();
  check("item: eigen annotatie opent rechtstreeks", /Abcdefghijkl/.test(await page.locator("[data-folder-focus]").innerText()));
  const sc = await open({ width: 390, height: 844 }, { who: stranger });
  const sp = await sc.newPage();
  await sp.goto(`${base}/study-folder?item=note:${verseNote.annotation.id}`);
  await sp.locator("[data-folder-focus]").waitFor();
  await sp.waitForTimeout(800);
  check("item: andermans annotatie toont alleen een rustige melding en geen inhoud", (await sp.locator("[data-folder-focus]").innerText()).includes(t("studyFolder.itemGone")) && !(await sp.content()).includes("Abcdefghijkl"));
  await sc.close();
  const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } });
  check("geen automatische content- of taalwissel tijdens het hele traject", unchanged.activeContentCollectionId === f.collection.id && unchanged.contentLanguage === before.contentLanguage);
  await context.close();

  // ===== Latere pagina's, late responses en een direct geopend item =====
  const pager = await chapter("content_bom", "Pagineerboek", `bofm/sf-pager-${randomUUID().slice(0, 6)}`, 70);
  async function seedPager() {
    const account = await referenceAccount();
    const stamp = Date.now() - 3_600_000;
    await prisma.bookmark.createMany({ data: pager.verses.map((v, i) => ({ userId: account.user.id, verseId: v.id, targetKey: `verse:${v.id}`, createdAt: new Date(stamp - i * 1000) })) });
    await prisma.note.createMany({ data: pager.verses.map((v, i) => ({ userId: account.user.id, verseId: v.id, targetKey: `verse:${v.id}`, text: `Pagineernotitie ${String(i + 1).padStart(2, "0")}`, createdAt: new Date(stamp - i * 1000) })) });
    const bookmarks = await prisma.bookmark.findMany({ where: { userId: account.user.id }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    const notes = await prisma.note.findMany({ where: { userId: account.user.id }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    return { account, bookmarks, notes };
  }
  const itemIds = (p) => p.locator("[data-folder-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-folder-item")));
  const unique = (pageIds) => new Set(pageIds).size === pageIds.length;
  const dlg = (p) => p.locator("dialog[data-annotation-dialog][open]");
  async function loadPages(p, count) {
    for (let n = 25; n < count; n += 25) {
      const expected = Math.min(n + 25, 70);
      await p.locator("[data-folder-more]").click();
      await p.waitForFunction((want) => document.querySelectorAll("[data-folder-item]").length >= want, expected);
    }
  }
  async function removeBookmarkVia(p, id) {
    await p.locator(`[data-folder-item="bookmark:${id}"] [data-folder-edit]`).click();
    await dlg(p).locator("button[aria-pressed]").first().click();
    await dlg(p).getByText(t("annotations.saved")).waitFor();
    await dlg(p).getByRole("button", { name: t("annotations.close") }).click();
  }

  // Bladwijzer op pagina 3 verwijderen: na de bevestigde mutatie niet meer zichtbaar, filter blijft, geen dubbelen.
  let seeded = await seedPager();
  let pc = await open({ width: 390, height: 844 }, { who: seeded.account }), pp = await pc.newPage();
  pp.on("pageerror", (e) => errors.push(e.message));
  await pp.goto(`${base}/study-folder?type=bookmark`);
  await pp.locator("[data-folder-item]").first().waitFor();
  await loadPages(pp, 70);
  let pageIds = await itemIds(pp);
  check("pagina's: drie pagina's geladen (70 bladwijzers) zonder dubbelen", pageIds.length === 70 && unique(pageIds));
  const victim = seeded.bookmarks[60];
  check("pagina's: het te verwijderen item staat op pagina 3", pageIds.indexOf(`bookmark:${victim.id}`) >= 50);
  await removeBookmarkVia(pp, victim.id);
  await pp.waitForFunction((id) => !document.querySelector(`[data-folder-item="bookmark:${id}"]`), victim.id);
  check("pagina's: het verwijderde item blijft na de bevestigde mutatie niet staan", true);
  check("pagina's: zoekterm en filters blijven behouden", pp.url().includes("type=bookmark") && (await pp.locator('[data-folder-type="bookmark"]').getAttribute("aria-pressed")) === "true");
  await pp.waitForTimeout(600);
  while (await pp.locator("[data-folder-more]").count()) { await pp.locator("[data-folder-more]").click(); await pp.waitForTimeout(300); }
  pageIds = await itemIds(pp);
  check("pagina's: opnieuw laden geeft 69 unieke items zonder het verwijderde", pageIds.length === 69 && unique(pageIds) && !pageIds.includes(`bookmark:${victim.id}`), String(pageIds.length));
  await pc.close();

  // Gewijzigde privénotitie op een later geladen pagina.
  seeded = await seedPager();
  pc = await open({ width: 390, height: 844 }, { who: seeded.account }); pp = await pc.newPage();
  await pp.goto(`${base}/study-folder?type=note`);
  await pp.locator("[data-folder-item]").first().waitFor();
  await loadPages(pp, 70);
  const noteVictim = seeded.notes[60];
  const oldText = noteVictim.text;
  check("pagina's: de te wijzigen notitie staat op een later geladen pagina", (await itemIds(pp)).indexOf(`note:${noteVictim.id}`) >= 50);
  await pp.locator(`[data-folder-item="note:${noteVictim.id}"] [data-folder-edit]`).click();
  await dlg(pp).locator("textarea:not([disabled])").waitFor();
  await dlg(pp).locator("textarea").fill("Gewijzigd op pagina drie");
  await dlg(pp).getByRole("button", { name: t("annotations.save"), exact: true }).click();
  await dlg(pp).getByText(t("annotations.saved")).waitFor();
  await dlg(pp).getByRole("button", { name: t("annotations.close") }).click();
  await pp.waitForTimeout(800);
  while (await pp.locator("[data-folder-more]").count()) { await pp.locator("[data-folder-more]").click(); await pp.waitForTimeout(300); }
  pageIds = await itemIds(pp);
  const body = await pp.locator("[data-study-folder]").innerText();
  check("pagina's: de gewijzigde notitie toont de nieuwe tekst, niet de oude, zonder dubbelen", pageIds.length === 70 && unique(pageIds) && body.includes("Gewijzigd op pagina drie") && !body.includes(oldText), `${pageIds.length}`);
  check("pagina's: het notitiefilter blijft behouden", pp.url().includes("type=note"));
  await pc.close();

  // Een late response mag de vernieuwde lijst niet vervuilen.
  seeded = await seedPager();
  pc = await open({ width: 390, height: 844 }, { who: seeded.account }); pp = await pc.newPage();
  await pp.goto(`${base}/study-folder?type=bookmark`);
  await pp.locator("[data-folder-item]").first().waitFor();
  await loadPages(pp, 50);
  check("late response: pagina 1 en 2 staan er (50 items)", (await itemIds(pp)).length === 50);
  await pp.route(/\/api\/study-folder\?.*cursor=/, async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 3500));
    await route.fulfill({ response });
  });
  await pp.locator("[data-folder-more]").click();
  await pp.waitForTimeout(500);
  const onPageTwo = seeded.bookmarks[30];
  await removeBookmarkVia(pp, onPageTwo.id);
  await pp.waitForFunction((id) => !document.querySelector(`[data-folder-item="bookmark:${id}"]`), onPageTwo.id);
  await pp.waitForTimeout(4500);
  pageIds = await itemIds(pp);
  check("late response: het oude antwoord voegt na de mutatie geen items toe", pageIds.length === 25 && unique(pageIds) && !pageIds.includes(`bookmark:${onPageTwo.id}`), String(pageIds.length));
  await pp.unroute(/\/api\/study-folder\?.*cursor=/);
  await pp.locator("[data-folder-more]").click();
  await pp.waitForFunction(() => document.querySelectorAll("[data-folder-item]").length === 50);
  check("late response: opnieuw laden werkt daarna normaal", unique(await itemIds(pp)));
  await pc.close();

  // Direct geopend item: definitieve 404 versus tijdelijke netwerkfout.
  const direct404 = await referenceAccount();
  const own = await mutateAnnotation(direct404.actor, command("note", { type: "verse", verseId: small.verses[3].id }, 0, { text: "Direct item dat verdwijnt" }));
  pc = await open({ width: 390, height: 844 }, { who: direct404 }); pp = await pc.newPage();
  await pp.goto(`${base}/study-folder?item=note:${own.annotation.id}`);
  await pp.locator("[data-folder-focus] article").waitFor();
  check("item: de eigen annotatie staat in de itemkaart", (await pp.locator("[data-folder-focus]").innerText()).includes("Direct item dat verdwijnt"));
  await pp.locator("[data-folder-focus] [data-folder-edit]").click();
  await dlg(pp).locator("textarea:not([disabled])").waitFor();
  await dlg(pp).getByRole("button", { name: t("annotations.noteRemove"), exact: true }).click();
  await dlg(pp).getByText(t("annotations.saved")).waitFor();
  await dlg(pp).getByRole("button", { name: t("annotations.close") }).click();
  await pp.waitForFunction((message) => document.querySelector("[data-folder-focus]")?.textContent.includes(message), t("studyFolder.itemGone"));
  check("item: na de bevestigde 404 verdwijnt de oude itemkaart", (await pp.locator("[data-folder-focus] article").count()) === 0 && !(await pp.locator("[data-study-folder]").innerText()).includes("Direct item dat verdwijnt"));
  check("item: alleen de bestaande melding blijft staan", (await pp.locator("[data-folder-focus]").innerText()).includes(t("studyFolder.itemGone")));
  await pc.close();

  const flaky = await referenceAccount();
  const kept = await mutateAnnotation(flaky.actor, command("note", { type: "verse", verseId: small.verses[4].id }, 0, { text: "Blijft staan bij een netwerkfout" }));
  pc = await open({ width: 390, height: 844 }, { who: flaky }); pp = await pc.newPage();
  await pp.goto(`${base}/study-folder?item=note:${kept.annotation.id}`);
  await pp.locator("[data-folder-focus] article").waitFor();
  await pp.route(/\/api\/study-folder\?item=/, (route) => route.abort("failed"));
  await pp.locator("[data-folder-focus] [data-folder-edit]").click();
  await dlg(pp).locator("textarea:not([disabled])").waitFor();
  await dlg(pp).locator("textarea").fill("Blijft staan bij een netwerkfout (bijgewerkt)");
  await dlg(pp).getByRole("button", { name: t("annotations.save"), exact: true }).click();
  await dlg(pp).getByText(t("annotations.saved")).waitFor();
  await dlg(pp).getByRole("button", { name: t("annotations.close") }).click();
  await pp.locator("[data-folder-focus] [role=alert]").waitFor({ timeout: 10000 });
  check("item: een tijdelijke netwerkfout toont een fout en geen verwijdering", (await pp.locator("[data-folder-focus] article").count()) === 1 && !(await pp.locator("[data-folder-focus]").innerText()).includes(t("studyFolder.itemGone")));
  await pp.unroute(/\/api\/study-folder\?item=/);
  await pc.close();

  // ===== Responsive, thema, tekstschaling, talen, toetsenbord =====
  const sizes = [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 820, height: 1100 }, { width: 1280, height: 900 }];
  for (const language of ["nl", "en", "de", "fr", "es"]) {
    await prisma.user.update({ where: { id: owner.user.id }, data: { uiLanguage: language } });
    for (const [index, size] of sizes.entries()) for (const scheme of ["light", "dark"]) for (const scale of [100, 200]) {
      if (language !== "nl" && (index === 2 || (scale === 200 && scheme === "dark"))) continue;
      const c = await open(size, { scheme, touch: size.width < 500 });
      const p = await c.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(`${base}/study-folder?type=note`);
      await p.addStyleTag({ content: `html{font-size:${scale}%}` });
      await p.locator("[data-folder-item]").first().waitFor();
      check(`responsive ${language} ${size.width}px ${scheme} ${scale}%: geen horizontale overflow`, await noOverflow(p));
      const bar = await p.locator("[data-subpage-back-bar]").boundingBox();
      const edit = await p.locator("[data-folder-edit]").first().boundingBox();
      check(`responsive ${language} ${size.width}px ${scheme} ${scale}%: bediening zichtbaar en minimaal 40px`, bar !== null && edit.height >= 40 && edit.x >= -1 && edit.x + edit.width <= size.width + 1);
      if (language === "nl" && scheme === "light" && scale === 100) await p.screenshot({ path: `${output}/folder-${size.width}.png` });
      await c.close();
    }
  }
  await prisma.user.update({ where: { id: owner.user.id }, data: { uiLanguage: "nl" } });
  context = await open({ width: 1280, height: 900 }, { touch: false });
  page = await context.newPage();
  await page.goto(`${base}/study-folder`);
  await page.locator("[data-folder-item]").first().waitFor();
  await page.locator("[data-folder-edit]").first().focus();
  await page.keyboard.press("Enter");
  await page.locator("dialog[data-annotation-dialog][open]").waitFor();
  check("toetsenbord: Enter op Bewerken opent de sheet", true);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  check("toetsenbord: Escape sluit en focus keert terug naar Bewerken", await page.evaluate(() => document.activeElement?.hasAttribute("data-folder-edit")));
  check("toegankelijkheid: elke Bewerken-knop heeft een eigen naam", (await page.locator("[data-folder-edit]").evaluateAll((els) => new Set(els.map((e) => e.getAttribute("aria-label"))).size === els.length)));
  check("geen paginafouten", errors.length === 0, errors.join("|"));
  await context.close();
  console.log(`\n${results.length}/${results.length} checks geslaagd`);
} finally {
  await prisma.$transaction([
    prisma.bookmark.deleteMany({ where: { verse: { chapterId: { in: created.map((c) => c.chapterId) } } } }),
    prisma.highlight.deleteMany({ where: { verse: { chapterId: { in: created.map((c) => c.chapterId) } } } }),
    prisma.note.deleteMany({ where: { verse: { chapterId: { in: created.map((c) => c.chapterId) } } } }),
    prisma.verse.deleteMany({ where: { chapterId: { in: created.map((c) => c.chapterId) } } }),
    prisma.chapter.deleteMany({ where: { id: { in: created.map((c) => c.chapterId) } } }),
    prisma.book.deleteMany({ where: { id: { in: created.map((c) => c.bookId) } } }),
  ]);
  await browser.close();
  await prisma.$disconnect();
}
