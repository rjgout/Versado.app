import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { prisma } from "../src/lib/db.ts";
import { officialPilotFixture } from "./fixtures/cfm-exercises.mjs";
import {
  referenceAccount,
  assertReferenceTestEnvironment,
} from "./fixtures/reference-content.mjs";
import { SESSION_COOKIE } from "../src/lib/auth.ts";
import { getT } from "../src/lib/i18n/index.ts";
import {
  maxContentBaseXp,
  XP_PER_CORRECT,
} from "../src/lib/learning/rewards.ts";
import { countCanonicalReadContributions } from "../src/lib/dorp/growth.ts";
const base = assertReferenceTestEnvironment(),
  f = await officialPilotFixture(),
  t = getT("nl"),
  out = "/tmp/versado-cfm-pilot-browser";
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
async function actor() {
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
  return a;
}
async function contextFor(a, width, scheme) {
  const c = await browser.newContext({
    viewport: { width, height: 844 },
    colorScheme: scheme,
    hasTouch: true,
    serviceWorkers: "block",
  });
  await c.addCookies([{ name: SESSION_COOKIE, value: a.token, url: base }]);
  return c;
}
// Echte gebruikersscroll beëindigt eventueel lopend centraal scrollherstel.
// Daarna pas vastleggen; een lege compositortegel is geen bruikbaar screenshotbewijs.
async function showReading(page, heading, path) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.wheel(0, 1);
  await heading.evaluate((el) => {
    el.scrollIntoView({ block: "start", behavior: "instant" });
    const header = document.querySelector("[data-sticky-header]");
    window.scrollBy({ top: -(header?.getBoundingClientRect().height ?? 0) - 12, behavior: "instant" });
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await heading.waitFor({ state: "visible" });
  await page.screenshot({ animations: "disabled", path });
  const sharp = createRequire(import.meta.url)("sharp");
  const stats = await sharp(path).stats();
  assert.ok(Math.max(...stats.channels.map(c => c.stdev)) > 5, "screenshot toont leesbare inhoud, geen lege achtergrond");
}
async function noOverflow(page) {
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    readingHeadingInsideSection: [...document.querySelectorAll("[data-study-scripture-readings] h2")].every(el => {
      const bounds = el.parentElement.getBoundingClientRect(), range = document.createRange();
      range.selectNodeContents(el);
      return [...range.getClientRects()].every(r => r.right <= bounds.right + 1 && r.left >= bounds.left - 1);
    }),
    overflow: [...document.querySelectorAll("main *")].filter(el => {
      const r = el.getBoundingClientRect();
      return !el.children.length && r.width && (r.right > innerWidth + 1 || r.left < -1);
    }).slice(0, 8).map(el => ({ tag: el.tagName, className: el.className, text: el.textContent?.slice(0, 45), right: el.getBoundingClientRect().right })),
  }));
  assert.ok(layout.scrollWidth <= layout.width + 1 && layout.readingHeadingInsideSection, "geen horizontale scroll of uitstekende leeskop: " + JSON.stringify(layout));
}

async function accepted(issued) {
  const rows = await prisma.exercise.findMany({
    where: { id: { in: issued.exercises.map((q) => q.id) } },
  });
  return new Map(rows.map((row) => [row.id, JSON.parse(row.answers)]));
}
async function answer(page, q, values, wrong = false, touch = false) {
  if (q.type === "WORD_BANK")
    for (const word of wrong ? [...values].reverse() : values)
      await page
        .getByRole("button", {
          name: new RegExp("^" + escape(word) + "$", "i"),
        })
        .last()
        .click();
  else {
    const option = wrong
      ? q.options.find((o) => o.toLowerCase() !== values[0])
      : q.options.find((o) => o.toLowerCase() === values[0]);
    const b = page.getByRole("button", { name: option, exact: true });
    if (touch) await b.tap();
    else {
      await b.focus();
      await page.keyboard.press("Enter");
    }
  }
  const check = page.getByRole("button", {
    name: t("lesson.check"),
    exact: true,
  });
  await check.focus();
  await page.keyboard.press("Enter");
  const next = page.getByRole("button", {
    name: t("lesson.continue"),
    exact: true,
  });
  await next.waitFor();
  await next.click();
}
const lessonPath = `/study-lesson/${f.lesson.id}/${f.key}`;
try {
  for (const [width, scheme, scale, step] of [
    [390, "dark", 1, null],
    [320, "light", 2, 3],
    [320, "dark", 2, 5],
  ]) {
    const a = await actor(),
      context = await contextFor(a, width, scheme),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    if (!step) {
      await page.goto(base + lessonPath + "/stappen/1");
      await page.locator("[data-study-reader-body]").waitFor();
      await showReading(page, page.locator('[data-study-block="b-p2"]'), out + "/scripture-step1-390-dark.png");
    }
    const readerPath =
      lessonPath + (step ? `/stappen/${step}` : "?weergave=volledig");
    if (step === 3) {
      await page.goto(base + lessonPath + "/vragen?stap=3");
      await page.waitForURL(base + readerPath);
      assert.equal(
        await prisma.exerciseSession.count({ where: { userId: a.user.id } }),
        0,
      );
    } else await page.goto(base + readerPath);
    await page.locator("[data-study-reader-body]").waitFor();
    if (scale === 2)
      await page.addStyleTag({ content: 'html{font-size:200% !important}[data-study-scripture-readings] h2{font-family:"DejaVu Sans",sans-serif}' });
    const body = await page.locator("[data-study-reader-body]").innerText(),
      sections = page.locator("[data-study-scripture-reading]");
    assert.equal(await sections.count(), step ? 1 : 6);
    assert.equal(
      await page
        .locator("[data-study-scripture-readings] [data-scripture-verse]")
        .count(),
      step ? 3 : 15,
    );
    const expectedNumbers =
      step === 3 ? [3, 7, 9] : step === 5 ? [20, 21, 25] : null;
    if (expectedNumbers)
      assert.deepEqual(
        await page
          .locator("[data-study-scripture-readings] [data-scripture-verse]")
          .evaluateAll((els) =>
            els.map((el) => Number(el.dataset.scriptureVerse)),
          ),
        expectedNumbers,
      );
    await showReading(page, page.locator("[data-study-scripture-readings]").getByRole("heading").first(), `${out}/scripture-${step ?? "week"}-${width}-${scheme}.png`);
    await noOverflow(page);
    const practice = page.locator("[data-study-exercises]");
    assert.equal(
      await practice.evaluate((el) =>
        Boolean(
          document
            .querySelector("[data-study-scripture-readings]")
            .compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
      true,
      "schriftlezing vóór de vragenactie",
    );
    const historyBefore = await page.evaluate(() => history.length);
    const issuing = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/study-exercises") &&
        r.request().postDataJSON()?.action === "issue",
    );
    await practice.focus();
    await page.keyboard.press("Enter");
    const issued = await (await issuing).json();
    const navigationKey = (await (await issuing).request().allHeaders())[
      "x-reading-session"
    ];
    const withoutProof = await page.request.post(
      base + "/api/study-exercises",
      {
        headers: { Origin: base, "X-Reading-Session": navigationKey },
        data: {
          action: "check",
          sessionId: issued.sessionId,
          exerciseId: issued.exercises[0].id,
          given: ["fout"],
        },
      },
    );
    assert.equal(withoutProof.status(), 409);
    assert.equal((await withoutProof.json()).code, "READ_REQUIRED");

    assert.equal(issued.exercises.length, step ? 3 : 18);
    await page.locator("[data-exercise-progress]").waitFor();
    if (scale === 2) {
      await page.addStyleTag({ content: 'html{font-size:200% !important}[data-study-scripture-readings] h2{font-family:"DejaVu Sans",sans-serif}' });
      assert.equal(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).fontSize,
        ),
        "32px",
      );
    }
    assert.equal(
      await page
        .getByRole("button", {
          name: t("progress.practice", { n: step ? 3 : 18 }),
          exact: true,
        })
        .count(),
      0,
      "geen tweede startscherm",
    );
    const values = await accepted(issued);
    await noOverflow(page);
    await page.keyboard.press("Control+Home");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ animations: "disabled", path: `${out}/question-${step ?? "week"}-${width}-${scheme}.png` });
    let lost = false, failedResume = false;
    const resumeFailure = Promise.withResolvers();
    const dropped = Promise.withResolvers();
    // Voorkom een ongevangen handlerfout vóór de hoofdflow deze belofte afwacht.
    dropped.promise.catch(() => {});
    if (!step || step===5)
      await page.route("**/api/study-exercises", async (route) => {
        if (!step && route.request().postDataJSON()?.action === "resume" && !failedResume) {
          failedResume = true;
          await route.abort("failed");
          resumeFailure.resolve();
          return;
        }
        if (route.request().postDataJSON()?.action === "submit" && !lost) {
          lost = true;
          try {
            if (step !== 5) {
              const committed = await route.fetch();
              await committed.body();
              assert.equal(committed.status(), 200, "inzending is bevestigd vóór antwoordverlies");
            }
            await route.abort("failed");
            dropped.resolve();
          } catch (error) {
            dropped.reject(new Error("Onderschepte inzending niet voltooid: " + error.name));
          }
          return;
        }
        return route.continue();
      });
    for (const [i, q] of issued.exercises.entries()) {
      if (!step && i === 2) {
        await page.waitForFunction(() =>
          Object.keys(sessionStorage).some(
            (k) =>
              k.startsWith("cfm-exercise:") &&
              !k.endsWith(":visit") &&
              JSON.parse(sessionStorage.getItem(k))?.checkpoint?.index === 2,
          ),
        );
        await page.reload();
        await resumeFailure.promise;
        const retry = page.getByRole("button", { name: t("progress.practice", { n: 18 }), exact: true });
        await retry.waitFor();
        assert.ok(await page.evaluate(() => Object.keys(sessionStorage).some(k => k.startsWith("cfm-exercise:") && !k.endsWith(":visit") && JSON.parse(sessionStorage.getItem(k))?.checkpoint?.index === 2)), "verbindingsfout bij hervatten bewaart de twee bevestigde antwoorden");
        const resumed = page.waitForResponse(
          r => r.url().endsWith("/api/study-exercises") && r.request().postDataJSON()?.action === "resume",
        );
        await retry.click();
        const resume = await (await resumed).json();
        assert.equal(resume.issued.sessionId, issued.sessionId);
        assert.equal(resume.result, null);
        await page.locator("[data-exercise-progress]").waitFor();
        assert.match(
          await page.locator("[data-exercise-progress]").innerText(),
          /2\s*\/\s*18/,
        );
        assert.equal(
          await prisma.exerciseSession.count({ where: { userId: a.user.id } }),
          1,
        );
      }
      assert.equal(
        await page.locator("[data-exercise-group]").innerText(),
        t("cfmStudy.stepOf", { n: step ?? Math.floor(i / 3) + 1, total: 6 }),
      );
      await answer(page, q, values.get(q.id), !step && i === 0, width === 320);
    }
    if (!step) {
      await page
        .getByRole("heading", {
          name: t("lesson.reviewTitle", { pos: 1, total: 1 }),
          exact: true,
        })
        .waitFor();
      await page.screenshot({animations:"disabled", path: out + "/review-week-390-dark.png" });
      await answer(
        page,
        issued.exercises[0],
        values.get(issued.exercises[0].id),
      );
      await dropped.promise;
      const committedSession = await prisma.exerciseSession.findUniqueOrThrow({ where: { id: issued.sessionId } });
      assert.ok(committedSession.submittedAt && committedSession.result, "serveropslag bevestigd vóór herladen");
      await page.getByRole("alert").filter({ has: page.getByRole("button", { name: t("studyReader.retry"), exact: true }) }).waitFor();
      const resumed = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/study-exercises") &&
          r.request().postDataJSON()?.action === "resume",
      );
      await page.reload();
      const resume = await (await resumed).json();
      assert.ok(resume.result);
      assert.equal(resume.issued.sessionId, issued.sessionId);
    }
    if(step===5){
      await dropped.promise;
      await page.getByRole("alert").filter({ has: page.getByRole("button", { name: t("studyReader.retry"), exact: true }) }).waitFor();
      const resuming=page.waitForResponse(r=>r.url().endsWith("/api/study-exercises")&&r.request().postDataJSON()?.action==="resume");
      await page.reload();const resumed=await(await resuming).json();assert.equal(resumed.result,null);assert.equal(resumed.issued.sessionId,issued.sessionId);
      await page.addStyleTag({content:"html{font-size:200% !important}"});
      await page.getByRole("button",{name:t("studyReader.retry"),exact:true}).click();
    }
    await page
      .getByText(`+${step ? 3 * XP_PER_CORRECT : maxContentBaseXp(18)} XP`, {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await prisma.xPTransaction.count({
        where: { userId: a.user.id, reason: "LESSON_COMPLETED" },
      }),
      1,
    );
    assert.equal(await countCanonicalReadContributions(prisma, [a.user.id]), 0);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } }))
        .activeContentCollectionId,
      f.key,
    );
    await noOverflow(page);
    await page.screenshot({animations:"disabled",
      path: `${out}/result-${step ?? "week"}-${width}-${scheme}.png`,
    });
    await page
      .getByRole("link", { name: t("misc.backToLesson"), exact: true })
      .click();
    await page.locator("[data-study-reader-body]").waitFor();
    assert.equal(
      new URL(page.url()).pathname,
      lessonPath + (step ? `/stappen/${step}` : ""),
    );
    assert.equal(await page.evaluate(() => history.length), historyBefore);
    assert.equal(
      await page.locator("[data-study-reader-body]").innerText(),
      body,
    );
    if (step)
      await page
        .getByText(t("cfmStudy.statusCompleted"), { exact: true })
        .waitFor();
    assert.deepEqual(errors, []);
    results.push({
      officialPilot: true,
      width,
      scheme,
      scale,
      wideReadingHeadingFont: scale === 2,
      step,
      visibleVerses: step ? 3 : 15,
      questions: issued.exercises.length,
      returnToLesson: true,
      bodyUnchanged: true,
      noOverflow: true,
      resumedSameSession: !step,
      resumeNetworkFailureRecovered: !step,
      lostResponseRecovered: !step,
      unconfirmedRetryRecovered: step===5,
      xpTransactions: 1,
      dorpContributions: 0,
    });
    await context.close();
  }
  const a = await actor(),
    context = await contextFor(a, 320, "light"),
    page = await context.newPage();
  await prisma.contentCollection.update({
    where: { id: f.pgpCollection.id },
    data: { visibleToUsers: false },
  });
  try {
    await page.goto(base + lessonPath + "/stappen/3");
    await page
      .getByText(t("cfmExercises.scriptureUnavailable"), { exact: true })
      .waitFor();
    assert.equal(
      await page.locator("[data-study-scripture-reading]").count(),
      0,
    );
    assert.equal(await page.locator("[data-study-exercises]").count(), 0);
    await page.locator("[data-complete-step]").click();
    await page
      .getByText(t("cfmStudy.statusCompleted"), { exact: true })
      .waitFor();
    assert.equal(
      await prisma.xPTransaction.count({ where: { userId: a.user.id } }),
      0,
    );
    await noOverflow(page);
    await page.screenshot({animations:"disabled", path: out + "/missing-scripture-320-light.png" });
    results.push({
      missingSource: true,
      readingAndStepCompletionPreserved: true,
      xp: 0,
    });
  } finally {
    await prisma.contentCollection.update({
      where: { id: f.pgpCollection.id },
      data: { visibleToUsers: true },
    });
    await context.close();
  }
  writeFileSync(out + "/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ officialCfmPilotBrowser: results }));
} catch (error) {
  console.error(
    "::error title=Officiële CFM-pilot::" +
      String(error?.stack ?? error)
        .replaceAll("%", "%25")
        .replaceAll("\r", "%0D")
        .replaceAll("\n", "%0A"),
  );
  throw error;
} finally {
  await browser.close();
  await prisma.$disconnect();
}
