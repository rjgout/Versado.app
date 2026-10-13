// Echte productiebuild; alleen eigen synthetische PostgreSQL/mediavolume.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import {
  createStudyImport,
  executeStudyImport,
} from "../src/lib/studyContent/imports.ts";
import { appendStudyRevision } from "../src/lib/studyContent/revisions.ts";
import { getT } from "../src/lib/i18n/index.ts";
const db = new URL(
    process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid",
  ),
  base = process.env.CONTENT_ACCESS_TEST_BASE_URL;
if (
  db.hostname !== "127.0.0.1" ||
  db.pathname !== "/versado_content_access_test" ||
  new URL(base).hostname !== "127.0.0.1" ||
  process.env.DATABASE_URL !== db.href
)
  throw Error("Eigen runner vereist");
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright"),
  output = "/tmp/versado-study-reader-browser";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.CHROMIUM_PATH,
});
const results = [],
  errors = [];
async function fixture(lang = "nl") {
  const user = await prisma.user.create({
    data: {
      email: `${randomUUID()}@reader-browser.invalid`,
      passwordHash: "test-only",
      handle: `C${randomUUID().slice(0, 8)}`,
      discriminator: "00",
      uiLanguage: lang,
      isAdmin: false,
      xpTotal: 42,
      hintBalance: 8,
      timeZone: "UTC",
    },
  });
  const key = `synthetic-study-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  const collection = await prisma.contentCollection.create({
    data: {
      id: key,
      slug: key,
      name: "Synthetische studieles",
      work: key,
      editionKey: "fixture-v1",
      language: "nl",
      icon: "",
      publicationState: "PUBLISHED",
      visibleToUsers: true,
    },
  });
  const actor = { id: user.id, isAdmin: true }; // alleen directe fixture-opbouw, geen client/adminpreview.
  const run = await createStudyImport(actor, key, "sample");
  await executeStudyImport(actor, run.id);
  const item = await prisma.contentImportItem.findFirstOrThrow({
    where: { runId: run.id },
    include: { revision: true, edition: true },
  });
  const input = {
    schemaVersion: 1,
    title: "Synthetische doorlopende studieles",
    body: structuredClone(item.revision.body),
    sourceMetadata: item.revision.sourceMetadata,
    rightsMetadata: item.revision.rightsMetadata,
  };
  const paragraph = input.body.sections[0].blocks.find((b) => b.id === "paragraph-intro");
  paragraph.content.push({
    type: "link",
    text: "Veilige synthetische link",
    href: "https://example.invalid/study-link",
  });
  const list = input.body.sections[0].blocks.find((b) => b.type === "list");
  list.items[0].children = [
    {
      id: "reader-nested-item",
      content: [{ type: "text", text: "Geneste synthetische lijstinhoud." }],
    },
  ];
  for (let i = 0; i < 14; i++)
    input.body.sections.push({
      id: `section-long-${i}`,
      blocks: Array.from({ length: 6 }, (_, j) => ({
        id: `paragraph-${i}-${j}`,
        type: "paragraph",
        content: [
          {
            type: "text",
            text:
              `Synthetische leespassage ${i}.${j}. ` +
              "Dit is gecontroleerde testinhoud voor lezen en hervatten, zonder echte officiële teksten. ".repeat(
                5,
              ),
          },
        ],
      })),
    });
  const revision = await appendStudyRevision(
    actor,
    item.lessonEditionId,
    input,
  );
  const binding = await prisma.studyRevisionMedia.findFirstOrThrow({
    where: { revisionId: item.revisionId },
  });
  await prisma.studyRevisionMedia.create({
    data: {
      revisionId: revision.id,
      mediaKey: binding.mediaKey,
      mediaId: binding.mediaId,
    },
  });
  await prisma.studyLessonEdition.update({
    where: { id: item.lessonEditionId },
    data: { publishedRevisionId: revision.id, publicationVersion: 1 },
  });
  // Alleen fixturepublicatie op de eigen database; echte 2B-publish gate blijft gesloten.
  return {
    user,
    collection,
    edition: item.edition,
    revision,
    input,
    binding,
    actor,
    href: `/study-lesson/${item.edition.lessonId}/${key}`,
    token: await createSessionToken(user.id),
    t: getT(lang),
  };
}
async function context(f, width, scheme = "light", height = 844) {
  const c = await browser.newContext({
    viewport: { width, height },
    colorScheme: scheme,
    timezoneId: "UTC",
    hasTouch: width < 500 || width === 844,
    isMobile: width < 500,
    serviceWorkers: "block",
  });
  await c.addCookies([{ name: SESSION_COOKIE, value: f.token, url: base }]);
  return c;
}
async function until(fn, label) {
  for (let i = 0; i < 100; i++) {
    const value = await fn();
    if (value) return value;
    await delay(150);
  }
  throw Error(`Niet bereikt: ${label}`);
}
async function position(f) {
  return prisma.readingPosition.findUnique({
    where: {
      userId_lessonEditionId: {
        userId: f.user.id,
        lessonEditionId: f.edition.id,
      },
    },
  });
}
async function open(page, f) {
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}${f.href}`);
  await page.locator("[data-study-reader-body]").waitFor();
  await until(
    () =>
      page
        .getByRole("button", {
          name: f.t("studyReader.startOver"),
          exact: true,
        })
        .isEnabled(),
    "reader gehydrateerd",
  );
}
async function read(page, f, fraction = 0.52) {
  await page.mouse.wheel(0, 100);
  await page.evaluate(
    (frac) => window.scrollTo(0, document.documentElement.scrollHeight * frac),
    fraction,
  );
  const p = await until(async () => {
    const p = await position(f);
    return p && p.sectionAnchor.startsWith("section-long-") ? p : null;
  }, "positie bewaard");
  return p;
}
async function bounds(page) {
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    top: document.querySelector("[data-study-reader]").getBoundingClientRect()
      .top,
    header: document
      .querySelector("[data-sticky-header]")
      .getBoundingClientRect().bottom,
    nav:
      document.querySelector("[data-main-nav]")?.getBoundingClientRect()
        .height ?? 0,
  }));
}
try {
  for (const [width, height] of [
    [320, 844],
    [390, 844],
    [1280, 900],
    [844, 390],
  ])
    for (const scheme of ["light", "dark"]) {
      const f = await fixture(),
        before = await prisma.user.findUnique({ where: { id: f.user.id } }),
        c = await context(f, width, scheme, height),
        page = await c.newPage();
      await open(page, f);
      assert.equal(await position(f), null);
      const geometry = await bounds(page);
      assert.equal(geometry.overflow, false);
      assert.ok(geometry.top >= geometry.header - 1);
      assert.equal(geometry.nav, 0);
      assert.equal(
        await page.locator("[data-study-reader-body] h2").count(),
        1,
      );
      assert.ok(
        (await page.locator("[data-study-reader-body] li li").count()) > 0,
      );
      const link = page.getByRole("link", { name: "Veilige synthetische link" });
      assert.equal(await link.getAttribute("href"), "https://example.invalid/study-link");
      assert.equal(await link.getAttribute("target"), "_blank");
      assert.match(await link.getAttribute("rel"), /noopener/);
      assert.equal(
        await page.locator('[data-study-reader-body] a[href*="fixture-reference"]').count(),
        0,
        "onopgeloste schriftverwijzing blijft geen interne of externe link",
      );
      assert.equal(
        await page
          .locator(
            "[data-study-reader-body] input, [data-study-reader-body] button",
          )
          .count(),
        0,
      );
      const saved = await read(page, f);
      await page.reload();
      await page.locator("[data-study-reader-body]").waitFor();
      await until(() => page.evaluate(() => scrollY > 300), "reload hervat");
      await delay(650);
      const restored = await page.evaluate(() => {
        const h =
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--header-height",
            ),
          ) || 0;
        const blocks = [...document.querySelectorAll("[data-study-block]")];
        return blocks
          .filter((b) => b.getBoundingClientRect().top <= h + 18)
          .at(-1)
          ?.getAttribute("data-study-block");
      });
      assert.equal(restored, saved.blockAnchor);
      await page.goto(`${base}/courses`);
      await page.goBack();
      await page.locator("[data-study-reader-body]").waitFor();
      await until(() => page.evaluate(() => scrollY > 300), "history hersteld");
      const second = await context(f, width, scheme, height),
        p2 = await second.newPage();
      await open(p2, f);
      await until(
        () => p2.evaluate(() => scrollY > 300),
        "ander toestel hervat",
      );
      await prisma.user.update({
        where: { id: f.user.id },
        data: {
          activeContentCollectionId: "content_podcasts",
          contentLanguage: "en",
        },
      });
      await p2.reload();
      await p2.locator("[data-study-reader-body]").waitFor();
      assert.equal(
        await p2.locator("[data-study-reader]").getAttribute("data-edition-id"),
        f.edition.id,
      );
      await until(
        () => p2.evaluate(() => scrollY > 300),
        "bronwissel behoudt positie",
      );
      await p2
        .getByRole("button", {
          name: f.t("studyReader.startOver"),
          exact: true,
        })
        .click();
      await until(async () => {
        const p = await position(f);
        return p?.sectionFraction === 0 && p.sectionAnchor === "section-intro";
      }, "start-over server");
      await until(() => p2.evaluate(() => scrollY < 2), "start-over scroll");
      await p2.reload();
      await p2.locator("[data-study-reader-body]").waitFor();
      await delay(650);
      assert.ok(await p2.evaluate(() => scrollY < 200));
      await page.screenshot({
        path: `${output}/${width}-${scheme}-reader.png`,
      });
      await p2.screenshot({
        path: `${output}/${width}-${scheme}-start-over.png`,
      });
      const after = await prisma.user.findUnique({ where: { id: f.user.id } });
      assert.equal(after.activeContentCollectionId, "content_podcasts");
      assert.equal(after.contentLanguage, "en");
      assert.deepEqual(
        {
          ...after,
          activeContentCollectionId: before.activeContentCollectionId,
          contentLanguage: before.contentLanguage,
        },
        before,
      );
      assert.equal(
        await prisma.contentProgress.count({ where: { userId: f.user.id } }),
        0,
      );
      assert.equal(
        await prisma.streakActivity.count({ where: { userId: f.user.id } }),
        0,
      );
      results.push({
        width,
        height,
        scheme,
        reload: true,
        history: true,
        secondDevice: true,
        sourceSwitch: true,
        startOver: true,
        geometry,
      });
      await second.close();
      await c.close();
    }
  for (const scheme of ["light", "dark"])
    for (const lang of ["nl", "en", "de", "fr", "es"]) {
      const f = await fixture(lang),
        c = await context(f, 320, scheme),
        page = await c.newPage();
      await c.addInitScript(() => {
        const apply = () => { document.documentElement.style.fontSize = "200%"; document.documentElement.style.setProperty("--vs-safe-area-top", "20px"); document.documentElement.style.setProperty("--vs-safe-area-bottom", "34px"); };
        if (document.documentElement) apply(); else document.addEventListener("DOMContentLoaded", apply, {once:true});
      });
      await open(page, f);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
        document.documentElement.style.setProperty(
          "--vs-safe-area-top",
          "20px",
        );
        document.documentElement.style.setProperty(
          "--vs-safe-area-bottom",
          "34px",
        );
      });
      await delay(250);
      assert.equal((await bounds(page)).overflow, false);
      await read(page, f, 0.72);
      await page.reload();
      await page.locator("[data-study-reader-body]").waitFor();
      await until(
        () => page.evaluate(() => scrollY > 300),
        "grote tekst hervat",
      );
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), "32px");
      assert.equal((await bounds(page)).overflow, false);
      await page.screenshot({
        path: `${output}/320-${scheme}-${lang}-200-text.png`,
      });
      results.push({ width: 320, scheme, lang, text200: true });
      await c.close();
    }
  // Netwerkfout: dezelfde idempotente actie retry, persistente tabcache, geen vals 'opgeslagen'.
  {
    const f = await fixture(),
      c = await context(f, 390),
      page = await c.newPage();
    await open(page, f);
    let requests = 0;
    await page.route("**/api/reading-position", (r) => {
      if (r.request().method() === "PUT") {
        requests++;
        return r.abort();
      }
      return r.continue();
    });
    await page.mouse.wheel(0, 100);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight * 0.6),
    );
    await until(
      () =>
        page
          .locator("[data-reading-save-status]")
          .textContent()
          .then((t) => t.includes(f.t("studyReader.saveFailed"))),
      "echte foutstatus",
    );
    assert.equal(await position(f), null);
    await page.reload();
    await page.locator("[data-study-reader-body]").waitFor();
    await until(
      () =>
        page
          .getByRole("button", { name: f.t("studyReader.retry"), exact: true })
          .isVisible(),
      "pending cache hersteld",
    );
    await page.unroute("**/api/reading-position");
    await page
      .getByRole("button", { name: f.t("studyReader.retry"), exact: true })
      .click();
    await until(() => position(f), "retry commit");
    await until(
      () => page.locator("[data-reading-save-status]").textContent()
        .then((text) => text === f.t("studyReader.saved")),
      "retry bevestigd in de interface",
    );
    assert.ok(requests >= 1);
    // Dwing de CI-race af: een GET heeft de oude publicatie al gelezen,
    // maar de response arriveert pas na publiceren én het hervatsignaal.
    let held = false;
    let releaseGet;
    const heldResponse = new Promise((resolve) => { releaseGet = resolve; });
    await page.route("**/api/reading-position?*", async (route) => {
      if (held) return route.continue();
      const response = await route.fetch();
      held = true;
      await heldResponse;
      await route.fulfill({ response });
    });
    await page.evaluate(() => window.dispatchEvent(new Event("versado:app-resumed")));
    await until(() => held, "oude publicatiestatus onderweg");
    // Update blijft bevroren, tot expliciet openen. Oude afbeelding verliest normale toegang.
    const nextInput = structuredClone(f.input);
    nextInput.title = "Nieuwe synthetische revisie";
    nextInput.body.sections[0].blocks =
      nextInput.body.sections[0].blocks.filter((b) => b.type !== "figure");
    nextInput.body.sections[1].blocks[0].content[0].text =
      "Bijgewerkte synthetische leespassage.";
    const next = await appendStudyRevision(f.actor, f.edition.id, nextInput);
    await prisma.studyLessonEdition.update({
      where: { id: f.edition.id },
      data: { publishedRevisionId: next.id, publicationVersion: 2 },
    });
    await page.evaluate(() =>
      window.dispatchEvent(new Event("versado:app-resumed")),
    );
    releaseGet();
    await until(
      () =>
        page
          .getByRole("button", {
            name: f.t("studyReader.openUpdate"),
            exact: true,
          })
          .isVisible(),
      "update melding",
    );
    assert.equal(
      await page
        .locator("[data-study-reader]")
        .getAttribute("data-revision-id"),
      f.revision.id,
    );
    // De geopende (nu historische) body moet met het originele, eerder
    // ontvangen bezoekbewijs blijven kunnen autosaven. Geen concept- of
    // historisch-leesrecht voor een nieuw bezoek.
    const beforeFrozenSave = (await position(f)).version;
    await page.mouse.wheel(0, 160);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight * 0.83),
    );
    const frozenSaved = await until(async () => {
      const p = await position(f);
      return p && p.version > beforeFrozenSave ? p : null;
    }, "frozen revisie bewaart met origineel leesbezoekbewijs");
    assert.equal(frozenSaved.revisionId, f.revision.id);
    // Fixtures delen content-addressed PNG-bytes. Andere actuele publicaties
    // mogen die bytes terecht nog leveren; isoleer die testkopieën eerst.
    await prisma.contentCollection.updateMany({
      where: {
        work: { startsWith: "synthetic-study-" },
        id: { not: f.collection.id },
      },
      data: { visibleToUsers: false },
    });
    const media = await c.request.get(
      `${base}/api/study-media/${f.binding.mediaId}`,
    );
    assert.equal(media.status(), 404);
    await page
      .getByRole("button", { name: f.t("studyReader.openUpdate"), exact: true })
      .click();
    await until(
      () =>
        page
          .locator("[data-study-reader]")
          .getAttribute("data-revision-id")
          .then((id) => id === next.id),
      "bewust nieuwe revisie",
    );
    await page.screenshot({ path: `${output}/390-network-retry-update.png` });
    results.push({
      networkRetry: true,
      pendingAfterReload: true,
      frozenRevision: true,
      currentMediaRights: true,
      explicitUpdate: true,
    });
    await c.close();
  }
  // Interactie tijdens herstel, laat beeld, twee toestellen en leswissel tijdens save.
  {
    const f = await fixture(),
      c = await context(f, 390),
      page = await c.newPage();
    await page.route("**/api/study-media/*", async (r) => {
      await delay(1500);
      await r.continue();
    });
    await open(page, f);
    await read(page, f, 0.45);
    await page.reload();
    await page.locator("[data-study-reader-body]").waitFor();
    await page.mouse.wheel(0, 180);
    await delay(150);
    const manual = await page.evaluate(() => scrollY);
    await delay(1700);
    assert.ok(
      Math.abs((await page.evaluate(() => scrollY)) - manual) < 90,
      "gebruikersscroll stopt restore, ook met laat beeld",
    );
    await page.unroute("**/api/study-media/*");
    await read(page, f, 0.55);
    await delay(850);
    let release;
    const held = new Promise((r) => {
      release = r;
    });
    let seen;
    const started = new Promise((r) => {
      seen = r;
    });
    await page.route("**/api/reading-position", async (r) => {
      if (r.request().method() === "PUT") {
        seen(r.request().postDataJSON());
        await held;
      }
      await r.continue();
    });
    await page.mouse.wheel(0, 100);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight * 0.65),
    );
    const oldAction = await started;
    const second = await context(f, 390),
      p2 = await second.newPage();
    await open(p2, f);
    const newAction = {
      ...oldAction,
      actionId: randomUUID(),
      sectionFraction: 0.15,
    };
    const commit = await second.request.put(`${base}/api/reading-position`, {
      headers: {
        Origin: new URL(base).origin,
        "X-Reading-Session": createHash("sha256").update(f.token).digest("hex"),
      },
      data: newAction,
    });
    assert.equal(commit.status(), 200);
    release();
    await until(
      () =>
        page
          .getByRole("button", {
            name: f.t("studyReader.useServer"),
            exact: true,
          })
          .isVisible(),
      "ander toestel geeft herstelbaar conflict",
    );
    assert.equal((await position(f)).sectionFraction, 0.15);
    await page.unroute("**/api/reading-position");
    await page
      .getByRole("button", { name: f.t("studyReader.useServer"), exact: true })
      .click();
    await delay(650);
    const alternate = await fixture();
    let releaseLate;
    const late = new Promise((r) => {
      releaseLate = r;
    });
    let saw;
    const lateStarted = new Promise((r) => {
      saw = r;
    });
    await page.route("**/api/reading-position", async (r) => {
      if (r.request().method() === "PUT") {
        saw();
        await late;
      }
      await r.continue().catch(() => {});
    });
    await page.mouse.wheel(0, 100);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight * 0.8),
    );
    await lateStarted;
    await page.goto(`${base}${alternate.href}`);
    await page.locator("[data-study-reader-body]").waitFor();
    releaseLate();
    await page.unroute("**/api/reading-position");
    await delay(400);
    assert.equal(
      await page.locator("[data-study-reader]").getAttribute("data-edition-id"),
      alternate.edition.id,
    );
    assert.ok(
      await page.evaluate(() => scrollY < 300),
      "late oude response verplaatst de nieuwe les niet",
    );
    await page.mouse.wheel(0, 100);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight * 0.7),
    );
    await page.evaluate(() =>
      window.dispatchEvent(new Event("versado:app-paused")),
    );
    const stored = await until(
      () =>
        prisma.readingPosition.findUnique({
          where: {
            userId_lessonEditionId: {
              userId: f.user.id,
              lessonEditionId: alternate.edition.id,
            },
          },
        }),
      "app-pauze bewaart eigen nieuwe editie",
    );
    const changed = structuredClone(alternate.input);
    changed.body.sections = changed.body.sections.filter(
      (section) => section.id !== stored.sectionAnchor,
    );
    const next = await appendStudyRevision(
      alternate.actor,
      alternate.edition.id,
      changed,
    );
    await prisma.studyLessonEdition.update({
      where: { id: alternate.edition.id },
      data: { publishedRevisionId: next.id, publicationVersion: 2 },
    });
    await page.reload();
    await page.locator("[data-study-reader-body]").waitFor();
    await until(
      () =>
        page
          .getByText(f.t("studyReader.positionLost"), { exact: true })
          .isVisible(),
      "verdwenen anker geeft veilige melding",
    );
    await page.screenshot({
      path: `${output}/390-conflict-removed-anchor.png`,
    });
    const login = await fixture();
    await c.addCookies([
      { name: SESSION_COOKIE, value: login.token, url: base },
    ]);
    await page.reload();
    await page.locator("[data-study-reader-body]").waitFor();
    await until(
      () => page.evaluate(() => scrollY < 3),
      "nieuwe login neemt oude persoonlijke positie niet over",
    );
    const own = await c.request.get(
      `${base}/api/reading-position?lessonEditionId=${alternate.edition.id}`,
    );
    assert.equal((await own.json()).position, null);
    const staleLogin = await c.request.put(`${base}/api/reading-position`, {
      headers: {
        Origin: new URL(base).origin,
        "X-Reading-Session": createHash("sha256").update(f.token).digest("hex"),
      },
      data: newAction,
    });
    assert.equal(staleLogin.status(), 403);
    results.push({
      authSessionIsolation: true,
      manualStopsRestore: true,
      lateImage: true,
      secondDeviceConflict: true,
      lateOldLessonResponse: true,
      appPause: true,
      removedAnchor: true,
    });
    await second.close();
    await c.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify({
      studyReaderBrowserFlows: results.length,
      physicalIosAndroid: false,
      screenshots: output,
      errors,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      syntheticPositions: await prisma.readingPosition.findMany({
        select: {
          sectionAnchor: true,
          blockAnchor: true,
          sectionFraction: true,
          version: true,
        },
        take: 10,
        orderBy: { updatedAt: "desc" },
      }),
    }),
  );
  for (const c of browser.contexts())
    for (const [i, p] of c.pages().entries())
      await p
        .screenshot({ path: `${output}/failure-${i}.png` })
        .catch(() => {});
  writeFileSync(
    `${output}/partial-results.json`,
    JSON.stringify(results, null, 2),
  );
  console.error(error);
  throw error;
} finally {
  await browser.close();
  await prisma.$disconnect();
}
