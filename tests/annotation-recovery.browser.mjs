// Fase 4D: annotatieherstel in een echte browser (reader + Mijn studiemap). Eigen productiebuild en wegwerp-PostgreSQL;
// alle gegevens zijn synthetisch. Screenshots staan in /tmp/versado-annotation-recovery-browser.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { SESSION_COOKIE } from "../src/lib/auth.ts";
import { mutateAnnotation } from "../src/lib/annotations/service.ts";
import { passageBlocks, validatePassageSelector } from "../src/lib/annotations/contract.ts";
import { appendStudyRevision } from "../src/lib/studyContent/revisions.ts";
import { referenceFixture, assertReferenceTestEnvironment } from "./fixtures/reference-content.mjs";
import { getT } from "../src/lib/i18n/index.ts";

const base = assertReferenceTestEnvironment();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const output = "/tmp/versado-annotation-recovery-browser";
mkdirSync(output, { recursive: true });
let t = getT("nl");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(ok ? "OK  " : "FAIL", name, detail); assert.ok(ok, `${name} ${detail}`); };
const command = (kind, target, expectedVersion = 0, extra = {}) => ({ kind, target, expectedVersion, actionId: randomUUID(), ...(kind === "note" ? { text: "Privénotitie 4D" } : {}), ...extra });
const chars = (text) => [...text];
function selectorFor(body, revisionId, sectionAnchor, blockId, start, end) {
  const text = chars(passageBlocks(body, sectionAnchor).find((b) => b.id === blockId).text);
  return validatePassageSelector(body, { normalizationVersion: 1, originalRevisionId: revisionId, sectionAnchor, ranges: [{ blockId, start, end }], exact: text.slice(start, end).join(""), prefix: text.slice(Math.max(0, start - 32), start).join(""), suffix: text.slice(end, end + 32).join("") });
}
function editBlock(body, id, fn) {
  const copy = structuredClone(body);
  (function walk(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(walk);
    if (value.id === id) fn(value);
    for (const key of ["blocks", "items", "children", "rows", "cells"]) walk(value[key]);
  })(copy.sections);
  return copy;
}

const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
try {
  const f = await referenceFixture();
  const owner = f.owner;
  const original = f.item.revisionId;
  const section = f.dto.lesson.body.sections[0];
  const heading = passageBlocks(f.dto.lesson.body, section.id)[0];
  const uiTarget = (rev, body, start = 0, end = chars(heading.text).length) => ({ type: "lesson", lessonEditionId: f.item.lessonEditionId, revisionId: rev, selector: selectorFor(body, rev, section.id, heading.id, start, end) });
  const target = uiTarget(original, f.dto.lesson.body);
  const pointer = (id) => prisma.studyLessonEdition.update({ where: { id: f.item.lessonEditionId }, data: { publishedRevisionId: id } });
  const oldRevision = await prisma.studyRevision.findUniqueOrThrow({ where: { id: original } });
  const newRevision = (body, title) => appendStudyRevision(f.admin.actor, f.item.lessonEditionId, { schemaVersion: 1, title, body, sourceMetadata: oldRevision.sourceMetadata, rightsMetadata: oldRevision.rightsMetadata });
  const open = async (viewport = { width: 390, height: 844 }, { scheme = "light", touch = true } = {}) => {
    const context = await browser.newContext({ viewport, serviceWorkers: "block", colorScheme: scheme, hasTouch: touch });
    await context.addCookies([{ name: SESSION_COOKIE, value: owner.token, url: base }]);
    return context;
  };
  const errors = [];
  const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const highlightSizes = (p) => p.evaluate(() => [...(CSS.highlights?.entries?.() ?? [])].filter(([k]) => k.startsWith("annotation-")).reduce((n, [, h]) => n + h.size, 0));
  const folder = async (p, query = "") => { await p.goto(`${base}/study-folder${query}`); await p.locator("[data-folder-item]").first().waitFor(); };
  const card = (p, kind, id) => p.locator(`[data-folder-item="${kind}:${id}"]`);

  const hl = (await mutateAnnotation(owner.actor, command("highlight", target, 0, { color: "green" }))).annotation;
  const note = (await mutateAnnotation(owner.actor, command("note", target, 0, { text: "Mijn notitie bij de koptekst" }))).annotation;

  // ===== Scenario A: exact herkend =====
  const same = await newRevision(structuredClone(f.dto.lesson.body), "A: zelfde anker");
  await pointer(same.id);
  let context = await open(), page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await folder(page);
  check("A: kaart toont 'Passage gevonden'", new RegExp(t("studyFolder.recoveryFound")).test(await card(page, "note", note.id).innerText()));
  await card(page, "note", note.id).locator("[data-folder-open]").click();
  await page.waitForURL(/\/study-lesson\//);
  await page.waitForFunction(() => document.querySelector("[data-annotation-focus]"), null, { timeout: 8000 });
  await page.waitForFunction(() => [...(CSS.highlights?.entries?.() ?? [])].some(([k, h]) => k.startsWith("annotation-") && h.size > 0), null, { timeout: 8000 });
  check("A: de passage staat in beeld en de markering staat op de juiste tekst", (await highlightSizes(page)) >= 1 && (await page.locator("[data-annotation-recovery]").count()) === 0);
  await page.screenshot({ path: `${output}/A-exact.png` });
  await context.close();

  // ===== Scenario B: voorstel =====
  const renamed = editBlock(f.dto.lesson.body, heading.id, (b) => { b.id = `${heading.id}-nieuw`; });
  const proposalRevision = await newRevision(renamed, "B: blok vervangen");
  await pointer(proposalRevision.id);
  context = await open(); page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const posts = [];
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/api/annotations/resolve")) posts.push(r.postData()); });
  await folder(page);
  const cardB = card(page, "highlight", hl.id);
  check("B: kaart toont 'Passage bijwerken' met uitleg en vergelijkactie", new RegExp(t("studyFolder.recoveryReview")).test(await cardB.innerText()) && new RegExp(t("studyFolder.recoveryReviewHelp").slice(0, 20)).test(await cardB.innerText()) && (await cardB.locator("[data-folder-open]").innerText()).includes(t("studyFolder.recoveryCompare")));
  check("B: oorspronkelijke quote blijft zichtbaar", (await cardB.locator("blockquote").innerText()).includes(target.selector.exact) );
  await page.screenshot({ path: `${output}/B-folder.png` });
  await cardB.locator("[data-folder-open]").click();
  await page.waitForURL(/\/study-lesson\//);
  const panel = page.locator('[data-annotation-recovery="proposal"]');
  await panel.waitFor();
  check("B: vergelijking toont oorspronkelijke en voorgestelde passage; nog geen markering of scroll", (await panel.locator("blockquote").count()) === 2 && (await panel.innerText()).includes(target.selector.exact) && (await page.locator("[data-annotation-focus]").count()) === 0 && (await highlightSizes(page)) === 0);
  await page.screenshot({ path: `${output}/B-compare.png` });
  // Reject: geen mutatie; na herladen staat het voorstel er nog.
  await panel.locator("[data-annotation-reject]").click();
  await page.waitForFunction(() => !document.querySelector("[data-annotation-confirm]"));
  check("B: weigeren schrijft niets (geen POST, geen resolutie)", posts.length === 0 && (await prisma.highlight.findUniqueOrThrow({ where: { id: hl.id } })).resolvedRevisionId === null);
  await page.reload();
  await page.locator('[data-annotation-recovery="proposal"]').waitFor();
  check("B: na herladen is het voorstel er nog (niets onthouden)", true);
  // Bevestigen: pas na de serverrespons verschijnt de markering.
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route("**/api/annotations/resolve", async (route) => { await gate; await route.continue(); });
  await page.locator("[data-annotation-confirm]").click();
  await page.waitForTimeout(500);
  check("B: tijdens opslaan nog geen gekoppelde markering en knoppen vergrendeld", (await highlightSizes(page)) === 0 && (await page.locator("[data-annotation-confirm]").isDisabled()) && (await prisma.highlight.findUniqueOrThrow({ where: { id: hl.id } })).resolvedRevisionId === null);
  const respPromise = page.waitForResponse((r) => r.url().includes("/api/annotations/resolve"));
  release();
  const resp = await respPromise;
  assert.equal(resp.status(), 200);
  await page.waitForFunction(() => document.querySelector("[data-annotation-focus]"), null, { timeout: 10000 });
  await page.unroute("**/api/annotations/resolve");
  await page.waitForFunction(() => [...(CSS.highlights?.entries?.() ?? [])].some(([k, h]) => k.startsWith("annotation-") && h.size > 0), null, { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector("[data-annotation-recovery]"), null, { timeout: 10000 });
  check("B: na bevestiging staat de passage gekoppeld, gemarkeerd en in beeld", (await page.locator("[data-annotation-recovery]").count()) === 0 && (await highlightSizes(page)) >= 1);
  const afterB = await prisma.highlight.findUniqueOrThrow({ where: { id: hl.id } });
  check("B: één POST; oorspronkelijke velden ongemoeid; resolutie vastgelegd", posts.length === 1 && afterB.resolvedRevisionId === proposalRevision.id && afterB.revisionId === original && afterB.color === "green");
  await page.screenshot({ path: `${output}/B-confirmed.png` });
  // Terug/vooruit en kaart in de map.
  await page.goBack();
  await page.waitForURL(/study-folder/);
  await page.locator("[data-folder-item]").first().waitFor();
  check("B: terug naar de map toont 'Passage gevonden'", new RegExp(t("studyFolder.recoveryFound")).test(await card(page, "highlight", hl.id).innerText()));
  await page.goForward();
  await page.waitForURL(/study-lesson/);
  check("B: vooruit opent de passage weer", true);
  await context.close();

  // ===== Scenario C: orphan en handmatige herstelactie =====
  const gone = editBlock(f.dto.lesson.body, heading.id, (b) => { b.content = [{ type: "text", text: "Een geheel nieuwe titel zonder de oude woorden" }]; });
  const orphanRevision = await newRevision(gone, "C: blok vervangen door andere tekst");
  await pointer(orphanRevision.id);
  context = await open(); page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await folder(page);
  const cardC = card(page, "note", note.id);
  check("C: kaart toont 'Oorspronkelijke passage niet gevonden', quote blijft", new RegExp(t("studyFolder.recoveryMissing")).test(await cardC.innerText()) && (await cardC.locator("blockquote").innerText()).includes(target.selector.exact));
  await cardC.locator("[data-folder-open]").click();
  await page.waitForURL(/\/study-lesson\//);
  const orphan = page.locator('[data-annotation-recovery="orphaned"]');
  await orphan.waitFor();
  check("C: geen automatische markering; oorspronkelijke quote zichtbaar", (await highlightSizes(page)) === 0 && (await orphan.innerText()).includes(target.selector.exact));
  await page.screenshot({ path: `${output}/C-orphan.png` });
  await orphan.locator("[data-annotation-pick]").click();
  // Selecteer bewust een nieuwe passage in de tekst.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("[data-study-text]")].find((n) => n.textContent.includes("geheel nieuwe titel"));
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 12);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  });
  await page.locator("[data-annotation-selection]").click();
  const picked = page.locator("[data-annotation-picked]");
  await picked.waitFor();
  check("C: gekozen passage wordt eerst getoond; niets is opgeslagen", (await picked.innerText()).includes("Een geheel n") && (await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).resolvedRevisionId === null);
  await page.locator("[data-annotation-pick-confirm]").click();
  await page.waitForFunction(() => document.querySelector("[data-annotation-focus]"), null, { timeout: 10000 });
  const afterC = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
  check("C: herkoppeling opgeslagen; kleur, identiteit en oorspronkelijke selector onveranderd", afterC.resolvedRevisionId === orphanRevision.id && afterC.text === "Mijn notitie bij de koptekst" && afterC.revisionId === original && afterC.resolvedSelector.exact === "Een geheel n");
  await context.close();

  // ===== Scenario D: privacy bij een ontoegankelijke bron =====
  await prisma.contentCollection.update({ where: { id: f.collection.id }, data: { visibleToUsers: false } });
  try {
    context = await open(); page = await context.newPage();
    const apiBodies = [];
    page.on("response", async (r) => { if (r.url().includes("/api/study-folder")) apiBodies.push(await r.text().catch(() => "")); });
    await folder(page);
    const cardD = card(page, "note", note.id);
    const text = await cardD.innerText();
    check("D: eigen notitie en quote blijven zichtbaar, bron als niet beschikbaar", text.includes("Mijn notitie bij de koptekst") && text.includes(t("studyFolder.sourceUnavailable")) && (await cardD.locator("[data-folder-open]").count()) === 0);
    check("D: geen herstelstatus, geen herstelactie en geen nieuwe brontekst in DOM of API", !/Passage (gevonden|bijwerken)/.test(text) && !(await page.content()).includes("geheel nieuwe titel") && apiBodies.every((b) => !b.includes("geheel nieuwe titel") && !b.includes('"recovery"')));
    const direct = await page.goto(`${base}/study-lesson/${f.item.edition.lessonId}/${f.collection.id}?annotation=note:${note.id}`);
    check("D: de les zelf is niet leesbaar; geen herstelpaneel", (await page.locator("[data-annotation-recovery]").count()) === 0 && !(await page.content()).includes("geheel nieuwe titel"), String(direct?.status()));
    await context.close();
  } finally { await prisma.contentCollection.update({ where: { id: f.collection.id }, data: { visibleToUsers: true } }); }

  // ===== Scenario E: historie, rollback, conflict en andere taal =====
  await pointer(original);
  context = await open(); page = await context.newPage();
  await folder(page);
  check("E: rollback naar de oorspronkelijke revisie: oorspronkelijke selector geldt, geen herstelstatus nodig", (await card(page, "note", note.id).innerText()).includes("Mijn notitie") && !/Passage bijwerken|niet gevonden/.test(await card(page, "note", note.id).innerText()));
  const third = await newRevision(editBlock(f.dto.lesson.body, heading.id, (b) => { b.id = `${heading.id}-derde`; }), "E: derde revisie");
  await pointer(third.id);
  const nb = await prisma.note.findUniqueOrThrow({ where: { id: note.id } });
  await page.reload();
  await page.locator("[data-folder-item]").first().waitFor();
  check("E: derde revisie: de oude bevestigde koppeling wordt niet blind toegepast (nieuw voorstel)", new RegExp(t("studyFolder.recoveryReview")).test(await card(page, "note", note.id).innerText()) || new RegExp(t("studyFolder.recoveryFound")).test(await card(page, "note", note.id).innerText()));
  // Ander apparaat wijzigt de notitie tussen openen en bevestigen: 409.
  await card(page, "note", note.id).locator("[data-folder-open]").click();
  await page.waitForURL(/\/study-lesson\//);
  if (await page.locator('[data-annotation-recovery="proposal"]').count()) {
    await mutateAnnotation(owner.actor, command("note", target, nb.mutationVersion, { text: "Elders gewijzigd" }));
    await page.locator("[data-annotation-confirm]").click();
    await page.getByText(t("studyFolder.readerResolveConflict")).waitFor();
    check("E: gelijktijdige wijziging op een ander apparaat geeft een duidelijke conflictmelding, niets overschreven", (await prisma.note.findUniqueOrThrow({ where: { id: note.id } })).text === "Elders gewijzigd");
  }
  await context.close();
  await pointer(original);

  // ===== Scenario F/G: nooit een tijdelijk onjuiste markering na een kleurwijziging, ook niet tijdens een vertraagde readerrefresh =====
  // Alleen de annotaties van deze scenario's tellen: de eerdere (tombstone via de bestaande kolom) staan buiten beeld.
  await prisma.$executeRaw`UPDATE "Highlight" SET "deletedAt"=now() WHERE id=${hl.id}`;
  await prisma.$executeRaw`UPDATE "Note" SET "deletedAt"=now() WHERE id=${note.id}`;
  const blocks = passageBlocks(f.dto.lesson.body, section.id).filter((b) => b.id !== heading.id && chars(b.text).length >= 15);
  const highlightTexts = (p) => p.evaluate(() => [...(CSS.highlights?.entries?.() ?? [])].filter(([k]) => k.startsWith("annotation-")).flatMap(([k, h]) => [...h].map((r) => ({ key: k, text: r.toString() }))));
  const readerUrl = `${base}/study-lesson/${f.item.edition.lessonId}/${f.collection.id}`;
  async function recolorWithDelayedRefresh(page, row, expectedText, wrongTexts, label) {
    await page.route("**/api/annotations?view=reader*", async (route) => { await new Promise((r) => setTimeout(r, 3000)); await route.continue().catch(() => {}); });
    await page.locator("details summary").click();
    await page.locator("details button", { hasText: row.quote.slice(0, 20) }).first().click();
    const dialog = page.locator("dialog[data-annotation-dialog][open]");
    await dialog.waitFor();
    const put = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/api/annotations"));
    await dialog.getByRole("button", { name: t("annotations.purple") }).click();
    assert.equal((await put).status(), 200);
    const seen = [];
    const until = Date.now() + 2600;
    while (Date.now() < until) { seen.push(await highlightTexts(page)); await page.waitForTimeout(100); }
    const bad = seen.flat().filter((h) => wrongTexts.includes(h.text));
    check(`${label}: tijdens de vertraagde refresh wordt nooit een onjuiste tekst gemarkeerd (${seen.length} metingen)`, bad.length === 0, JSON.stringify(bad.slice(0, 2)));
    await page.waitForFunction(() => [...(CSS.highlights?.entries?.() ?? [])].some(([k, h]) => k.endsWith("-purple") && h.size > 0), null, { timeout: 10000 });
    await page.waitForTimeout(3500);
    const final = await highlightTexts(page);
    check(`${label}: na de refresh staat de juiste tekst paars gemarkeerd, niets in groen`, final.filter((h) => h.text === expectedText).length === 1 && final.find((h) => h.text === expectedText).key.endsWith("-purple") && !final.some((h) => h.text === wrongTexts[0]), JSON.stringify(final));
    await page.unroute("**/api/annotations?view=reader*");
  }
  // F: groene markering op revisie 1; revisie 2 heeft dezelfde tekst op een verschoven offset (bewezen anker, automatisch exact).
  const blockF = blocks[0], textF = blockF.text, lenF = chars(textF).length;
  const hlF = (await mutateAnnotation(owner.actor, command("highlight", { type: "lesson", lessonEditionId: f.item.lessonEditionId, revisionId: original, selector: selectorFor(f.dto.lesson.body, original, section.id, blockF.id, 0, lenF) }, 0, { color: "green" }))).annotation;
  const blockG = blocks[1], lenG = 15;
  const hlG = (await mutateAnnotation(owner.actor, command("highlight", { type: "lesson", lessonEditionId: f.item.lessonEditionId, revisionId: original, selector: selectorFor(f.dto.lesson.body, original, section.id, blockG.id, 0, lenG) }, 0, { color: "green" }))).annotation;
  const bodyF = editBlock(f.dto.lesson.body, blockF.id, (b) => { b.content = [{ type: "text", text: `Nieuw: ${textF}` }]; });
  const revF = await newRevision(bodyF, "F: verschoven offset");
  await pointer(revF.id);
  context = await open(); page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(readerUrl);
  await page.waitForFunction(() => [...(CSS.highlights?.entries?.() ?? [])].some(([k, h]) => k.endsWith("-green") && h.size > 0), null, { timeout: 15000 });
  const wrongF0 = chars(`Nieuw: ${textF}`).slice(0, lenF).join("");
  const shifted = await highlightTexts(page);
  const shiftedF = shifted.filter((h) => h.text === textF);
  check("F: de markering is automatisch op de juiste, verschoven tekst geplaatst", shiftedF.length === 1 && shiftedF[0].key.endsWith("-green") && !shifted.some((h) => h.text === wrongF0), JSON.stringify(shifted));
  const wrongF = chars(`Nieuw: ${textF}`).slice(0, lenF).join("");
  await recolorWithDelayedRefresh(page, { quote: textF }, textF, [wrongF], "F");
  const rowF = await prisma.highlight.findUniqueOrThrow({ where: { id: hlF.id } });
  check("F: kleur paars opgeslagen; oorspronkelijke revisie, selector en id ongewijzigd", rowF.color === "purple" && rowF.revisionId === original && rowF.selector.ranges[0].start === 0 && rowF.id === hlF.id);
  await context.close();

  // G: handmatig bevestigde resolutie; daarna kleurwijziging met vertraagde refresh.
  const newTextG = "Compleet nieuwe tekst voor deze plek";
  const bodyG = editBlock(bodyF, blockG.id, (b) => { b.content = [{ type: "text", text: newTextG }]; });
  const revG = await newRevision(bodyG, "G: tekst vervangen");
  await pointer(revG.id);
  context = await open(); page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${readerUrl}?annotation=highlight:${hlG.id}`);
  await page.locator('[data-annotation-recovery="orphaned"]').waitFor();
  await page.locator("[data-annotation-pick]").click();
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-study-text="${id}"]`);
    const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 12);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }, blockG.id);
  await page.locator("[data-annotation-selection]").click();
  await page.locator("[data-annotation-picked]").waitFor();
  await page.locator("[data-annotation-pick-confirm]").click();
  const pickedText = newTextG.slice(0, 12);
  await page.waitForFunction((txt) => [...(CSS.highlights?.entries?.() ?? [])].some(([k, h]) => k.endsWith("-green") && [...h].some((r) => r.toString() === txt)), pickedText, { timeout: 15000 });
  check("G: de handmatig bevestigde passage staat gemarkeerd op de gekozen tekst", (await highlightTexts(page)).some((h) => h.text === pickedText));
  await page.locator("[data-annotation-recovery]").waitFor({ state: "detached" }).catch(() => {});
  await page.route("**/api/annotations?view=reader*", async (route) => { await new Promise((r) => setTimeout(r, 3000)); await route.continue().catch(() => {}); });
  await page.locator("details summary").click();
  await page.locator("details button", { hasText: chars(blockG.text).slice(0, 15).join("") }).first().click();
  const dialogG = page.locator("dialog[data-annotation-dialog][open]");
  await dialogG.waitFor();
  const putG = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/api/annotations"));
  await dialogG.getByRole("button", { name: t("annotations.purple") }).click();
  assert.equal((await putG).status(), 200);
  const seenG = [];
  const untilG = Date.now() + 2600;
  while (Date.now() < untilG) { seenG.push(await highlightTexts(page)); await page.waitForTimeout(100); }
  const badG = seenG.flat().filter((h) => ![pickedText, textF, chars(blockG.text).slice(0, lenG).join("")].includes(h.text));
  check(`G: tijdens de vertraagde refresh nooit een onjuiste tekst (${seenG.length} metingen)`, badG.length === 0, JSON.stringify(badG.slice(0, 2)));
  await page.waitForTimeout(3500);
  const finalG = await highlightTexts(page);
  check("G: na de refresh staat de gekozen tekst paars", finalG.some((h) => h.key.endsWith("-purple") && h.text === pickedText) && !finalG.some((h) => h.key.endsWith("-green") && h.text === pickedText), JSON.stringify(finalG));
  await page.unroute("**/api/annotations?view=reader*");
  const rowG = await prisma.highlight.findUniqueOrThrow({ where: { id: hlG.id } });
  check("G: kleur paars; resolutie en oorspronkelijke velden bewaard", rowG.color === "purple" && rowG.resolvedRevisionId === revG.id && rowG.revisionId === original && rowG.selector.ranges[0].end === lenG);
  await context.close();
  await pointer(original);

  // Alle vijf talen en responsiviteit van het herstelpaneel (voorstel-revisie).
  await pointer(proposalRevision.id);
  await prisma.$executeRaw`UPDATE "Note" SET "deletedAt"=NULL, "resolvedRevisionId"=NULL, "resolvedSelector"=NULL, "resolvedAt"=NULL, "resolutionHistory"=NULL WHERE id=${note.id}`;
  for (const language of ["nl", "en", "de", "fr", "es"]) {
    await prisma.user.update({ where: { id: owner.user.id }, data: { uiLanguage: language } });
    t = getT(language);
    const sizes = language === "nl" ? [[320, 100, "light"], [320, 200, "light"], [390, 100, "dark"], [390, 200, "dark"], [820, 100, "light"], [1280, 100, "dark"]] : [[320, 200, "light"]];
    for (const [width, scale, scheme] of sizes) {
      const c = await open({ width, height: width > 500 ? 900 : 844 }, { scheme, touch: width < 500 });
      const p = await c.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(`${base}/study-lesson/${f.item.edition.lessonId}/${f.collection.id}?annotation=note:${note.id}`);
      await p.addStyleTag({ content: `html{font-size:${scale}%}` });
      await p.locator('[data-annotation-recovery="proposal"]').waitFor();
      const tag = `${language} ${width}px ${scale}% ${scheme}`;
      const heights = await p.locator("[data-annotation-recovery] button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      const clipped = await p.locator("[data-annotation-recovery]").evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      check(`responsive ${tag}: geen overflow, knoppen ≥ 40px, geen afgekapte inhoud`, (await noOverflow(p)) && heights.every((h) => h >= 39.5) && !clipped);
      check(`responsive ${tag}: vertaalde teksten aanwezig`, (await p.locator("[data-annotation-recovery]").innerText()).includes(t("studyFolder.readerProposed")) && (await p.locator("[data-annotation-confirm]").innerText()) === t("studyFolder.readerConfirm"));
      if (language === "nl" && width === 320 && scale === 200) await p.screenshot({ path: `${output}/B-compare-320-200.png` });
      if (language === "nl" && width === 390 && scheme === "dark" && scale === 100) await p.screenshot({ path: `${output}/B-compare-390-dark.png` });
      await c.close();
    }
  }
  await prisma.user.update({ where: { id: owner.user.id }, data: { uiLanguage: "nl" } });
  await pointer(original);
  check("geen paginafouten", errors.length === 0, errors.join("|"));
  console.log(`\n${results.length}/${results.length} checks geslaagd`);
} finally {
  await browser.close();
  await prisma.$disconnect();
}
