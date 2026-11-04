// Echte routes, PostgreSQL/Redis, NativeFoundation en gedeelde vragen/resultaten.
// Alleen Keychain en OS-events worden door het bestaande browserharnas vervangen.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";
import { prisma } from "../src/lib/db.ts";
import { seedNativeCourses } from "./fixtures/native-courses.ts";
import { clearExercisePlanCache } from "../src/lib/learning/contentProgress.ts";
import { getT } from "../src/lib/i18n/index.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
const database = new URL(
    process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid",
  ),
  backend = process.env.NATIVE_TEST_BASE_URL;
if (
  database.hostname !== "127.0.0.1" ||
  database.pathname !== "/versado_content_access_test" ||
  database.href !== process.env.DATABASE_URL
)
  throw Error("Eigen geïsoleerde database vereist");
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright"),
  out = "/tmp/versado-native-browser/learning-flow";
mkdirSync(out, { recursive: true });
const inputs = JSON.parse(readFileSync("dist/native.inputs.json", "utf8"));
for (const component of [
  "learning/ExerciseSessionQuestions.tsx",
  "learning/LessonSummary.tsx",
  "learning/ReadingCompletionSummary.tsx",
])
  assert.ok(
    inputs.some((file) => file.endsWith(component)),
    component,
  );
assert.equal(
  inputs.some((file) =>
    /node_modules\/(?:next|@prisma)\/|\.server\.ts$|components\/LessonFlow\.tsx$/.test(
      file,
    ),
  ),
  false,
);
const bundle = await build({
    entryPoints: ["tests/fixtures/native-foundation-client.tsx"],
    bundle: true,
    write: false,
    minify: true,
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  css = readFileSync("dist/native/index.css"),
  secrets = new Map(),
  calls = [];
let loseSubmit = false;
const front = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/v1/native/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const call = {
        path: url.pathname,
        method: req.method,
        body: body.length ? JSON.parse(body) : null,
      };
      calls.push(call);
      const response = await fetch(`${backend}${req.url}`, {
        method: req.method,
        headers: {
          Origin: "capacitor://localhost",
          "X-Versado-Client": "native-v1",
          "x-real-ip": "127.0.0.83",
          ...(req.headers.authorization
            ? { Authorization: req.headers.authorization }
            : {}),
          ...(body.length ? { "Content-Type": "application/json" } : {}),
        },
        ...(body.length ? { body } : {}),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      call.status = response.status;
      if (loseSubmit && url.pathname.endsWith("/submit")) {
        loseSubmit = false;
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "native_request_failed" }));
        return;
      }
      res.writeHead(response.status, {
        "Content-Type":
          response.headers.get("content-type") ?? "application/json",
      });
      res.end(bytes);
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
      res.end(bundle.outputFiles[0].contents);
      return;
    }
    if (url.pathname === "/index.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(css);
      return;
    }
    if (
      /^\/(?:icons|mascots|images|native-artwork)\/[A-Za-z0-9_./-]+$/.test(
        url.pathname,
      ) &&
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
          `${url.pathname.startsWith("/native-artwork/") ? "dist/native" : "public"}${url.pathname}`,
        ),
      );
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end("synthetic test gateway failure");
  }
});
await new Promise((resolve) => front.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${front.address().port}`;
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox"],
  }),
  fixtures = [],
  errors = [];
try {
  for (const [index, type] of [
    "READING_LESSONS",
    "FRONT_TO_BACK",
    "FREE_CHOICE",
  ].entries()) {
    const f = await seedNativeCourses("nl");
    fixtures.push(f);
    for (const verse of await prisma.verse.findMany({
      where: { chapterId: f.chapters[1].id },
    }))
      await prisma.exercise.create({
        data: {
          chapterId: verse.chapterId,
          order: verse.number,
          type: "TRUE_FALSE",
          sourceVerseId: verse.id,
          verseRef: `Alma 32:${verse.number}`,
          prompt: `Synthetische vraag ${verse.number}`,
          answers: '["true"]',
        },
      });
    clearExercisePlanCache();
    const user = await f.account(),
      course = f.courses.find((c) => c.type === type),
      kind = index === 0 ? "steps" : "chapters",
      target = index === 0 ? f.steps.lessons[1].id : f.chapters[1].id,
      t = getT("nl");
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      `${origin}/?accountLanguage=1&device=${user.id}#/courses/${course.id}/read/${kind}/${target}`,
    );
    await page.getByLabel(t("nativeFoundation.email")).fill(user.email);
    await page
      .getByLabel(t("nativeFoundation.password"), { exact: true })
      .fill(f.password);
    await page
      .getByRole("button", { name: t("nativeFoundation.login"), exact: true })
      .click();
    await page.locator("[data-native-reader]").waitFor();
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    assert.equal(
      await prisma.exerciseSession.count({ where: { userId: user.id } }),
      0,
      "openen start geen vragen of read",
    );
    if (index !== 0) {
      await page
        .getByRole("button", { name: t("progress.markRead"), exact: true })
        .click();
      await page.locator("[data-native-learning-phase=read-result]").waitFor();
      const read = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      assert.equal(read.xpTotal, before.xpTotal, "lezen geeft geen XP");
      await page
        .getByRole("button", {
          name: t("readingLesson.toQuestions"),
          exact: true,
        })
        .click();
    } else
      await page
        .getByRole("button", {
          name: t("nativeLearningFlow.next"),
          exact: true,
        })
        .click();
    await page.locator("[data-native-learning-phase=questions]").waitFor();
    if (index === 0)
      await page.screenshot({
        path: `${out}/questions-native.png`,
        fullPage: true,
      });
    const issued = await prisma.exerciseSession.findFirstOrThrow({
      where: { userId: user.id, submittedAt: null },
      orderBy: { createdAt: "desc" },
    });
    const expected = JSON.parse(issued.exerciseIds).length;
    assert.ok(expected > 0);
    if (index === 0) assert.equal(expected, 2);
    console.log("Leerflow", type, "servervragen", expected);
    for (let q = 0; q < expected; q++) {
      await page
        .getByRole("button", { name: "✅ " + t("lesson.true"), exact: true })
        .click();
      await page
        .getByRole("button", { name: t("lesson.check"), exact: true })
        .click();
      if (index === 0 && q === expected - 1) loseSubmit = true;
      await page
        .getByRole("button", { name: t("lesson.continue"), exact: true })
        .click();
    }
    await page
      .locator("[data-native-learning-phase=result]")
      .waitFor()
      .catch(async (error) => {
        console.error(
          "Learningdiagnose",
          index,
          await page.locator("body").innerText(),
          calls.slice(-12),
          JSON.stringify(
            await prisma.exerciseSession.findMany({
              where: { userId: user.id },
              select: { id: true, result: true, exerciseIds: true },
            }),
          ),
        );
        throw error;
      });
    const submit = calls.filter(
      (c) => c.path.endsWith("/submit") && c.path.includes(course.id),
    );
    assert.equal(submit.length, 1, "verloren response doet geen tweede POST");
    const receipt = await prisma.exerciseSession.findUniqueOrThrow({
        where: { id: submit[0].body.sessionId },
      }),
      outcome = receipt.result.outcome;
    assert.equal(outcome.total, expected);
    assert.equal(outcome.correctCount, expected);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .xpTotal - before.xpTotal,
      outcome.xpEarned,
    );
    assert.ok(
      (await page.locator("main").innerText()).includes(
        `+${outcome.xpEarned} XP`,
      ),
    );
    assert.equal(
      await prisma.exerciseAttempt.count({ where: { userId: user.id } }),
      expected,
    );
    if (index === 0) {
      assert.ok(
        calls.some(
          (c) =>
            c.method === "GET" && c.path.endsWith(`/sessions/${receipt.id}`),
        ),
      );
      await page.screenshot({
        path: `${out}/result-native.png`,
        fullPage: true,
      });
    }
    if (index === 2) {
      const web = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      await web
        .context()
        .addCookies([
          {
            name: SESSION_COOKIE,
            value: await createSessionToken(user.id),
            url: backend,
          },
        ]);
      await web.goto(
        `${backend}/lesson/${f.chapters[1].id}?cursus=${course.id}`,
      );
      await web
        .getByRole("button", { name: t("progress.practiceAgain",{n:expected}), exact: true })
        .click();
      await web
        .getByRole("button", { name: t("lesson.check"), exact: true })
        .waitFor();
      await web.screenshot({
        path: `${out}/questions-web.png`,
        fullPage: true,
      });
      await web.close();
    }
    await page
      .getByRole("button", {
        name: t("nativeLearningFlow.toPath"),
        exact: true,
      })
      .click();
    await page.waitForFunction(() => location.hash.endsWith("/pad"));
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: drie volledige native leerflows op echte geïsoleerde PostgreSQL/Redis; servervragen, server-XP, geen lees-XP, verloren submitresponse via GET hersteld zonder dubbele poging.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => front.close(resolve));
  for (const f of fixtures)
    await prisma.contentCollection.update({
      where: { id: f.collection.id },
      data: { enabled: false },
    });
  await prisma.$disconnect();
}
