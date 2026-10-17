// Werkelijke productiebuild en eigen PostgreSQL. Geen productiegegevens.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { prisma } from "../src/lib/db.ts";
import { SESSION_COOKIE } from "../src/lib/auth.ts";
import {
  referenceFixture,
  ensureReferenceScripture,
  assertReferenceTestEnvironment,
} from "./fixtures/reference-content.mjs";
import { getT } from "../src/lib/i18n/index.ts";
const base = assertReferenceTestEnvironment(),
  require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.CHROMIUM_PATH,
});
const output = "/tmp/versado-annotation-actions-browser";
mkdirSync(output, { recursive: true });
const results = [],
  errors = [];
try {
  const unit = await browser.newPage();
  const bundle = buildSync({
    entryPoints: ["src/lib/annotations/domSelector.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "AnnotationDOM",
    platform: "browser",
  }).outputFiles[0].text;
  await unit.setContent(
    '<main id="root"><section data-study-section="s"><p><span data-study-text="p"><b>Je\u0301zus</b> 😀 <a href="#">samen</a></span></p><ul><li><span data-study-text="li">Lijst</span><ul><li><span data-study-text="nested">Genest</span></li></ul></li></ul><blockquote data-study-text="q">Citaat\n<cite>Auteur</cite></blockquote><table><tbody><tr><td data-study-text="cell">Cel</td></tr></tbody></table><p data-study-text="question">Vraag?</p></section><section data-study-section="other"><p data-study-text="else">Elders</p></section></main>',
  );
  await unit.addScriptTag({ content: bundle });
  const selectorChecks = await unit.evaluate(() => {
    const text = (value) => [{ type: "text", text: value }];
    const body = {
      schemaVersion: 1,
      sections: [
        {
          id: "s",
          blocks: [
            {
              id: "p",
              type: "paragraph",
              content: text("Je\u0301zus 😀 samen"),
            },
            {
              id: "list",
              type: "list",
              items: [
                {
                  id: "li",
                  content: text("Lijst"),
                  children: [{ id: "nested", content: text("Genest") }],
                },
              ],
            },
            {
              id: "q",
              type: "quote",
              content: text("Citaat"),
              attribution: text("Auteur"),
            },
            {
              id: "table",
              type: "table",
              rows: [
                { id: "row", cells: [{ id: "cell", content: text("Cel") }] },
              ],
            },
            { id: "question", type: "question", content: text("Vraag?") },
          ],
        },
        {
          id: "other",
          blocks: [{ id: "else", type: "paragraph", content: text("Elders") }],
        },
      ],
    };
    const root = document.querySelector("#root"),
      api = window.AnnotationDOM,
      checks = [];
    const expect = (condition, label) => {
      if (!condition) throw Error(label);
      checks.push(label);
    };
    const reject = (fn, label) => {
      let failed = false;
      try {
        fn();
      } catch {
        failed = true;
      }
      expect(failed, label);
    };
    const full = (id) => {
      const r = document.createRange();
      r.selectNodeContents(document.querySelector(`[data-study-text="${id}"]`));
      return r;
    };
    const select = (r) => api.selectionToSelector(root, body, "revision", r);
    const first = select(full("p"));
    expect(
      first.exact === "Jézus 😀 samen",
      "Unicode en directe inlineconcatenatie",
    );
    expect(first.ranges[0].end === 13, "codepunten, niet UTF-16");
    expect(
      api.selectorRanges(root, first)[0].toString().normalize("NFC") ===
        first.exact,
      "visuele range zonder DOM-wijziging",
    );
    const cross = full("p");
    cross.setEndAfter(document.querySelector('[data-study-text="nested"]')); // Oudergrens bewust ongeldig.
    const valid = full("p");
    const end = document.querySelector('[data-study-text="nested"]').firstChild;
    valid.setEnd(end, end.length);
    expect(select(valid).ranges.length === 3, "multiblok en geneste lijst");
    expect(
      select(full("q")).exact === "Citaat Auteur",
      "citaat en toeschrijving",
    );
    expect(
      select(full("cell")).exact === "Cel" &&
        select(full("question")).exact === "Vraag?",
      "tabel en vraag",
    );
    const outside = full("p");
    outside.setEnd(
      document.querySelector('[data-study-text="else"]').firstChild,
      6,
    );
    reject(() => select(outside), "sectiegrens geweigerd");
    const composition = full("p");
    composition.setEnd(document.querySelector("b").firstChild, 2);
    reject(() => select(composition), "grens in NFC-compositie geweigerd");
    const emoji = full("p");
    emoji.setStart(
      document.querySelector('[data-study-text="p"]').childNodes[1],
      2,
    );
    reject(() => select(emoji), "halve surrogate geweigerd");
    const duplicate = document
      .querySelector('[data-study-text="li"]')
      .cloneNode(true);
    document.querySelector("section").append(duplicate);
    reject(() => select(full("li")), "ambigu anker geweigerd");
    duplicate.remove();
    const p = document.querySelector("b").firstChild;
    p.textContent = "Gewijzigde DOM";
    reject(() => select(full("p")), "DOM wijkt af van gepinde revisie");
    return checks;
  });
  console.log(`DOM: ${selectorChecks.length} selectorchecks geslaagd`);
  results.push({ selectorChecks });
  await unit.close();
  const f = await referenceFixture();
  await prisma.user.update({
    where: { id: f.owner.user.id },
    data: {
      onboardingSeenAt: new Date(),
      onboardingProfilePrivacyAt: new Date(),
    },
  });
  const t = getT("nl"),
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block",
    });
  await context.addCookies([
    { name: SESSION_COOKIE, value: f.owner.token, url: base },
  ]);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const legacy = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && /\/api\/verses\//.test(r.url()))
      legacy.push(r.url());
  });
  async function open(p = page) {
    await p.locator("#study-paragraph-intro [data-annotation-trigger]").click();
    await p
      .locator("[data-annotation-dialog] textarea:not([disabled])")
      .waitFor();
  }
  const dialog = page.locator("[data-annotation-dialog]");
  async function saved(p = page) {
    await p
      .locator("[data-annotation-dialog]")
      .getByRole("status")
      .filter({ hasText: t("annotations.saved") })
      .waitFor();
  }
  async function close(p = page) {
    await p
      .locator("[data-annotation-dialog]")
      .getByRole("button", { name: t("annotations.close"), exact: true })
      .click();
    await p.locator("[data-annotation-dialog]").waitFor({ state: "detached" });
  }
  await page.goto(base + f.href);
  // Werkelijke DOM-adapter op de gerenderde tekst, niet alleen op een losse fixture.
  await page.locator("#study-paragraph-intro [data-study-text]").waitFor();
  await page.evaluate(() => {
    const text = document.querySelector(
      "#study-paragraph-intro [data-study-text]",
    ).firstChild.firstChild;
    const r = document.createRange();
    r.setStart(text, 0);
    r.setEnd(text, 12);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await open();
  assert.equal(await dialog.locator("p").first().textContent(), "Synthetische");
  await close();
  await page.evaluate(() => getSelection().removeAllRanges());
  await open();
  await dialog.locator("textarea").fill("Eerste privénotitie 😀");
  await dialog
    .getByRole("button", { name: t("annotations.save"), exact: true })
    .click();
  await saved();
  await dialog
    .getByRole("button", { name: t("annotations.blue"), exact: true })
    .click();
  await saved();
  await dialog
    .getByRole("button", { name: t("annotations.bookmarkAdd"), exact: true })
    .click();
  await saved();
  await close();
  await page.reload();
  await open();
  assert.equal(
    await dialog.locator("textarea").inputValue(),
    "Eerste privénotitie 😀",
  );
  assert.equal(
    await dialog
      .getByRole("button", { name: t("annotations.blue"), exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  // Response verloren nadat de server de mutatie heeft vastgelegd: dezelfde UUID bij retry.
  let attempt = 0;
  const payloads = [];
  await page.route("**/api/annotations", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    payloads.push(route.request().postDataJSON());
    attempt++;
    if (attempt === 1) {
      await route.abort("internetdisconnected");
    } else if (attempt === 2) {
      const response = await route.fetch();
      assert.equal(
        response.status(),
        200,
        "De server commit voordat de response verloren gaat",
      );
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetische verbroken proxyresponse" }),
      });
    } else await route.continue();
  });
  await dialog.locator("textarea").fill("Onzekere opslag");
  await dialog
    .getByRole("button", { name: t("annotations.save"), exact: true })
    .click();
  await dialog
    .getByRole("button", { name: t("annotations.retry"), exact: true })
    .waitFor();
  assert.equal(
    await dialog.locator("textarea").inputValue(),
    "Onzekere opslag",
  );
  await dialog
    .getByRole("button", { name: t("annotations.retry"), exact: true })
    .click();
  await dialog
    .getByRole("button", { name: t("annotations.retry"), exact: true })
    .waitFor();
  await dialog
    .getByRole("button", { name: t("annotations.retry"), exact: true })
    .click();
  await saved();
  assert.equal(payloads.length, 3);
  assert.equal(payloads[0].actionId, payloads[1].actionId);
  assert.equal(payloads[0].actionId, payloads[2].actionId);
  await page.unroute("**/api/annotations");
  const second = await context.newPage();
  await second.goto(base + f.href);
  await open(second);
  const d2 = second.locator("[data-annotation-dialog]");
  await d2.locator("textarea").fill("Ander toestel");
  await d2
    .getByRole("button", { name: t("annotations.save"), exact: true })
    .click();
  await saved(second);
  await dialog.locator("textarea").fill("Niet stilzwijgend overschrijven");
  await dialog
    .getByRole("button", { name: t("annotations.save"), exact: true })
    .click();
  await dialog.getByText(t("annotations.conflict"), { exact: true }).waitFor();
  assert.equal(
    await dialog.locator("textarea").inputValue(),
    "Niet stilzwijgend overschrijven",
  );
  await dialog
    .getByRole("button", { name: t("annotations.reload"), exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-annotation-note]")?.value ===
      "Ander toestel",
  );
  await dialog
    .getByRole("button", { name: t("annotations.noteRemove"), exact: true })
    .click();
  await saved();
  assert.equal(await dialog.locator("textarea").inputValue(), "");
  assert.equal(await dialog.evaluate(element=>element.contains(document.activeElement)),true);
  await close();
  await second.close();
  // Referentie blijft onafhankelijk werken, zonder gelijktijdige annotatiedialoog.
  await page
    .getByRole("button", { name: "1 Nephi 1:1–3", exact: true })
    .click();
  await page.locator("dialog[open]").waitFor();
  assert.equal(await page.locator("[data-annotation-dialog]").count(), 0);
  await page.keyboard.press("Escape");
  // Een laat antwoord bij een gesloten target mag niet in de volgende passage belanden.
  let releaseOld, sawOld;
  const oldStarted = new Promise(resolve => sawOld = resolve);
  const oldGate = new Promise((resolve) => (releaseOld = resolve));
  let held = false;
  await page.route(
    /\/api\/annotations\?view=reader&targetKey=/,
    async (route) => {
      if (!held) {
        held = true;
        sawOld();
        await oldGate;
      }
      await route.continue().catch(() => {});
    },
  );
  await page
    .locator("#study-paragraph-intro [data-annotation-trigger]")
    .click();
  await dialog.waitFor();
  await oldStarted;
  await close();
  await page.locator("#study-question-intro [data-annotation-trigger]").click();
  await dialog.locator("textarea:not([disabled])").waitFor();
  releaseOld();
  assert.equal(
    await dialog.locator("p").first().textContent(),
    "Een synthetische vraag?",
  );
  await close();
  await page.unroute(/\/api\/annotations\?view=reader&targetKey=/);
  const newer = await f.publish("updated");
  await page.goto(base + f.href);
  await open();
  assert.equal(
    await dialog.locator("p").first().textContent(),
    "Bijgewerkte synthetische uitleg.",
  );
  assert.equal(await dialog.locator("textarea").inputValue(), "");
  assert.equal(await dialog.evaluate(element=>element.contains(document.activeElement)),true);
  await close();
  assert.notEqual(newer.revisionId, f.item.revisionId);
  // Verslezer: één hoofdstukread, expliciete API, geen legacy-toggles.
  const chapter = await ensureReferenceScripture();
  await page.goto(`${base}/lesson/${chapter.id}`);
  await page.locator("[data-annotation-trigger]").first().click();
  await dialog.locator("textarea:not([disabled])").waitFor();
  await dialog.locator("textarea").fill("Versnotitie");
  await dialog
    .getByRole("button", { name: t("annotations.save"), exact: true })
    .click();
  await saved();
  await close();
  await page.goto(`${base}/scripture/${chapter.id}`);
  await page.getByText("1 Nephi", { exact: false }).first().waitFor();
  assert.equal(await page.locator("[data-annotation-trigger]").count(), 0);
  assert.deepEqual(legacy, []);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }))
      .xpTotal,
    f.owner.user.xpTotal,
  );
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }))
      .hintBalance,
    f.owner.user.hintBalance,
  );
  results.push({
    flow: "note/highlight/bookmark, verloren response, twee toestellen/409, verwijderen, referentie en verse-preview",
    passed: true,
  });
  await context.close();
  // Matrix van echte sheets, alle vijf UI-talen, licht/donker, grote tekst en landscape.
  for (const [index, size] of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 900 },
    { width: 844, height: 390 },
  ].entries()) {
    for(const lang of index===0 ? ["nl","en","de","fr","es"] : [["nl","en","de","fr","es"][index]]) {
    await prisma.user.update({
      where: { id: f.owner.user.id },
      data: { uiLanguage: lang },
    });
    const tr = getT(lang);
    for (const scheme of ["light", "dark"])
      for (const scale of [100, 200]) {
        if(index===0&&lang!=="nl"&&scale===100)continue;
        const c = await browser.newContext({
          viewport: size,
          serviceWorkers: "block",
          colorScheme: scheme,
          hasTouch: size.width < 500 || size.height < 500,
          reducedMotion: "reduce",
        });
        await c.addCookies([
          { name: SESSION_COOKIE, value: f.owner.token, url: base },
        ]);
        const p = await c.newPage();
        p.on("pageerror", (e) => errors.push(e.message));
        await p.goto(base + f.href);
        await p.addStyleTag({ content: `html{font-size:${scale}%}` });
        const trigger = p.locator(
          "#study-paragraph-intro [data-annotation-trigger]",
        );
        await trigger.scrollIntoViewIfNeeded();
        await trigger.focus();
        const before = await p.evaluate(() => scrollY);
        await p.keyboard.press("Enter");
        const sheet = p.locator("[data-annotation-dialog]");
        await sheet.locator("textarea:not([disabled])").waitFor();
        const bounds = await sheet.boundingBox();
        assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= size.width + 1);
        assert.ok(
          bounds.y >= -1 && bounds.y + bounds.height <= size.height + 1,
        );
        assert.ok(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        assert.equal(
          await sheet.evaluate((e) => e.contains(document.activeElement)),
          true,
        );
        await sheet.locator("textarea").focus();
        await p.keyboard.press("Tab");
        assert.equal(
          await sheet.evaluate((e) => e.contains(document.activeElement)),
          true,
        );
        await p.screenshot({
          path: `${output}/${size.width}x${size.height}-${lang}-${scheme}-${scale}.png`,
        });
        await p.keyboard.press("Escape");
        await sheet.waitFor({ state: "detached" });
        assert.equal(
          await trigger.evaluate((e) => document.activeElement === e),
          true,
        );
        assert.ok(Math.abs((await p.evaluate(() => scrollY)) - before) < 2);
        if(index===0&&scheme==='light'&&scale===100){await p.keyboard.press('Space');await sheet.waitFor();await p.keyboard.press('Escape');await sheet.waitFor({state:'detached'});}
        if (index === 1 && scheme === "light" && scale === 100) {
          await trigger.dispatchEvent("pointerdown", { pointerType: "touch" });
          await p.waitForTimeout(600);
          await sheet.waitFor();
          await trigger.dispatchEvent("pointerup", { pointerType: "touch" });
          await trigger.dispatchEvent("click");
          assert.equal(await p.locator("[data-annotation-dialog]").count(), 1);
          await p.keyboard.press("Escape");
          await sheet.waitFor({ state: "detached" });
        }
        assert.ok(await trigger.getAttribute("aria-label"));
        assert.ok(tr("annotations.title"));
        results.push({ size, lang, scheme, scale, passed: true });
        await c.close();
      }
  }
    }
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify({
      dom: selectorChecks.length,
      flows: "passed",
      matrix: 28,
      errors,
    }),
  );
} catch (error) {
  for (const context of browser.contexts())
    for (const [i, page] of context.pages().entries()) {
      await page
        .screenshot({ path: `${output}/failure-${i}.png` })
        .catch(() => {});
      console.error({
        url: new URL(page.url()).pathname,
        annotationDialog: await page
          .locator("[data-annotation-dialog]")
          .count(),
        alerts: await page
          .locator("[data-annotation-dialog] [role=alert]")
          .allTextContents(),
      });
    }
  throw error;
} finally {
  await browser.close();
  await prisma.$disconnect();
}
