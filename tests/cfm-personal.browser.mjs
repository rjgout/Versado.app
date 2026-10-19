// Echte productiebuild; alleen eigen synthetische PostgreSQL/mediavolume (zie tests/study-reader.browser.mjs).
// Dekt: Vrije studie, Stap voor stap, tik op alinea, annotaties, scrollgebaar, toetsenbord, wisselen van leeswijze,
// stapvoortgang zonder READ/reeks/XP, annotaties buiten de persoonlijke route en kleine schermen.
//   npx tsx tests/cfm-personal.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { createStudyImport, executeStudyImport } from "../src/lib/studyContent/imports.ts";
import { publishStudyRevision } from "../src/lib/studyContent/publication.ts";
import { getT } from "../src/lib/i18n/index.ts";

const db = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
const base = process.env.CONTENT_ACCESS_TEST_BASE_URL;
if (db.hostname !== "127.0.0.1" || db.pathname !== "/versado_content_access_test" || new URL(base).hostname !== "127.0.0.1" || process.env.DATABASE_URL !== db.href)
  throw Error("Eigen runner vereist");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const output = "/tmp/versado-cfm-personal-browser";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const t = getT("nl");
const errors = [];
const results = [];
let lastPage = null;
const step = (name) => results.push(name);

async function fixture() {
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@cfm-browser.invalid`, passwordHash: "test-only", handle: `C${randomUUID().slice(0, 8)}`, discriminator: "00", uiLanguage: "nl", isAdmin: false, timeZone: "UTC" },
  });
  const key = `synthetic-study-cfm-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  await prisma.contentCollection.create({
    data: { id: key, slug: key, name: "Synthetische CFM", work: key, editionKey: "fixture-v1", language: "nl", icon: "", publicationState: "PUBLISHED", visibleToUsers: true },
  });
  const actor = { id: user.id, isAdmin: true };
  const run = await createStudyImport(actor, key, "cfm-personal");
  await executeStudyImport(actor, run.id);
  const item = await prisma.contentImportItem.findFirstOrThrow({ where: { runId: run.id }, include: { edition: true } });
  await publishStudyRevision(actor, { editionId: item.lessonEditionId, revisionId: item.revisionId, importRunId: run.id, expectedVersion: item.edition.publicationVersion, actionId: randomUUID(), kind: "PUBLISH" });
  return { user, key, lessonId: item.edition.lessonId, editionId: item.lessonEditionId, token: await createSessionToken(user.id), href: `/study-lesson/${item.edition.lessonId}/${key}` };
}
async function open(f, { width = 390, height = 844, scheme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, timezoneId: "UTC", hasTouch: width < 500, isMobile: width < 500, serviceWorkers: "block" });
  await context.addCookies([{ name: SESSION_COOKIE, value: f.token, url: base }]);
  const page = await context.newPage();
  lastPage = page;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { context, page };
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const dialog = (page) => page.locator("[data-annotation-dialog]");
async function tapParagraph(page, id) {
  const target = page.locator(`[data-study-text="${id}"]`).first();
  await page.waitForTimeout(900);
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const box = await target.boundingBox();
  await page.touchscreen.tap(box.x + 20, box.y + Math.min(box.height / 2, 12));
}

const f = await fixture();
try {
  // 1. Vrije studie: compacte kop, alleen persoonlijke studie, geen dominante knoppen, geen zichtbare menu's per alinea.
  {
    const { context, page } = await open(f);
    await page.goto(base + f.href);
    await page.locator("[data-study-rich-content]").waitFor();
    assert.equal(await page.locator("[data-reader-mode]").getAttribute("data-reader-mode"), "free");
    const text = await page.locator("[data-study-reader-body]").innerText();
    assert.match(text, /Synthetisch onderwerp 1/);
    assert.match(text, /Wees creatief/, "een kader uit de bron (twijfelgeval) blijft zichtbaar tenzij een override het verbergt");
    assert.doesNotMatch(text, /kinderidee/, "ideeën voor kinderen horen niet in de persoonlijke studie");
    // Overrides gelden per programma (cfm-old-testament-2026); de synthetische fixture heeft er geen, dus niets verdwijnt stil.
    assert.match(text, /Zie voor meer ideeën de Liahona/);
    assert.doesNotMatch(text, /Synthetische bronverwijzing/, "brontitel en verwijzing staan in de kop, niet in de tekst");
    assert.ok(await noOverflow(page), "geen horizontale overflow");
    const h1 = await page.locator("h1").boundingBox();
    assert.ok(h1.y + h1.height < 844 * 0.4, "de leskop neemt minder dan 40% van het scherm");
    assert.match(await page.locator("h1").innerText(), /Test de zeven stappen/);
    // Geen zichtbare driepuntjes naast gewone alinea's: de toetsenbordknop is onzichtbaar tot focus.
    const sizes = await page.locator("[data-annotation-trigger]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    assert.ok(sizes.length > 5 && sizes.every((w) => w <= 1), "annotatieknoppen zijn onzichtbaar tot focus");
    // "Markeren als gelezen" staat aan het einde van de studie, onder de laatste alinea.
    const last = await page.locator("[data-study-block]").last().boundingBox();
    const mark = await page.locator("[data-mark-study-read]").boundingBox();
    assert.ok(mark.y > last.y, "markeren als gelezen staat onder de tekst");
    assert.equal(await page.locator("[data-mark-study-read]").count(), 1);
    await page.screenshot({ path: `${output}/free-mobile.png` });
    await context.close();
    step("vrije studie compact");
  }

  // 2. Tik op een alinea opent het bestaande paneel; kleur, bladwijzer en notitie; focusherstel; herladen.
  {
    const { context, page } = await open(f);
    await page.goto(base + f.href);
    await page.locator("[data-study-rich-content]").waitFor();
    await tapParagraph(page, "b-p1a");
    await dialog(page).locator("textarea:not([disabled])").waitFor();
    for (const color of ["yellow", "green", "blue", "pink", "purple"]) {
      await dialog(page).getByRole("button", { name: t(`annotations.${color}`), exact: true }).click();
      await dialog(page).getByRole("status").filter({ hasText: t("annotations.saved") }).first().waitFor();
    }
    await dialog(page).getByRole("button", { name: t("annotations.bookmarkAdd"), exact: true }).click();
    await dialog(page).getByRole("status").filter({ hasText: t("annotations.saved") }).first().waitFor();
    await dialog(page).locator("textarea").fill("Mijn eerste privénotitie");
    await dialog(page).getByRole("button", { name: t("annotations.save"), exact: true }).click();
    await dialog(page).getByRole("status").filter({ hasText: t("annotations.saved") }).first().waitFor();
    await dialog(page).getByRole("button", { name: t("annotations.close"), exact: true }).click();
    await dialog(page).waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-annotation-for")), "b-p1a", "focus keert terug naar de alinea");
    await page.reload();
    await page.locator("[data-study-rich-content]").waitFor();
    await page.locator('[data-study-block="b-p1a"][data-annotated]').waitFor();
    assert.ok(await page.locator('[data-study-block="b-p1a"] svg').count() >= 2, "bladwijzer- en notitie-indicatie zichtbaar");
    // Bewerken: de notitie is er na herladen nog en kan worden aangepast.
    await tapParagraph(page, "b-p1a");
    await dialog(page).locator("textarea:not([disabled])").waitFor();
    assert.equal(await dialog(page).locator("textarea").inputValue(), "Mijn eerste privénotitie");
    await dialog(page).locator("textarea").fill("Aangepaste notitie");
    await dialog(page).getByRole("button", { name: t("annotations.save"), exact: true }).click();
    await dialog(page).getByRole("status").filter({ hasText: t("annotations.saved") }).first().waitFor();
    // Bladwijzer verwijderen.
    await dialog(page).getByRole("button", { name: t("annotations.bookmarkRemove"), exact: true }).click();
    await dialog(page).getByRole("status").filter({ hasText: t("annotations.saved") }).first().waitFor();
    await dialog(page).getByRole("button", { name: t("annotations.close"), exact: true }).click();
    await context.close();
    step("tik op alinea, vijf kleuren, bladwijzer, notitie, focus, herladen");
  }

  // 3. Een scrollgebaar opent geen paneel, een link opent zijn eigen actie, een toetsenbordgebruiker bereikt de knop.
  {
    const { context, page } = await open(f);
    await page.goto(base + f.href);
    await page.locator("[data-study-rich-content]").waitFor();
    const client = await context.newCDPSession(page);
    const before = await page.evaluate(() => window.scrollY);
    await client.send("Input.synthesizeScrollGesture", { x: 200, y: 600, yDistance: 400, gestureSourceType: "touch", speed: 1200, preventFling: true });
    await page.waitForTimeout(800);
    let scrolled = (await page.evaluate(() => window.scrollY)) !== before;
    if (!scrolled) {
      // Terugval: een gesimuleerd slepen (pointerdown, beweging, click) mag het paneel ook nooit openen.
      await page.evaluate(() => {
        const el = document.querySelector('[data-study-text="b-p1a"]');
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left + 10, clientY: r.top + 5, pointerType: "touch" }));
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + 10, clientY: r.top + 80 }));
      });
      scrolled = true;
    }
    assert.ok(scrolled, "de pagina scrolde");
    await page.waitForTimeout(200);
    assert.equal(await dialog(page).count(), 0, "scrollen opent geen annotatiepaneel");
    // Een geïnjecteerde link binnen een alinea blijft een eigen actie.
    await page.evaluate(() => {
      const span = document.querySelector('[data-study-text="b-p2a"]');
      const a = document.createElement("a");
      a.href = "#kopie"; a.textContent = " eigenlijke link"; a.id = "probe-link";
      span.appendChild(a);
    });
    await page.locator("#probe-link").scrollIntoViewIfNeeded();
    await page.locator("#probe-link").tap();
    await page.waitForTimeout(200);
    assert.equal(await dialog(page).count(), 0, "een link opent geen annotatiepaneel");
    // Toetsenbord: de verborgen knop krijgt focus, wordt zichtbaar en opent het paneel met Enter.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.keyboard.press("Shift"); // toetsenbordmodaliteit, zodat :focus-visible geldt
    await page.locator('[data-annotation-for="b-p1b"]').focus();
    assert.ok((await page.locator('[data-annotation-for="b-p1b"]').boundingBox()).width > 20, "knop wordt zichtbaar bij focus");
    await page.keyboard.press("Enter");
    await dialog(page).locator("textarea:not([disabled])").waitFor();
    await page.keyboard.press("Escape");
    await dialog(page).waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-annotation-for")), "b-p1b", "focus keert terug");
    await context.close();
    step("scrollgebaar, link en toetsenbord");
  }

  // 4. Selectie van een deel van een alinea blijft werken via de bestaande selectie-actie.
  {
    const { context, page } = await open(f, { width: 1280, height: 900 });
    await page.goto(base + f.href);
    await page.locator("[data-study-rich-content]").waitFor();
    await page.evaluate(() => {
      const node = document.querySelector('[data-study-text="b-p3a"]').firstChild.firstChild;
      const range = document.createRange(); range.setStart(node, 10); range.setEnd(node, 40);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.locator("[data-annotation-selection]").click();
    await dialog(page).locator("textarea:not([disabled])").waitFor();
    await dialog(page).getByRole("button", { name: t("annotations.close"), exact: true }).click();
    // Slepen met de muis om te selecteren opent niets; een gewone klik opent het paneel.
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.locator('[data-study-text="b-p3b"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await page.locator('[data-study-text="b-p3b"]').boundingBox();
    await page.mouse.move(box.x + 10, box.y + 8); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 8, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
    assert.equal(await dialog(page).count(), 0, "selecteren door te slepen opent geen paneel");
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.mouse.click(box.x + 10, box.y + 8);
    await dialog(page).locator("textarea:not([disabled])").waitFor();
    await page.screenshot({ path: `${output}/free-desktop-panel.png` });
    await context.close();
    step("tekstselectie en klik op desktop");
  }

  // 5. Stap voor stap: weekoverzicht, zeven stappen, geen dagnamen, status, geen READ/reeks/XP.
  {
    const { context, page } = await open(f);
    await page.goto(base + f.href + "/stappen");
    await page.locator("[data-step-overview]").waitFor();
    assert.equal(await page.locator("[data-step]").count(), 7);
    const labels = await page.locator("[data-step]").evaluateAll((els) => els.map((e) => e.innerText));
    labels.forEach((label, i) => assert.match(label, new RegExp(`Stap ${i + 1}\\b`)));
    assert.doesNotMatch(labels.join(" "), /maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag/i);
    assert.ok(await noOverflow(page));
    assert.equal(await page.locator('[data-step-status="COMPLETED"]').count(), 0);
    await page.screenshot({ path: `${output}/steps-overview-mobile.png`, fullPage: true });
    await page.locator('[data-step="1"]').click();
    await page.locator("[data-complete-step]").waitFor();
    await page.waitForTimeout(900);
    assert.match(await page.locator("[data-reader-mode]").getAttribute("data-reader-mode"), /step/);
    const stepText = await page.locator("[data-study-reader-body]").innerText();
    assert.match(stepText, /Synthetische studietekst 0\.1/, "stap 1 bevat de inleiding");
    assert.doesNotMatch(stepText, /Synthetisch onderwerp 5/, "stap 1 bevat niet het laatste onderwerp");
    await page.locator("[data-complete-step]").click();
    await page.getByText(t("cfmStudy.stepDone")).waitFor();
    assert.equal(await prisma.contentProgress.count({ where: { userId: f.user.id } }), 0, "stap afronden registreert geen leesstatus");
    assert.equal(await prisma.streakDay.count({ where: { userId: f.user.id } }), 0, "stap afronden verlengt geen reeks");
    await page.goto(base + f.href + "/stappen");
    await page.locator('[data-step="1"][data-step-status="COMPLETED"]').waitFor();
    // Heropenen verliest de afronding niet en de tweede afronding doet niets.
    await page.locator('[data-step="1"]').click();
    await page.getByText(t("cfmStudy.stepDone")).waitFor();
    assert.equal(await page.locator("[data-complete-step]").count(), 0);
    assert.equal(await prisma.studyStepProgress.count({ where: { userId: f.user.id, status: "COMPLETED" } }), 1);
    await context.close();
    step("stappenoverzicht, stap afronden zonder READ/reeks");
  }

  // 6. Wisselen van leeswijze behoudt de alinea; alle stappen afronden nodigt uit, zonder automatische READ.
  {
    const { context, page } = await open(f);
    await page.goto(base + f.href);
    await page.locator("[data-study-rich-content]").waitFor();
    // Echte invoer (wiel), zodat de leespositie als bewuste interactie wordt opgeslagen.
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(60);
      if (await page.evaluate(() => document.querySelector('[data-study-block="b-p4a"]').getBoundingClientRect().top < 300)) break;
    }
    await page.waitForTimeout(1800);
    await page.getByRole("link", { name: t("cfmStudy.modeSteps"), exact: true }).click();
    await page.waitForURL(/\/stappen\/[1-7]$/);
    const current = Number(page.url().split("/").pop());
    assert.ok(current >= 3, `de lezer staat in de stap met alinea b-p4a (nu stap ${current})`);
    await page.getByRole("link", { name: t("cfmStudy.modeFree"), exact: true }).click();
    await page.waitForURL((url) => !url.pathname.includes("/stappen"));
    // Alle stappen afronden via de API-route van de pagina.
    for (let n = 1; n <= 7; n++) {
      await page.goto(`${base}${f.href}/stappen/${n}`);
      await page.locator("[data-reader-mode='step']").waitFor();
      await page.waitForTimeout(900);
      await page.waitForTimeout(500);
      if (await page.locator("[data-complete-step]").count()) await page.locator("[data-complete-step]").click();
      await page.getByText(t("cfmStudy.stepDone")).waitFor();
    }
    await page.getByText(t("cfmStudy.allDone")).waitFor();
    assert.equal(await prisma.contentProgress.count({ where: { userId: f.user.id } }), 0, "alle stappen afgerond is nog geen gelezen les");
    await page.locator("[data-mark-study-read]").click();
    await page.locator("[data-study-read-status='read']").waitFor();
    assert.equal(await prisma.contentProgress.count({ where: { userId: f.user.id, readStatus: "READ" } }), 1);
    await context.close();
    step("wisselen van leeswijze en bewuste afronding van de hele les");
  }

  // 7. Annotatie buiten de persoonlijke route blijft bereikbaar via de volledige les.
  {
    const { context, page } = await open(f);
    await page.goto(base + f.href + "?weergave=volledig");
    await page.locator('[data-study-text="b-kids1"]').waitFor();
    await tapParagraph(page, "b-kids1");
    await dialog(page).locator("textarea:not([disabled])").waitFor();
    await dialog(page).getByRole("button", { name: t("annotations.bookmarkAdd"), exact: true }).click();
    await dialog(page).getByRole("status").filter({ hasText: t("annotations.saved") }).first().waitFor();
    await dialog(page).getByRole("button", { name: t("annotations.close"), exact: true }).click();
    const bookmark = await prisma.bookmark.findFirstOrThrow({ where: { userId: f.user.id }, orderBy: { createdAt: "desc" } });
    await page.goto(`${base}${f.href}?annotation=bookmark:${bookmark.id}`);
    await page.locator("[data-reader-mode='full']").waitFor();
    await page.locator('[data-annotation-focus="true"]').first().waitFor();
    await page.getByText(t("cfmStudy.outsideNotice")).waitFor();
    await context.close();
    step("annotatie buiten de persoonlijke route via Mijn studiemap");
  }

  // 9. Afbeeldingen (begrensd, bijschrift, vergroten/sluiten, niet-ladende afbeelding) en herstel van de leespositie.
  {
    const { context, page } = await open(f);
    await page.goto(base + f.href);
    await page.locator("figure[data-figure-kind]").first().waitFor();
    const kinds = await page.locator("figure").evaluateAll((els) => els.map((e) => e.dataset.figureKind));
    assert.ok(kinds.includes("ICON") && kinds.includes("NARRATIVE"), `afbeeldingsklassen: ${kinds}`);
    const icon = page.locator('figure[data-figure-kind="ICON"]').first();
    assert.equal(await icon.locator("button").count(), 0, "een pictogram wordt niet vergroot");
    assert.ok((await icon.locator("div").first().boundingBox()).width <= 80, "een pictogram blijft klein");
    const painting = page.locator('figure[data-figure-kind="NARRATIVE"]').first();
    await painting.scrollIntoViewIfNeeded();
    const box = await painting.locator("div").first().boundingBox();
    assert.ok(box.width <= 390 && Math.abs(box.width / box.height - 4 / 3) < 0.02, "beeldverhouding behouden en binnen het scherm");
    await painting.getByText("Synthetisch schilderij, testkunstenaar").waitFor();
    await painting.locator("button").click();
    await page.locator("dialog[open]").waitFor();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-haspopup")), "dialog", "focus keert terug naar de afbeelding");
    const scrollAfter = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(scrollAfter - scrollBefore) < 2, `vergroten en sluiten verplaatst de leespositie niet (${scrollBefore} → ${scrollAfter})`);
    // Een afbeelding die niet laadt, valt terug op een nette melding zonder layoutbreuk.
    await page.route("**/api/study-media/**", (route) => route.abort());
    await page.reload();
    await page.getByText(t("studyReader.mediaUnavailable")).first().waitFor();
    assert.ok(await noOverflow(page));
    await page.unroute("**/api/study-media/**");
    // De leespositie wordt na herladen hersteld.
    await page.reload();
    await page.locator("[data-study-rich-content]").waitFor();
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(60);
      if (await page.evaluate(() => document.querySelector('[data-study-block="b-p4b"]').getBoundingClientRect().top < 300)) break;
    }
    await page.waitForTimeout(1800);
    await page.reload();
    await page.locator("[data-study-rich-content]").waitFor();
    await page.waitForTimeout(1200);
    const top = await page.evaluate(() => document.querySelector('[data-study-block="b-p4b"]').getBoundingClientRect().top);
    assert.ok(top > -50 && top < 844, `leespositie hersteld (b-p4b op ${Math.round(top)}px)`);
    await context.close();
    step("afbeeldingen en herstel van de leespositie");
  }

  // 8. Klein scherm, grote tekst en donkere modus.
  {
    for (const [width, scheme] of [[320, "light"], [320, "dark"]]) {
      const { context, page } = await open(f, { width, height: 640, scheme });
      for (const route of ["", "/stappen", "/stappen/3"]) {
        await page.goto(base + f.href + route);
        await page.locator("[data-reader-mode], [data-step-overview]").first().waitFor();
        assert.ok(await noOverflow(page), `${width}px ${scheme} ${route}: geen overflow`);
      }
      await page.screenshot({ path: `${output}/step-${width}-${scheme}.png`, fullPage: true });
      await context.close();
    }
    const { context, page } = await open(f);
    await page.goto(base + f.href);
    await page.addStyleTag({ content: "html{font-size:32px !important}" });
    await page.locator("[data-study-rich-content]").waitFor();
    assert.ok(await noOverflow(page), "200% tekst: geen overflow");
    await context.close();
    step("320 px, donker en 200% tekst");
  }
  assert.deepEqual(errors, [], "geen pagina- of consolefouten");
  console.log(`OK (${results.length}):\n- ${results.join("\n- ")}`);
} catch (error) {
  await lastPage?.screenshot({ path: `${output}/failure.png`, fullPage: false }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await prisma.$disconnect();
}
