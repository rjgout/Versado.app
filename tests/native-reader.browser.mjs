import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { seedNativeCourses } from "./fixtures/native-courses.ts";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { getT } from "../src/lib/i18n/index.ts";
const db = new URL(process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid"),
  backend = process.env.NATIVE_TEST_BASE_URL;
if (
  db.hostname !== "127.0.0.1" ||
  db.pathname !== "/versado_content_access_test" ||
  db.href !== process.env.DATABASE_URL
)
  throw Error("Eigen geïsoleerde database vereist");
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright"),
  out = "/tmp/versado-native-browser/reader";
mkdirSync(out, { recursive: true });
const inputs = JSON.parse(readFileSync("dist/native.inputs.json", "utf8"));
assert.ok(
  inputs.some((f) => f.endsWith("reading/ScriptureReaderView.tsx")),
  "De echte gedeelde leescomponent ontbreekt",
);
assert.equal(
  inputs.some((f) =>
    /node_modules\/(?:next|@prisma)\/|\.server\.ts$|components\/LessonFlow\.tsx$|components\/ReadAloudPlayer\.tsx$/.test(
      f,
    ),
  ),
  false,
  "Web-/server- en audioadapters mogen niet in de lokale bundel",
);
const osBoundary = {
  name: "reader-os-events-only",
  setup(api) {
    api.onLoad({ filter: /src\/lib\/platform\.ts$/ }, (args) => {
      const source = readFileSync(args.path, "utf8"),
        start = source.indexOf(
          "export async function startNativeFoundationRuntime(",
        );
      assert.ok(start > 0);
      return {
        loader: "ts",
        contents:
          source.slice(0, start) +
          `export async function startNativeFoundationRuntime(options){const back=()=>options.onBack(),resume=()=>options.onResume(),open=e=>options.onUrl(e.detail,'open');window.addEventListener('reader:test-open',open);window.addEventListener('reader:test-back',back);window.addEventListener('reader:test-resume',resume);return()=>{window.removeEventListener('reader:test-open',open);window.removeEventListener('reader:test-back',back);window.removeEventListener('reader:test-resume',resume);};}`,
      };
    });
  },
};
const bundle = await build({
    plugins: [osBoundary],
    entryPoints: ["tests/fixtures/native-foundation-client.tsx"],
    bundle: true,
    write: false,
    minify: true,
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  css = readFileSync("dist/native/index.css");
const secrets = new Map(),
  calls = [],
  held = [];
let oldBackend = false,
  readFailure = 0,
  holdReader = false;
const front = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/v1/native/")) {
      calls.push({ path: url.pathname, method: req.method });
      const isReader = /\/courses\/[^/]+\/read\//.test(url.pathname);
      if (isReader && readFailure) {
        res.writeHead(readFailure, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "native_request_failed" }));
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await fetch(`${backend}${req.url}`, {
        method: req.method,
        headers: {
          Origin: "capacitor://localhost",
          "X-Versado-Client": "native-v1",
          "x-real-ip": "127.0.0.65",
          ...(req.headers.authorization
            ? { Authorization: req.headers.authorization }
            : {}),
          ...(req.headers["content-type"]
            ? { "Content-Type": req.headers["content-type"] }
            : {}),
        },
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : Buffer.concat(chunks),
      });
      let body = await response.text();
      if (url.pathname.endsWith("/capabilities") && oldBackend) {
        const value = JSON.parse(body);
        value.features = value.features.filter(
          (f) => f !== "scripture-reader-v1",
        );
        body = JSON.stringify(value);
      }
      const finish = () => {
        if (!res.destroyed) {
          res.writeHead(response.status, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(body);
        }
      };
      if (isReader && holdReader) {
        holdReader = false;
        held.push(finish);
      } else finish();
      return;
    }
    if (url.pathname.startsWith("/test-keychain/")) {
      if (req.method === "PUT") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        secrets.set(url.pathname, Buffer.concat(chunks).toString());
      }
      if (req.method === "DELETE") secrets.delete(url.pathname);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ value: secrets.get(url.pathname) ?? null }));
      return;
    }
    if (url.pathname === "/app.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].text);
      return;
    }
    if (url.pathname === "/index.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(css);
      return;
    }
    if (
      [
        "/native-artwork/",
        "/images/",
        "/icons/",
        "/mascots/",
        "/scripture/",
      ].some((prefix) => url.pathname.startsWith(prefix)) &&
      !url.pathname.includes("..")
    ) {
      res.setHeader(
        "Content-Type",
        url.pathname.endsWith(".png")
          ? "image/png"
          : url.pathname.endsWith(".svg")
            ? "image/svg+xml"
            : "image/webp",
      );
      res.end(
        readFileSync(
          url.pathname.startsWith("/native-artwork/")
            ? `dist/native${url.pathname}`
            : `public${url.pathname}`,
        ),
      );
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  } catch (e) {
    res.writeHead(500);
    res.end("synthetic front failure");
    console.error(e);
  }
});
await new Promise((resolve) => front.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${front.address().port}`;
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox"],
  }),
  fixtures = [],
  results = [];
try {
  for (const [language, width, scheme, scale] of [
    ["nl", 320, "light", 200],
    ["en", 390, "dark", 100],
    ["de", 390, "light", 200],
    ["fr", 768, "dark", 100],
    ["es", 390, "light", 100],
  ]) {
    const f = await seedNativeCourses(language),
      user = await f.account(language),
      t = getT(language);
    fixtures.push(f);
    const free = f.courses.find((c) => c.type === "FREE_CHOICE");
    const extraBook = await prisma.book.create({
      data: {
        slug: `reader-extra-${user.id}`,
        key: "bofm/mosiah",
        name: "Mosiah",
        order: 2,
        contentCollectionId: f.collection.id,
      },
    });
    const extraChapter = await prisma.chapter.create({
      data: {
        bookId: extraBook.id,
        number: 1,
        order: 1,
        verses: {
          create: [1, 2, 3].map((number) => ({
            number,
            text: `Synthetische extra passage ${number}.`,
          })),
        },
      },
    });
    await prisma.courseChapter.create({
      data: { courseId: free.id, chapterId: extraChapter.id, order: 2 },
    });
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      locale: language,
      colorScheme: scheme,
      hasTouch: true,
    });
    await context.addInitScript(
      ({ scale }) => {
        const apply = () => {
          document.documentElement.style.fontSize = `${scale}%`;
          for (const [edge, size] of Object.entries({
            top: 24,
            bottom: 18,
            left: 12,
            right: 12,
          }))
            document.documentElement.style.setProperty(
              `--safe-area-inset-${edge}`,
              `${size}px`,
            );
        };
        if (document.documentElement) apply();
        else
          document.addEventListener("DOMContentLoaded", apply, { once: true });
      },
      { scale },
    );
    const page = await context.newPage(),
      web = await context.newPage(),
      errors = [];
    if (language === "nl") await page.clock.install();
    page.on("pageerror", (e) => errors.push(e.message));
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: await createSessionToken(user.id),
        url: backend,
      },
    ]);
    const waitReader = async () =>
      page
        .locator("[data-native-reader]")
        .waitFor()
        .catch(async (e) => {
          console.error(
            "Readerdiagnose",
            await page.locator("body").innerText(),
            calls.slice(-10),
          );
          throw e;
        });
    const go = (path) =>
      page.evaluate(
        (path) =>
          window.dispatchEvent(
            new CustomEvent("reader:test-open", {
              detail: location.origin + path,
            }),
          ),
        path,
      );
    const route = (course, kind, target) =>
      `/courses/${course}/read/${kind}/${target}`;
    const stepRoute = route(f.steps.id, "steps", f.steps.lessons[1].id),
      device = `reader-${user.id}`;
    await page.goto(
      `${origin}/?accountLanguage=1&device=${device}#${stepRoute}`,
    );
    await page.getByLabel(t("nativeFoundation.email")).fill(user.email);
    await page
      .getByLabel(t("nativeFoundation.password"), { exact: true })
      .fill(f.password);
    await page
      .getByRole("button", { name: t("nativeFoundation.login"), exact: true })
      .click();
    await waitReader();
    assert.equal(
      new URL(page.url()).hash,
      `#${stepRoute}`,
      "Inloggen behoudt de expliciete leesbestemming",
    );
    assert.equal(
      await page.locator("[data-native-reader] .reader-text").count(),
      2,
    );
    assert.equal(await page.locator("#vers-3").count(), 0);
    assert.equal(await page.locator("#vers-4").count(), 0);
    assert.ok(
      (await page.locator("[data-reader-source]").innerText()).includes(
        f.collection.name,
      ),
    );
    await page.waitForFunction(() =>
      document.activeElement?.matches('h1[tabindex="-1"]'),
    );
    assert.equal(
      await page.evaluate(() => !!document.activeElement?.closest("[hidden]")),
      false,
      "Focus mag niet in het verborgen leerpad belanden",
    );
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.activeElement).outlineStyle,
      ),
      "none",
      "Geen blauwe routefocusrand",
    );
    await page.evaluate(() => {
      const node = document.querySelector(
          "[data-native-reader] .reader-text p",
        ),
        range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    assert.ok(
      (await page.evaluate(() => getSelection().toString())).includes(
        "Synthetisch vers 32:1.",
      ),
    );
    await page.evaluate(() => getSelection().removeAllRanges());
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `${out}/${language}-step-native.png`,
      fullPage: true,
    });
    for (const course of f.courses.filter(
      (c) => c.type !== "READING_LESSONS",
    )) {
      const href = route(course.id, "chapters", f.chapters[1].id);
      await go(href);
      await waitReader();
      assert.equal(
        await page.locator("[data-native-reader] .reader-text").count(),
        4,
      );
      await web.goto(`${backend}/scripture/${f.chapters[1].id}`);
      await web.locator("[data-scripture-reader]").waitFor();
      assert.deepEqual(
        await page
          .locator("[data-native-reader] .reader-text p")
          .allTextContents(),
        await web
          .locator("[data-scripture-reader] .reader-text p")
          .allTextContents(),
        "Web en native gebruiken dezelfde verzen en nummers",
      );
      for (const [name, p] of [
        ["native", page],
        ["web", web],
      ])
        await p.screenshot({
          path: `${out}/${language}-${course.type}-${name}.png`,
          fullPage: true,
        });
    }
    // Werkelijke padlink en terugnavigatie: de React-padpresentatie blijft gemount, geen tweede UI-cache.
    const pathUrl = `/courses/${free.id}/pad`;
    await go(pathUrl);
    await page.locator("[data-chapter-path]").waitFor();
    const chapterLink = page.locator(
      `a[href="#${route(free.id, "chapters", extraChapter.id)}"]`,
    );
    if (!(await chapterLink.isVisible()))
      await page
        .locator("[data-chapter-path] button[aria-expanded]")
        .filter({ hasText: "Mosiah" })
        .click();
    await chapterLink.waitFor({ state: "visible" });
    const expanded = await page
      .locator('[data-chapter-path] button[aria-expanded="true"]')
      .count();
    await chapterLink.click();
    await waitReader();
    await page.waitForFunction(() =>
      document.activeElement?.closest("[data-native-reader]"),
    );
    if (language === "nl") await page.clock.fastForward(6 * 60 * 1000);
    await page.evaluate(() =>
      window.dispatchEvent(new Event("reader:test-back")),
    );
    await page.locator("[data-chapter-path]:visible").waitFor();
    assert.equal(
      await page
        .locator('[data-chapter-path] button[aria-expanded="true"]')
        .count(),
      expanded,
    );
    if (language === "nl") {
      await chapterLink.click();
      await waitReader();
      readFailure = 503;
      await page.evaluate(() =>
        window.dispatchEvent(new Event("reader:test-resume")),
      );
      await page
        .getByText(t("nativeLearning.refreshFailed"), { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("[data-native-reader] .reader-text").count(),
        3,
        "Tijdelijke GET-fout wist geen geladen tekst",
      );
      readFailure = 0;
      await page.reload();
      await waitReader();
      assert.match(new URL(page.url()).hash, /\/read\/chapters\//);
      await context.setOffline(true);
      await page.evaluate(() =>
        window.dispatchEvent(new Event("reader:test-resume")),
      );
      assert.equal(
        await page.locator("[data-native-reader] .reader-text").count(),
        3,
      );
      await context.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await waitReader();
      oldBackend = true;
      const before = calls.filter((c) => /\/read\//.test(c.path)).length;
      await page.reload();
      await page
        .getByText(t("nativeReader.unsupported"), { exact: true })
        .waitFor();
      assert.equal(
        calls.filter((c) => /\/read\//.test(c.path)).length,
        before,
        "Geen nieuwe GET zonder capability",
      );
      oldBackend = false;
      await page.reload();
      await waitReader();
      readFailure = 403;
      await page.evaluate(() =>
        window.dispatchEvent(new Event("reader:test-resume")),
      );
      await page
        .getByText(t("nativeLearning.pathUnavailable"), { exact: true })
        .first()
        .waitFor();
      assert.equal(
        await page.locator("[data-native-reader] .reader-text").count(),
        0,
        "Ingetrokken toegang behoudt geen oude tekst",
      );
      readFailure = 0;
      // Een daadwerkelijk ontvangen A-antwoord blijft achter de netwerkgrens tot B is ingelogd.
      await page.reload();
      await waitReader();
      const b = await seedNativeCourses("nl"),
        other = await b.account("nl");
      fixtures.push(b);
      await prisma.verse.updateMany({
        where: { chapterId: b.chapters[1].id },
        data: { text: "Uitsluitend account B: synthetische passage." },
      });
      holdReader = true;
      await page.evaluate(() =>
        window.dispatchEvent(new Event("reader:test-resume")),
      );
      for (let i = 0; i < 100 && held.length === 0; i++)
        await new Promise((r) => setTimeout(r, 20));
      assert.equal(held.length, 1);
      await go("/profile");
      await page
        .getByRole("button", {
          name: t("nativeFoundation.logout"),
          exact: true,
        })
        .click();
      await page.locator("form").waitFor();
      await page.getByLabel(t("nativeFoundation.email")).fill(other.email);
      await page
        .getByLabel(t("nativeFoundation.password"), { exact: true })
        .fill(b.password);
      await page
        .getByRole("button", { name: t("nativeFoundation.login"), exact: true })
        .click();
      await page.locator("[data-today-overview]").waitFor();
      await go(
        route(
          b.courses.find((c) => c.type === "FREE_CHOICE").id,
          "chapters",
          b.chapters[1].id,
        ),
      );
      await waitReader();
      for (const finish of held.splice(0)) finish();
      await page.waitForLoadState("networkidle");
      assert.ok(
        (await page.locator("[data-native-reader]").innerText()).includes(
          "Uitsluitend account B",
        ),
      );
      assert.equal(
        await page
          .getByText("Synthetische extra passage 1.", { exact: false })
          .count(),
        0,
        "Laat A-antwoord komt niet bij B in de reader",
      );
    }
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).xpTotal,
      0,
    );
    assert.equal(
      await prisma.userCourseLessonProgress.count({
        where: { userId: user.id },
      }),
      0,
    );
    assert.equal(
      await prisma.streakDay.count({ where: { userId: user.id } }),
      0,
    );
    assert.deepEqual(errors, []);
    results.push({
      language,
      width,
      scheme,
      textPercent: scale,
      exactStepVerses: true,
      threePaths: true,
      sharedWebReader: true,
      selectableText: true,
      capabilityFallback: language === "nl" ? "PASS" : "NOT TESTED",
      delayedAccountResponse: language === "nl" ? "PASS" : "NOT TESTED",
      sixMinuteGroupRetention: language === "nl" ? "PASS" : "NOT TESTED",
      noCompletion: true,
    });
    await context.close();
  }
  assert.equal(
    calls.some(
      (c) => c.method !== "GET" && /\/read\/|\/complete$|exercise/.test(c.path),
    ),
    false,
    "Er worden geen leesafrondingen of oefensessies aangeroepen",
  );
  writeFileSync(`${out}/resultaten.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  for (const finish of held) finish();
  await browser.close();
  front.closeAllConnections?.();
  await new Promise((resolve) => front.close(resolve));
  for (const f of fixtures)
    await prisma.contentCollection.update({
      where: { id: f.collection.id },
      data: { enabled: false },
    });
  await prisma.$disconnect();
}
