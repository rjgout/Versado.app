// Markeringskleuren en het kleurfilter van Mijn studiemap in een echte browser. Eigen productiebuild en wegwerp-PostgreSQL;
// alle gegevens zijn synthetisch en worden opgeruimd. Screenshots staan in /tmp/versado-study-folder-browser.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { SESSION_COOKIE } from "../src/lib/auth.ts";
import { mutateAnnotation } from "../src/lib/annotations/service.ts";
import { passageBlocks } from "../src/lib/annotations/contract.ts";
import { ANNOTATION_COLORS } from "../src/lib/annotations/clientContract.ts";
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
const command = (kind, target, expectedVersion = 0, extra = {}) => ({ kind, target, expectedVersion, actionId: randomUUID(), ...(kind === "note" ? { text: "Kleurnotitie" } : {}), ...extra });
async function chapter(collectionId, name, key, count) {
  const book = await prisma.book.create({ data: { slug: `sfc-${randomUUID()}`, key, name, order: 820, contentCollectionId: collectionId } });
  const row = await prisma.chapter.create({
    data: { bookId: book.id, number: 1, order: 820, verses: { create: Array.from({ length: count }, (_, i) => ({ number: i + 1, text: `Synthetisch kleurvers ${i + 1} van ${name}, met een rustige zin om te lezen.`, audioStart: null })) } },
    include: { verses: { orderBy: { number: "asc" } } },
  });
  created.push({ bookId: book.id, chapterId: row.id });
  return row;
}
const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
try {
  const f = await referenceFixture();
  const owner = f.owner, stranger = await referenceAccount();
  const read = await chapter("content_bom", "Kleurlezer", `bofm/sfc-${randomUUID().slice(0, 6)}`, 8);
  const many = await chapter("content_bom", "Kleurmap", `bofm/sfc-many-${randomUUID().slice(0, 6)}`, 130);
  const block = passageBlocks(f.dto.lesson.body, f.dto.lesson.body.sections[0].id)[0];
  const lessonTarget = { type: "lesson", lessonEditionId: f.item.lessonEditionId, revisionId: f.item.revisionId, selector: { normalizationVersion: 1, originalRevisionId: f.item.revisionId, sectionAnchor: f.dto.lesson.body.sections[0].id, ranges: [{ blockId: block.id, start: 0, end: [...block.text].length }], exact: block.text, prefix: "", suffix: "" } };
  const marks = {};
  for (const [i, color] of ANNOTATION_COLORS.entries()) marks[color] = await mutateAnnotation(owner.actor, command("highlight", { type: "verse", verseId: read.verses[i].id }, 0, { color }));
  await mutateAnnotation(owner.actor, command("note", { type: "verse", verseId: read.verses[0].id }));
  const lessonMark = await mutateAnnotation(owner.actor, command("highlight", lessonTarget, 0, { color: "blue" }));
  // 130 markeringen met gemengde kleuren (26 per kleur) plus bladwijzers en een notitie.
  const stamp = Date.now() - 3_600_000;
  await prisma.highlight.createMany({ data: many.verses.map((v, i) => ({ userId: owner.user.id, verseId: v.id, targetKey: `verse:${v.id}`, color: ANNOTATION_COLORS[i % 5], createdAt: new Date(stamp - i * 1000) })) });
  await prisma.bookmark.createMany({ data: many.verses.slice(0, 10).map((v, i) => ({ userId: owner.user.id, verseId: v.id, targetKey: `verse:${v.id}`, createdAt: new Date(stamp - 500_000 - i * 1000) })) });
  await prisma.highlight.create({ data: { userId: stranger.user.id, verseId: many.verses[0].id, targetKey: `verse:${many.verses[0].id}`, color: "pink" } });

  const open = async (viewport = { width: 390, height: 844 }, { who = owner, scheme = "light", touch = true } = {}) => {
    const context = await browser.newContext({ viewport, serviceWorkers: "block", colorScheme: scheme, hasTouch: touch });
    await context.addCookies([{ name: SESSION_COOKIE, value: who.token, url: base }]);
    return context;
  };
  const errors = [];
  const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const rows = (p) => p.locator("[data-folder-item]");
  const settle = async (p) => { await p.waitForTimeout(500); await p.locator("[data-folder-item], [data-folder-empty]").first().waitFor(); };
  const itemColors = (p) => p.locator("[data-folder-item]").evaluateAll((els) => els.map((e) => e.querySelector("[data-mark-swatch]")?.getAttribute("data-mark-swatch") ?? null));
  const loadAll = async (p) => { while (await p.locator("[data-folder-more]").count()) { await p.locator("[data-folder-more]").click(); await p.waitForTimeout(250); } };

  // ===== Kleurweergave in de verslezer (light en dark) =====
  for (const scheme of ["light", "dark"]) {
    const context = await open({ width: 390, height: 844 }, { scheme });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/lesson/${read.id}`);
    await page.waitForSelector("#vers-5");
    await page.waitForFunction(() => document.querySelectorAll("[data-annotation-color]").length >= 5);
    await page.waitForTimeout(1200); // de kleurovergang (duration-700) moet uitgelopen zijn
    const style = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-annotation-color]")].map((el) => { const cs = getComputedStyle(el); return [el.getAttribute("data-annotation-color"), { bg: cs.backgroundColor, bar: cs.backgroundImage }]; })));
    const colors = ANNOTATION_COLORS.filter((c) => style[c]);
    check(`lezer ${scheme}: vijf kleuren hebben een eigen achtergrond`, colors.length === 5 && new Set(colors.map((c) => style[c].bg)).size === 5, JSON.stringify(Object.values(style).map((s) => s.bg)));
    // Zonder alpha te vergelijken: gele/groene en blauwe/paarse markering moeten ook los van elkaar onderscheidbaar zijn.
    const solid = await page.evaluate(() => Object.fromEntries(["yellow", "green", "blue", "pink", "purple"].map((c) => { const el = document.createElement("i"); el.setAttribute("data-mark-swatch", c); el.className = "mark-swatch"; document.body.append(el); const bg = getComputedStyle(el).backgroundColor; el.remove(); return [c, bg]; })));
    check(`lezer ${scheme}: geel/groen en blauw/paars liggen ver uit elkaar`, dist(rgb(solid.yellow), rgb(solid.green)) > 120 && dist(rgb(solid.blue), rgb(solid.purple)) > 60 && dist(rgb(solid.pink), rgb(solid.purple)) > 60, JSON.stringify(solid));
    check(`lezer ${scheme}: elke gemarkeerde regel heeft een niet-kleurkenmerk (balk links)`, colors.every((c) => style[c].bar.includes("linear-gradient")));
    check(`lezer ${scheme}: markeringsicoon in de versknop`, (await page.locator("#vers-1 button svg").count()) >= 1);
    // Geselecteerd vers en vers dat nu gelezen wordt behouden de kleur.
    await page.locator("#vers-2 p").evaluate((el) => el.scrollIntoView({ block: "center" }));
    const r = await page.locator("#vers-2 p").boundingBox();
    await page.touchscreen.tap(r.x + r.width - 12, r.y + r.height - 6);
    await page.locator("dialog[data-annotation-dialog][open]").waitFor();
    const swatches = await page.locator("dialog[data-annotation-dialog][open] [data-mark-swatch]").count();
    check(`menu ${scheme}: vijf kleurknoppen met swatch`, swatches === 5);
    await page.waitForTimeout(800);
    const pressed = await page.locator("dialog[data-annotation-dialog][open] button[aria-pressed=true] [data-mark-swatch]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-mark-swatch"), !!e.querySelector("svg")]));
    check(`menu ${scheme}: gekozen kleur herkenbaar zonder kleurwaarneming (vinkje + aria-pressed)`, pressed.some(([c, tick]) => c === "green" && tick), JSON.stringify(pressed) + await page.locator("dialog[data-annotation-dialog][open]").innerText());
    const heights = await page.locator("dialog[data-annotation-dialog][open] [data-mark-swatch]").evaluateAll((els) => els.map((e) => e.closest("button").getBoundingClientRect().height));
    check(`menu ${scheme}: kleurknoppen minimaal 44px`, heights.every((h) => h >= 43.5));
    await page.screenshot({ path: `${output}/colors-menu-${scheme}.png` });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    check(`lezer ${scheme}: geselecteerd vers houdt zijn kleur`, (await page.locator("#vers-2 [data-annotation-color]").count()) + (await page.locator("#vers-2[data-annotation-color]").count()) >= 1);
    await page.screenshot({ path: `${output}/colors-reader-${scheme}.png` });
    // Grote tekst en smal scherm.
    await page.addStyleTag({ content: "html{font-size:200%}" });
    check(`lezer ${scheme}: 200% tekst zonder horizontale overflow`, await noOverflow(page));
    await page.screenshot({ path: `${output}/colors-reader-${scheme}-200.png` });
    await context.close();
    // Studielezer: CSS Highlight API.
    const c2 = await open({ width: 390, height: 844 }, { scheme });
    const sp = await c2.newPage();
    sp.on("pageerror", (e) => errors.push(e.message));
    await sp.goto(`${base}/study-folder?type=highlight`);
    await sp.locator(`[data-folder-item="highlight:${lessonMark.annotation.id}"] [data-folder-open]`).click();
    await sp.waitForURL(/\/study-lesson\//);
    await sp.waitForFunction(() => globalThis.CSS?.highlights && [...CSS.highlights.keys()].some((k) => k.startsWith("annotation-")), null, { timeout: 15000 });
    check(`studielezer ${scheme}: markering via CSS Highlight API met kleurregel`, await sp.evaluate(() => [...document.querySelectorAll("style")].some((s) => /::highlight\(annotation-[^)]*-blue\)[^}]*text-decoration:underline/.test(s.textContent))));
    await sp.screenshot({ path: `${output}/colors-study-reader-${scheme}.png` });
    await c2.close();
  }

  // ===== Mijn studiemap: kaarten en filter =====
  let context = await open(), page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const reqs = [];
  page.on("request", (r) => { if (r.url().includes("/api/study-folder")) reqs.push(r.url()); });
  await page.goto(`${base}/study-folder`);
  await settle(page);
  check("filter: kleurgroep zichtbaar bij Alles", await page.locator("[data-folder-colors]").isVisible());
  check("filter: Alle kleuren + 5 kleuren, elk met swatch en naam", (await page.locator("[data-folder-colors] button").count()) === 6 && (await page.locator("[data-folder-colors] [data-mark-swatch]").count()) === 5);
  const cardSwatches = await page.locator("[data-folder-item] [data-mark-swatch]").count();
  check("kaarten: markeringen tonen swatch naast kleurnaam", cardSwatches > 0);
  await page.screenshot({ path: `${output}/colors-folder-light.png` });

  // Elke kleur: alleen markeringen in die kleur, alle pagina's, geen dubbelen; type automatisch Markeringen.
  for (const color of ANNOTATION_COLORS) {
    await page.locator(`[data-folder-color="${color}"]`).click();
    await page.waitForURL(new RegExp(`type=highlight&color=${color}|color=${color}&type=highlight`));
    await settle(page);
    await loadAll(page);
    const colors = await itemColors(page);
    const ids = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-folder-item")));
    const expected = await prisma.highlight.count({ where: { userId: owner.user.id, color, deletedAt: null } });
    check(`kleur ${color}: precies de markeringen van die kleur, meerdere pagina's, geen dubbelen`, colors.every((c) => c === color) && ids.length === expected && new Set(ids).size === ids.length && ids.every((i) => i.startsWith("highlight:")), `${ids.length}/${expected}`);
    check(`kleur ${color}: Markeringen is actief en de knop staat ingedrukt`, (await page.locator('[data-folder-type="highlight"]').getAttribute("aria-pressed")) === "true" && (await page.locator(`[data-folder-color="${color}"]`).getAttribute("aria-pressed")) === "true");
  }
  check("filter: queryverzoeken bevatten kleur en type samen", reqs.some((u) => /color=yellow/.test(u) && /type=highlight/.test(u)));

  // Combinatie met zoeken en bron.
  await page.locator('[data-folder-color="yellow"]').click();
  await settle(page);
  await page.locator('input[type="search"]').fill("kleurvers 6 van Kleurmap");
  await page.waitForTimeout(900);
  await settle(page);
  check("kleur + zoeken: alleen gele treffers die bij de zoekterm passen", (await rows(page).count()) >= 1 && (await itemColors(page)).every((c) => c === "yellow") && /color=yellow/.test(page.url()) && /q=/.test(page.url()));
  await page.locator('input[type="search"]').fill("");
  await page.waitForTimeout(900);
  const sourceSelect = page.locator("[data-folder-source]");
  if (await sourceSelect.count()) {
    await sourceSelect.selectOption({ index: 1 });
    await settle(page);
    check("kleur + bron: kleur blijft in de URL en de lijst klopt", /color=yellow/.test(page.url()) && /source=/.test(page.url()) && (await itemColors(page)).every((c) => c === "yellow"));
  }
  await page.goto(`${base}/study-folder?type=highlight&color=yellow`);
  await settle(page);

  // Directe URL, Alle kleuren, soortwissel, wissen.
  check("directe URL: kleurfilter actief en lijst gefilterd", (await page.locator('[data-folder-color="yellow"]').getAttribute("aria-pressed")) === "true" && (await itemColors(page)).every((c) => c === "yellow"));
  await page.locator('[data-folder-color="all"]').click();
  await settle(page);
  check("Alle kleuren: houdt type Markeringen en haalt de kleur uit de URL", !/color=/.test(page.url()) && /type=highlight/.test(page.url()));
  await page.locator('[data-folder-color="green"]').click();
  await settle(page);
  await page.locator('[data-folder-type="bookmark"]').click();
  await settle(page);
  check("soort Bladwijzers verwijdert kleurfilter en verbergt de kleurgroep", !/color=/.test(page.url()) && (await page.locator("[data-folder-colors]").count()) === 0 && (await rows(page).count()) > 0);
  await page.locator('[data-folder-type="note"]').click();
  await settle(page);
  check("soort Notities: geen kleurgroep en geen kleur in de URL", !/color=/.test(page.url()) && (await page.locator("[data-folder-colors]").count()) === 0);
  await page.locator('[data-folder-type="all"]').click();
  await settle(page);
  check("soort Alles: kleurgroep weer zichtbaar, geen kleurfilter", (await page.locator("[data-folder-colors]").count()) === 1 && (await page.locator('[data-folder-color="all"]').getAttribute("aria-pressed")) === "true");
  await page.locator('[data-folder-color="pink"]').click();
  await settle(page);
  const clear = page.locator("[data-folder-clear]");
  if (await clear.count()) { await clear.click(); await settle(page); check("filters wissen: kleur, soort, bron en zoekterm verdwenen", !/color=|type=|q=|source=/.test(page.url())); }

  // Ongeldige URL-waarden.
  for (const url of ["?color=red", "?type=note&color=yellow", "?type=bookmark&color=blue", "?color=yellow&color=blue"]) {
    await page.goto(`${base}/study-folder${url}`);
    await settle(page);
    check(`ongeldige URL ${url}: geen foutpagina en lijst bruikbaar`, (await rows(page).count()) > 0 && (await page.locator('text=/Internal|500/').count()) === 0);
  }
  await page.goto(`${base}/study-folder?color=red`);
  await settle(page);
  check("ongeldige kleur wordt genegeerd (geen kleur actief)", (await page.locator('[data-folder-color="all"]').getAttribute("aria-pressed")) === "true");
  await page.goto(`${base}/study-folder?type=note&color=yellow`);
  await settle(page);
  check("type=note&color=yellow: kleur genegeerd, notities getoond", (await rows(page).evaluateAll((els) => els.every((e) => e.getAttribute("data-folder-item").startsWith("note:")))));

  // Late respons: gele respons mag nooit in de blauwe lijst landen.
  await page.goto(`${base}/study-folder`);
  await settle(page);
  await page.route("**/api/study-folder?*color=yellow*", async (route) => { await new Promise((r) => setTimeout(r, 1800)); await route.continue().catch(() => {}); });
  await page.locator('[data-folder-color="yellow"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-folder-color="blue"]').click();
  await page.waitForTimeout(3200);
  await settle(page);
  const late = await itemColors(page);
  check("late gele respons landt niet in de blauwe lijst", late.length > 0 && late.every((c) => c === "blue"), late.slice(0, 3).join(","));
  await page.unroute("**/api/study-folder?*color=yellow*");

  // Kleur wijzigen en verwijderen onder een actief filter.
  await page.goto(`${base}/study-folder?type=highlight&color=yellow`);
  await settle(page);
  const firstId = (await rows(page).first().getAttribute("data-folder-item")).split(":")[1];
  await rows(page).first().locator("[data-folder-edit]").click();
  const dialog = page.locator("dialog[data-annotation-dialog][open]");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: t("annotations.blue") }).click();
  await page.waitForFunction((id) => !document.querySelector(`[data-folder-item="highlight:${id}"]`), firstId, { timeout: 10000 });
  check("kleur gewijzigd (geel → blauw): item verdwijnt uit het gele filter", true);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  await settle(page);
  check("na wijziging bevat het gele filter alleen geel", (await itemColors(page)).every((c) => c === "yellow"));
  await page.locator('[data-folder-color="blue"]').click();
  await settle(page);
  check("het blauwe filter bevat het gewijzigde item", await page.locator(`[data-folder-item="highlight:${firstId}"]`).count() === 1);
  // Verwijderen onder actief filter.
  await page.locator(`[data-folder-item="highlight:${firstId}"] [data-folder-edit]`).click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: t("annotations.highlightRemove") }).click();
  await page.waitForFunction((id) => !document.querySelector(`[data-folder-item="highlight:${id}"]`), firstId, { timeout: 10000 });
  check("verwijderen onder blauw filter: item verdwijnt en filter blijft actief", /color=blue/.test(page.url()) && (await prisma.highlight.findUniqueOrThrow({ where: { id: firstId } })).deletedAt !== null);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));

  // Terug navigeren behoudt kleur en filter.
  await page.goto(`${base}/study-folder?type=highlight&color=green`);
  await settle(page);
  await rows(page).first().locator("[data-folder-open]").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/study-folder"));
  await page.goBack();
  await page.waitForURL(/color=green/);
  await settle(page);
  check("terugnavigatie: kleurfilter blijft actief en lijst klopt", (await page.locator('[data-folder-color="green"]').getAttribute("aria-pressed")) === "true" && (await itemColors(page)).every((c) => c === "green"));
  await context.close();

  // Andere gebruiker: geen lekken.
  context = await open({ width: 390, height: 844 }, { who: stranger });
  const sp = await context.newPage();
  await sp.goto(`${base}/study-folder?type=highlight&color=yellow`);
  await sp.locator("[data-folder-item], [data-folder-empty]").first().waitFor();
  check("andere gebruiker ziet geen gele markeringen van de eigenaar", (await sp.locator("[data-folder-item]").count()) === 0);
  await sp.goto(`${base}/study-folder?type=highlight&color=pink`);
  await sp.locator("[data-folder-item], [data-folder-empty]").first().waitFor();
  check("andere gebruiker ziet alleen de eigen roze markering", (await sp.locator("[data-folder-item]").count()) === 1);
  await context.close();

  // Responsief en donker: filterbalk en kaarten.
  for (const [width, scale, scheme] of [[320, 100, "light"], [320, 200, "light"], [390, 100, "dark"], [390, 200, "dark"], [1280, 100, "light"], [1280, 100, "dark"]]) {
    const c = await open({ width, height: width > 500 ? 900 : 844 }, { scheme, touch: width < 500 });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${base}/study-folder?type=highlight&color=purple`);
    await p.addStyleTag({ content: `html{font-size:${scale}%}` });
    await settle(p);
    check(`responsive ${width}px ${scale}% ${scheme}: geen horizontale overflow`, await noOverflow(p));
    const bt = await p.locator("[data-folder-colors] button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    check(`responsive ${width}px ${scale}% ${scheme}: kleurknoppen minimaal 40px hoog`, bt.every((h) => h >= 39.5));
    await p.screenshot({ path: `${output}/colors-folder-${width}-${scale}-${scheme}.png` });
    await c.close();
  }
  check("geen paginafouten", errors.length === 0, errors.join("|"));
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
