import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { prisma } from "../src/lib/db.ts";
import {
  referenceAccount,
  assertReferenceTestEnvironment,
} from "./fixtures/reference-content.mjs";
import {
  cfmExerciseFixture,
  standardExerciseFixture,
  officialCfmExerciseFixture,
} from "./fixtures/cfm-exercises.mjs";
import { SESSION_COOKIE } from "../src/lib/auth.ts";
import { getT } from "../src/lib/i18n/index.ts";
const base = assertReferenceTestEnvironment(),
  f = await cfmExerciseFixture(),
  t = getT("nl");
const out = "/tmp/versado-cfm-exercises-browser";
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE ?? "playwright",
);
const browser = await chromium.launch({
    args: ["--no-sandbox"],
    executablePath: process.env.CHROMIUM_PATH,
  }),
  results = [];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
try {
  for (const [width, scheme, scale, fullWeek] of [
    [390, "dark", 1, true],
    [320, "light", 2, false],
    [320, "dark", 2, true],
  ]) {
    const a = await referenceAccount();
    await prisma.user.update({
      where: { id: a.user.id },
      data: {
        onboardingSeenAt: new Date(),
        onboardingProfilePrivacyAt: new Date(),
        avatarCharacterId: "nephi",
        emailVerifiedAt: new Date(),
        kompasOffersEnabled: false,
        activeContentCollectionId: f.key,
      },
    });
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      colorScheme: scheme,
      hasTouch: true,
      serviceWorkers: "block",
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: a.token, url: base },
    ]);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const lessonPath = `/study-lesson/${f.lesson.id}/${f.key}`,
      questionPath =
        lessonPath + "/vragen" + (fullWeek ? "?volledig=1" : "?stap=1");
    await page.goto(
      base + lessonPath + (fullWeek ? "?weergave=volledig" : "/stappen/1"),
    );
    await page.locator("[data-study-reader]").waitFor();
    await page.locator("[data-study-exercises]").waitFor();
    const historyBefore = await page.evaluate(() => history.length);
    await page.locator("[data-study-exercises]").click();
    await page.waitForURL(base + questionPath);
    assert.equal(
      await page.evaluate(() => history.length),
      historyBefore,
      "vragen blijven dezelfde studieactiviteit in de teruggeschiedenis",
    );
    await page
      .getByRole("heading", { name: t("cfmExercises.title"), exact: true })
      .waitFor();
    const issuing = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/study-exercises") &&
        r.request().postDataJSON()?.action === "issue",
    );
    await page
      .getByRole("button", {
        name: t("progress.practice", { n: fullWeek ? 18 : 3 }),
        exact: true,
      })
      .click();
    const issued = await (await issuing).json();
    assert.equal(issued.exercises.length, fullWeek ? 18 : 3);
    if (scale === 2)
      await page.addStyleTag({ content: "html{font-size:200% !important}" });
    await page.locator("[data-exercise-progress]").waitFor();
    async function assertCheckFits() {
      if (scale !== 2) return;
      const metrics = await page
        .getByRole("button", { name: t("lesson.check"), exact: true })
        .evaluate((el) => {
          const style = getComputedStyle(el),
            canvas = document.createElement("canvas"),
            ctx = canvas.getContext("2d");
          ctx.font = [
            style.fontStyle,
            style.fontWeight,
            style.fontSize,
            style.fontFamily,
          ].join(" ");
          const text = el.textContent.trim().toUpperCase();
          return {
            available:
              el.clientWidth -
              parseFloat(style.paddingLeft) -
              parseFloat(style.paddingRight),
            needed:
              ctx.measureText(text).width +
              (parseFloat(style.letterSpacing) || 0) * text.length,
          };
        });
      assert.ok(
        metrics.needed <= metrics.available + 1,
        "actie blijft leesbaar op één regel bij 320px/200%: " +
          JSON.stringify(metrics),
      );
    }
    await assertCheckFits();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: `${out}/question-${width}-${scheme}.png`,
      fullPage: true,
    });
    const stored = await prisma.exercise.findMany({
        where: { id: { in: issued.exercises.map((e) => e.id) } },
      }),
      byId = new Map(stored.map((q) => [q.id, JSON.parse(q.answers)]));
    async function answer(q, wrong = false) {
      const accepted = byId.get(q.id);
      if (q.type === "WORD_BANK")
        for (const word of accepted)
          await page
            .getByRole("button", {
              name: new RegExp("^" + escape(word) + "$", "i"),
            })
            .last()
            .click();
      else {
        const option = wrong
          ? q.options.find((o) => o.toLowerCase() !== accepted[0])
          : q.options.find((o) => o.toLowerCase() === accepted[0]);
        const button = page.getByRole("button", { name: option, exact: true });
        if (width === 320) await button.tap();
        else {
          await button.focus();
          await page.keyboard.press("Enter");
        }
      }
      const check = page.getByRole("button", {
        name: t("lesson.check"),
        exact: true,
      });
      await check.focus();
      await page.keyboard.press("Enter");
      await page
        .getByRole("button", { name: t("lesson.continue"), exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: t("lesson.continue"), exact: true })
        .click();
    }
    let lost = false;
    if (fullWeek)
      await page.route("**/api/study-exercises", async (route) => {
        if (route.request().postDataJSON()?.action === "submit" && !lost) {
          lost = true;
          await route.fetch();
          return route.abort("failed");
        }
        return route.continue();
      });
    for (const [i, q] of issued.exercises.entries()) {
      assert.equal(
        await page.locator("[data-exercise-group]").innerText(),
        t("cfmStudy.stepOf", {
          n: fullWeek ? Math.floor(i / 3) + 1 : 1,
          total: 6,
        }),
      );
      await answer(q, fullWeek && i === 0);
    }
    if (fullWeek) {
      await page
        .getByRole("heading", {
          name: t("lesson.reviewTitle", { pos: 1, total: 1 }),
          exact: true,
        })
        .waitFor();
      await page.screenshot({
        path: `${out}/review-${width}-${scheme}.png`,
        fullPage: true,
      });
      await assertCheckFits();
      await answer(issued.exercises[0]);
      await page.getByRole("alert").waitFor();
      const replay = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/study-exercises") &&
          r.request().postDataJSON()?.action === "submit",
      );
      await page
        .getByRole("button", { name: t("studyReader.retry"), exact: true })
        .click();
      assert.equal((await (await replay).json()).replayed, true);
    }
    await page
      .getByText(`+${fullWeek ? 200 : 30} XP`, { exact: true })
      .waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.equal(
      await prisma.xPTransaction.count({
        where: { userId: a.user.id, reason: "LESSON_COMPLETED" },
      }),
      1,
    );
    await page.screenshot({
      path: `${out}/result-${width}-${scheme}.png`,
      fullPage: true,
    });
    await page
      .getByRole("link", { name: t("misc.backToLesson"), exact: true })
      .click();
    await page.locator("[data-study-reader]").waitFor();
    assert.equal(
      new URL(page.url()).pathname,
      lessonPath + (fullWeek ? "" : "/stappen/1"),
    );
    if (!fullWeek)
      await page
        .getByText(t("cfmStudy.statusCompleted"), { exact: true })
        .waitFor();
    assert.equal(
      await page.evaluate(() => history.length),
      historyBefore,
      "terug naar les bewaart de oorspronkelijke herkomst",
    );
    assert.deepEqual(errors, []);
    results.push({
      width,
      scheme,
      scale,
      questions: issued.exercises.length,
      source: "explicit synthetic fixture",
      grouped: true,
      review: !!fullWeek,
      lostResponseRecovered: !!fullWeek,
      xpTransactions: 1,
      returnToLesson: true,
      noOverflow: true,
    });
    await context.close();
  }
  const real = await officialCfmExerciseFixture(2027),
    realAccount = await referenceAccount();
  await prisma.user.update({
    where: { id: realAccount.user.id },
    data: {
      onboardingSeenAt: new Date(),
      onboardingProfilePrivacyAt: new Date(),
      avatarCharacterId: "nephi",
      emailVerifiedAt: new Date(),
      kompasOffersEnabled: false,
    },
  });
  const realContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "dark",
  });
  await realContext.addCookies([
    { name: SESSION_COOKIE, value: realAccount.token, url: base },
  ]);
  const realPage = await realContext.newPage();
  await realPage.goto(
    `${base}/study-lesson/${real.lesson.id}/${real.key}/stappen/1`,
  );
  await realPage.locator("[data-study-exercises]").click();
  await realPage
    .getByRole("button", {
      name: t("progress.practice", { n: 3 }),
      exact: true,
    })
    .click();
  await realPage.locator("[data-exercise-progress]").waitFor();
  await realPage.screenshot({
    path: out + "/official-2027-question-390-dark.png",
    fullPage: true,
  });
  assert.ok(
    await realPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await realContext.close();
  results.push({
    pinnedOfficial2027Copy: true,
    threeQuestionsFromReadScriptureQuotes: true,
  });
  const chapter = await standardExerciseFixture(),
    a0 = await referenceAccount(),
    ordinary = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: "light",
    });
  await ordinary.addCookies([
    { name: SESSION_COOKIE, value: a0.token, url: base },
  ]);
  const p0 = await ordinary.newPage();
  await p0.goto(base + "/lesson/" + chapter.id);
  await p0
    .getByRole("button", {
      name: t("progress.practice", { n: 3 }),
      exact: true,
    })
    .click();
  for (let i = 0; i < 3; i++) {
    await p0
      .getByRole("button", {
        name:
          (i === 0 ? "❌ " : "✅ ") +
          t(i === 0 ? "lesson.false" : "lesson.true"),
        exact: true,
      })
      .click();
    await p0
      .getByRole("button", { name: t("lesson.check"), exact: true })
      .click();
    await p0
      .getByRole("button", { name: t("lesson.continue"), exact: true })
      .click();
  }
  await p0
    .getByRole("heading", {
      name: t("lesson.reviewTitle", { pos: 1, total: 1 }),
      exact: true,
    })
    .waitFor();
  await p0
    .getByRole("button", { name: "✅ " + t("lesson.true"), exact: true })
    .click();
  await p0
    .getByRole("button", { name: t("lesson.check"), exact: true })
    .click();
  await p0
    .getByRole("button", { name: t("lesson.continue"), exact: true })
    .click();
  await p0.getByText("+50 XP", { exact: true }).waitFor();
  await ordinary.close();
  results.push({ existingChapterFlow: true, sharedReview: true, xp: 50 });
  await prisma.exercise.updateMany({
    where: { studyLessonEditionId: f.edition.id },
    data: { status: "RETIRED" },
  });
  const a = await referenceAccount(),
    context = await browser.newContext({
      viewport: { width: 320, height: 844 },
    });
  await context.addCookies([
    { name: SESSION_COOKIE, value: a.token, url: base },
  ]);
  const page = await context.newPage();
  await page.goto(`${base}/study-lesson/${f.lesson.id}/${f.key}/stappen/1`);
  await page
    .getByText(t("cfmExercises.unavailable"), { exact: true })
    .waitFor();
  assert.equal(await page.locator("[data-study-exercises]").count(), 0);
  await page.locator("[data-complete-step]").click();
  await page
    .getByText(t("cfmStudy.statusCompleted"), { exact: true })
    .waitFor();
  assert.equal(
    await prisma.xPTransaction.count({ where: { userId: a.user.id } }),
    0,
  );
  await page.screenshot({
    path: out + "/reading-without-questions-320.png",
    fullPage: true,
  });
  await context.close();
  results.push({
    missingQuestions: true,
    readingAndStepCompletionPreserved: true,
    xp: 0,
  });
  writeFileSync(out + "/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ cfmExercisesBrowser: results }));
} finally {
  await browser.close();
  await prisma.$disconnect();
}
