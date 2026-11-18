import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { prisma } from "../src/lib/db.ts";
import {
  assertReferenceTestEnvironment,
  referenceAccount,
} from "./fixtures/reference-content.mjs";
import { SESSION_COOKIE } from "../src/lib/auth.ts";
const base = assertReferenceTestEnvironment(),
  actor = await referenceAccount(true),
  require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.CHROMIUM_PATH,
});
const output = "/tmp/versado-cfm-recovery-browser";
await fs.mkdir(output, { recursive: true });
const snapshot = async () =>
  JSON.stringify({
    editions: await prisma.studyLessonEdition.findMany({
      orderBy: { id: "asc" },
    }),
    media: await prisma.contentMedia.findMany({ orderBy: { id: "asc" } }),
    publications: await prisma.studyPublicationAction.findMany({
      orderBy: { id: "asc" },
    }),
    runs: await prisma.contentImportRun.findMany({ orderBy: { id: "asc" } }),
  });
const before = await snapshot(),
  results = [];
try {
  for (const [width, scheme, scale] of [
    [320, "light", 200],
    [390, "dark", 100],
    [1280, "light", 100],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: scheme,
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: actor.token, url: base },
    ]);
    const page = await context.newPage(),
      posts = [];
    await page.route("**/api/admin/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      // Alleen de mutatie wordt op de browsergrens tegengehouden; plan/status lopen via de echte beheerroute.
      if (url.pathname === "/api/admin/reseed" && request.method() === "POST") {
        posts.push(request.postDataJSON());
        await route.fulfill({
          json: {
            started: false,
            job: {
              status: "idle",
              logs: [],
              error: null,
              startedAt: null,
              finishedAt: null,
              progress: null,
            },
          },
        });
      } else if (url.pathname === "/api/admin/reseed") await route.continue();
      else
        await route.fulfill({
          status: 503,
          json: { error: "Onafhankelijk beheerpaneel buiten deze test" },
        });
    });
    await page.goto(`${base}/adminbackend/systeem`);
    const control = page.locator("[data-cfm-recovery]");
    await control.waitFor({ state: "attached" });
    const details = page.locator("details").filter({ has: control }).first();
    if ((await details.count()) && !(await details.getAttribute("open")))
      await details.locator("summary").first().click();
    if (scale === 200)
      await page.addStyleTag({ content: "html{font-size:200% !important}" });
    await control
      .getByRole("button", {
        name: "1. Herstelplan bekijken (alleen lezen)",
        exact: true,
      })
      .click();
    await control.locator("li").nth(6).waitFor();
    assert.equal(await control.locator("li").count(), 7);
    const prepare = control.getByRole("button", {
      name: "2. Originelen herstellen en concepten voorbereiden",
      exact: true,
    });
    assert.equal(await prepare.isEnabled(), false);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
      `Geen horizontale overflow ${width}/${scale}`,
    );
    await control.screenshot({
      path: `${output}/cfm-herstelplan-${width}-${scheme}-${scale}.png`,
    });
    await control.getByRole("checkbox").check();
    assert.equal(await prepare.isEnabled(), true);
    await prepare.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Annuleren", exact: true })
      .click();
    assert.equal(posts.length, 0);
    await prepare.evaluate((button) => {
      button.click();
      button.click();
    });
    const dialog = page.locator("dialog[open]");
    await dialog.waitFor();
    assert.equal(posts.length, 0);
    const bounds = await dialog.boundingBox();
    assert.ok(
      bounds.x >= 0 &&
        bounds.x + bounds.width <= width + 1 &&
        bounds.y >= 0 &&
        bounds.y + bounds.height <= 901,
    );
    await page.screenshot({
      path: `${output}/cfm-bevestiging-${width}-${scheme}-${scale}.png`,
    });
    const sent = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/reseed") &&
        r.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Bevestigen", exact: true })
      .click();
    await sent;
    assert.equal(posts.length, 1);
    assert.equal(posts[0].action, "cfm-prepare");
    assert.equal(posts[0].confirmDraftsOnly, true);
    assert.equal(posts[0].confirmReviewedMedia, true);
    assert.match(posts[0].planHash, /^[a-f0-9]{64}$/);
    assert.equal(
      await snapshot(),
      before,
      "Geen echte import, bestandherstel of publicatie vanuit deze browsertest",
    );
    results.push({
      width,
      scheme,
      textPercent: scale,
      readOnlyPlan: true,
      explicitReview: true,
      cancelNoWrite: true,
      doubleClickOneRequest: true,
      productionMutation: false,
    });
    await context.close();
  }
  await fs.writeFile(
    `${output}/resultaten.json`,
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await prisma.$disconnect();
}
