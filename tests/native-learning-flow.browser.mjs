// Werkelijke lokale Foundation, lezer, gedeelde vraagkaarten en resultaten.
// HTTP/OS zijn synthetisch; echte servertransacties worden afzonderlijk getest.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";
import { getT } from "../src/lib/i18n/index.ts";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const out = "/tmp/versado-native-learning-flow-browser";
mkdirSync(out, { recursive: true });
const bundle = await build({
    entryPoints: ["tests/fixtures/native-learning-flow-client.tsx"],
    bundle: true,
    write: false,
    minify: true,
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  css = readFileSync("dist/native/index.css");
const server = createServer((req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle.outputFiles[0].contents);
  } else if (req.url === "/app.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
  } else if (req.url?.startsWith("/icons/")) {
    res.setHeader("Content-Type", "image/png");
    res.end(readFileSync("public/icons/native/versado-flame.png"));
  } else
    res.end(
      '<!doctype html><html lang="nl"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`,
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? undefined,
    args: ["--no-sandbox"],
  });
const errors = [];
async function open(query = "kind=steps") {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.log("PAGE ERROR", error.message);
  });
  await page.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () =>
      document.documentElement.style.setProperty("--vs-safe-area-top", "59px"),
    ),
  );
  const kind = new URLSearchParams(query).get("kind") ?? "chapters";
  await page.goto(`${origin}/?${query}#/courses/course/read/${kind}/target`);
  await page.locator("[data-native-learning-actions]").waitFor();
  return page;
}
async function begin(page) {
  await page
    .getByRole("button", { name: "Volgende stap", exact: true })
    .click();
  await page.locator("[data-native-learning-phase=questions]").waitFor();
}
async function answer(page, type = "MULTIPLE_CHOICE", wrong = false) {
  if (type === "TRUE_FALSE")
    await page
      .getByRole("button", {
        name: wrong ? "❌ Niet waar" : "✅ Waar",
        exact: true,
      })
      .click();
  else if (type === "WORD_BANK" || type === "SEQUENCE") {
    await page.getByRole("button", { name: "A", exact: true }).click();
    await page.getByRole("button", { name: "B", exact: true }).click();
  } else
    await page
      .getByRole("button", { name: wrong ? "B" : "A", exact: true })
      .click();
  await page.getByRole("button", { name: "Controleer", exact: true }).click();
}
try {
  const page = await open();
  await page.locator('[data-native-read-aloud] button.w-full:not(:disabled)').waitFor();
  await page.locator('[data-native-read-aloud] button.w-full').click();
  await page.waitForFunction(()=>window.audioEvidence.active);
  await begin(page);
  await page.waitForFunction(()=>!window.audioEvidence.active);
  assert.equal(await page.locator('[data-read-aloud-mini-player]').count(),0);

  await answer(page);
  await page.getByRole("button", { name: /^Doorgaan/ }).click();
  await page.locator("[data-native-learning-phase=result]").waitFor();
  assert.ok((await page.textContent("main")).includes("+23 XP"));
  assert.equal(await page.locator("[data-read-aloud-mini-player]").count(), 0);
  await page.screenshot({
    path: `out/result.png`.replace("out", out),
    fullPage: true,
  });
  await page.getByRole("button", { name: /^Volgende stap/ }).click();
  await page.waitForFunction(() => location.hash.includes("next-target"));
  await page.locator("[data-native-reader]").waitFor();
  await page.close();
  for (const type of ["FILL_BLANK", "TRUE_FALSE", "WORD_BANK", "SEQUENCE"]) {
    const p = await open(`kind=steps&question=${type}`);
    await begin(p);
    await answer(p, type);
    await p.getByRole("button", { name: /^Doorgaan/ }).click();
    await p.locator("[data-native-learning-phase=result]").waitFor();
    await p.close();
  }
  for (const mode of ["free", "front"]) {
    const p = await open(`kind=chapters&mode=${mode}`);
    await p
      .getByRole("button", { name: "Markeer als gelezen", exact: true })
      .click();
    await p.locator("[data-native-learning-phase=read-result]").waitFor();
    assert.equal(
      await p.evaluate(() => window.learningEvidence.readCommits),
      1,
    );
    assert.equal(await p.evaluate(() => window.learningEvidence.commits), 0);
    await p.getByRole("button", { name: /^Naar de vragen/ }).click();
    await p.locator("[data-native-learning-phase=questions]").waitFor();
    await answer(p);
    await p.getByRole("button", { name: /^Doorgaan/ }).click();
    await p.locator("[data-native-learning-phase=result]").waitFor();
    await p.close();
  }
  const empty = await open("kind=steps&empty=1");
  await empty
    .getByRole("button", { name: "Volgende stap", exact: true })
    .click();
  await empty.locator("[data-native-learning-phase=empty]").waitFor();
  assert.equal(
    await empty.evaluate(() => window.learningEvidence.readCommits),
    0,
  );
  await empty.getByRole("button", { name: /^Stap afronden/ }).click();
  await empty.locator("[data-native-learning-phase=read-result]").waitFor();
  assert.equal(await empty.evaluate(() => window.learningEvidence.commits), 0);
  assert.equal((await empty.textContent("main")).includes("+23 XP"), false);
  await empty.close();
  // Controlefout bewaart keuze en wordt nooit een fout antwoord.
  const check = await open();
  await begin(check);
  await check.evaluate(() => window.learningTest.checkFailure());
  await answer(check);
  assert.equal(
    await check
      .getByRole("button", { name: "Controleer", exact: true })
      .isEnabled(),
    true,
  );
  assert.equal(await check.evaluate(() => window.learningEvidence.commits), 0);
  await check.getByRole("button", { name: "Controleer", exact: true }).click();
  await check.getByRole("button", { name: /^Doorgaan/ }).click();
  await check.locator("[data-native-learning-phase=result]").waitFor();
  await check.close();
  // Vertraagde controle bevriest de daadwerkelijk ingezonden keuze.
  const checking = await open();
  await begin(checking);
  await checking.getByRole("button", { name: "A", exact: true }).click();
  await checking.evaluate(() => window.learningTest.holdCheck());
  await checking
    .getByRole("button", { name: "Controleer", exact: true })
    .click();
  assert.equal(
    await checking.getByRole("button", { name: "B", exact: true }).isDisabled(),
    true,
  );
  await checking
    .getByRole("button", { name: "B", exact: true })
    .evaluate((e) => e.click());
  await checking.evaluate(() => window.learningTest.resumeCheck());
  await checking.getByRole("button", { name: /^Doorgaan/ }).click();
  await checking.locator("[data-native-learning-phase=result]").waitFor();
  const checkedCalls = await checking.evaluate(
    () => window.learningEvidence.calls,
  );
  assert.equal(checkedCalls.filter((c) => c.route === "check").length, 1);
  assert.deepEqual(
    checkedCalls.find((c) => c.route === "submit").body.answers,
    [{ exerciseId: "q1", given: ["A"] }],
  );
  await checking.close();
  // Verloren response na echte fixturecommit: één submit, GET haalt het origineel.
  const after = await open();
  await begin(after);
  await answer(after);
  await after.evaluate(() => window.learningTest.submitFailure("after"));
  await after.getByRole("button", { name: /^Doorgaan/ }).click();
  await after.locator("[data-native-learning-phase=result]").waitFor();
  assert.equal(await after.evaluate(() => window.learningEvidence.commits), 1);
  assert.equal(
    await after.evaluate(
      () =>
        window.learningEvidence.calls.filter((c) => c.route === "submit")
          .length,
    ),
    1,
  );
  await after.close();
  // Onzekere poging: reconnect mag alleen GET doen, navigatie/remount mag hem niet weggooien.
  const before = await open();
  await begin(before);
  await answer(before);
  await before.evaluate(() => {
    window.learningTest.submitFailure("before");
    window.learningTest.getFailure(true);
  });
  await before.getByRole("button", { name: /^Doorgaan/ }).click();
  await before
    .getByRole("button", { name: "Opnieuw proberen", exact: true })
    .waitFor();
  await before.locator("[data-subpage-back-bar] button").click();
  await before.getByRole("dialog").waitFor();
  assert.ok(
    (await before.getByRole("dialog").textContent()).includes(
      "onzekere afronding",
    ),
  );
  await before
    .getByRole("dialog")
    .getByRole("button", { name: "Sluiten", exact: true })
    .click();
  await before.evaluate(() => window.dispatchEvent(new Event("online")));
  await before.waitForTimeout(100);
  assert.equal(
    await before.evaluate(
      () =>
        window.learningEvidence.calls.filter((c) => c.route === "submit")
          .length,
    ),
    1,
  );
  await before.evaluate(() => window.learningTest.getFailure(false));
  await before
    .getByRole("button", { name: "Opnieuw proberen", exact: true })
    .click();
  await before.locator("[data-native-learning-phase=result]").waitFor();
  const submits = await before.evaluate(() =>
    window.learningEvidence.calls.filter((c) => c.route === "submit"),
  );
  assert.equal(submits.length, 2);
  assert.deepEqual(submits[0].body, submits[1].body);
  assert.equal(await before.evaluate(() => window.learningEvidence.commits), 1);
  await before.close();
  // Correctieronde blijft voor hoofdstukken; stapvragen krijgen geen nieuwe herkansingsregels.
  const review = await open("kind=chapters&mode=free");
  await review.getByRole("button", { name: /^Naar de vragen/ }).click();
  await review.locator("[data-native-learning-phase=questions]").waitFor();
  await answer(review, "MULTIPLE_CHOICE", true);
  await review.getByRole("button", { name: /^Doorgaan/ }).click();
  await review.getByRole("heading", { name: /Leermomenten/ }).waitFor();
  await answer(review);
  await review.getByRole("button", { name: /^Doorgaan/ }).click();
  await review.locator("[data-native-learning-phase=result]").waitFor();
  assert.equal(
    await review.evaluate(() => window.learningEvidence.readCommits),
    0,
  );
  await review.close();
  for (const operation of ["account", "source", "expire", "deny"]) {
    const p = await open();
    await begin(p);
    if (operation === "account")
      await p.evaluate(() => window.audioTest.nextAccount());
    else if (operation === "source")
      await p.evaluate(() => window.audioTest.sourceChange());
    else {
      await p.evaluate(
        (operation) => window.learningTest[operation](),
        operation,
      );
      await p.evaluate(() =>
        window.dispatchEvent(new Event("versado:app-resumed")),
      );
    }
    await p.waitForFunction(
      () => !document.querySelector("[data-native-learning-phase=questions]"),
    );
    assert.equal(
      await p.evaluate(
        () =>
          window.learningEvidence.calls.filter((c) => c.route === "submit")
            .length,
      ),
      0,
    );
    await p.close();
  }
  const old = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await old.goto(
    `${origin}/?capability=0#/courses/course/read/chapters/target`,
  );
  await old.locator("[data-native-reader]").waitFor();
  assert.equal(await old.locator("[data-native-learning-actions]").count(), 0);
  assert.equal(
    await old.evaluate(() => window.learningEvidence.calls.length),
    0,
  );
  await old.close();
  // Werkelijke shell, alle UI-talen, 320px/200%, donker/licht en routefocus.
  for (const [language, scheme] of [
    ["nl", "light"],
    ["en", "dark"],
    ["de", "light"],
    ["fr", "dark"],
    ["es", "light"],
  ]) {
    const p = await open(`kind=steps&language=${language}`),
      t = getT(language);
    await p.setViewportSize({ width: 320, height: 760 });
    await p.emulateMedia({ colorScheme: scheme });
    await p.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await p
      .getByRole("button", { name: t("nativeLearningFlow.next"), exact: true })
      .click();
    await p.locator("[data-native-learning-phase=questions]").waitFor();
    assert.equal(
      await p
        .getByRole("button", { name: t("lesson.check"), exact: true })
        .isEnabled(),
      false,
      "geen leeg antwoord",
    );
    await p.waitForFunction(() =>
      document.activeElement?.matches('h1[tabindex="-1"]'),
    );
    assert.equal(
      await p.evaluate(
        () => getComputedStyle(document.activeElement).outlineStyle,
      ),
      "none",
    );
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
      `${language} horizontale overflow`,
    );
    await p.getByRole("button", { name: "A", exact: true }).click();
    const control = p.getByRole("button", {
      name: t("lesson.check"),
      exact: true,
    });
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
    await p.keyboard.press("Tab");
    await control.focus();
    assert.equal(
      await control.evaluate((e) => e.matches(":focus-visible")),
      true,
    );
    if (language === "nl")
      await p.screenshot({
        path: `${out}/questions-320-200-light.png`,
        fullPage: false,
      });
    await control.click();
    await p
      .getByRole("button", { name: t("lesson.continue"), exact: true })
      .click();
    await p.locator("[data-native-learning-phase=result]").waitFor();
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
      `${language} result overflow`,
    );
    if (language === "en")
      await p.screenshot({
        path: `${out}/result-320-200-dark.png`,
        fullPage: false,
      });
    await p.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: daadwerkelijke native schriftflow, vijf vraagtypen, drie leesmethoden, expliciet lezen zonder XP en serverresultaat/volgbestemming. Synthetische HTTP/OS; geen fysieke acceptatie.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
