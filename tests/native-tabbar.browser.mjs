// Echte-browserproef (Chromium) voor de native tabbalk: de React-ruimtehouder is exact zo hoog als de
// gemeten native balk (ook bij 0/ongeldig, grote tekst en rotatie) en de modalherkenning ziet
// dialoog, aria-modal én een Kompas-rondleiding in zijn beginfase. Geen database of server nodig.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const css = readFileSync("src/app/globals.css", "utf8");
const start = css.indexOf('html[data-vs-native-tabbar="true"] nav[data-main-nav] {');
const end = css.indexOf("}", css.indexOf('nav[data-main-nav] > * {', start)) + 1;
assert.ok(start > 0 && end > start, "ruimtehouderregels staan in globals.css");
const rules = css.slice(start, end);
const selectorBundle = (await build({ entryPoints: ["src/lib/native/modalSelector.ts"], bundle: true, write: false, format: "iife", globalName: "m", platform: "browser" })).outputFiles[0].text;

const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 320, height: 568 }, { width: 430, height: 932 }, { width: 932, height: 430 }]) {
    const page = await browser.newPage({ viewport });
    await page.setContent(`<!doctype html><html><head><style>
      body{margin:0;font-size:16px} nav[data-main-nav]{position:fixed;bottom:0;left:0;right:0;height:64px;padding:6px;background:#fff}
      nav[data-main-nav] a{display:block;min-height:52px}
      ${rules}</style></head><body><main>x</main><nav data-main-nav><a>Vandaag</a><a>Leren</a></nav></body></html>`);
    for (const height of [49, 83, 97, 130.4]) {
      const measured = await page.evaluate(h => {
        document.documentElement.style.setProperty("--vs-native-tabbar-height", `${Math.ceil(h)}px`);
        document.documentElement.setAttribute("data-vs-native-tabbar", "true");
        const nav = document.querySelector("nav[data-main-nav]");
        const link = nav.querySelector("a");
        return { nav: nav.getBoundingClientRect().height, link: getComputedStyle(link).visibility, events: getComputedStyle(nav).pointerEvents, bottom: nav.getBoundingClientRect().bottom, vh: innerHeight };
      }, height);
      assert.equal(measured.nav, Math.ceil(height), `${viewport.width}x${viewport.height}: ruimtehouder ${height}`);
      assert.equal(measured.link, "hidden"); assert.equal(measured.events, "none"); assert.equal(measured.bottom, measured.vh);
    }
    // Grote tekst mag de ruimtehouder niet groter maken dan de native balk.
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    assert.equal(await page.evaluate(() => document.querySelector("nav[data-main-nav]").getBoundingClientRect().height), 131);
    // Terugval: zonder attribuut is de React-balk weer zichtbaar en bedienbaar.
    await page.evaluate(() => { document.documentElement.removeAttribute("data-vs-native-tabbar"); document.documentElement.style.removeProperty("--vs-native-tabbar-height"); });
    const back = await page.evaluate(() => { const nav = document.querySelector("nav[data-main-nav]"); return [getComputedStyle(nav.querySelector("a")).visibility, getComputedStyle(nav).pointerEvents]; });
    assert.deepEqual(back, ["visible", "auto"]);
    await page.close();
  }
  const page = await browser.newPage();
  await page.setContent("<body><main></main></body>");
  await page.addScriptTag({ content: selectorBundle });
  const detect = html => page.evaluate(([markup]) => { document.body.innerHTML = markup; return document.querySelector(m.MODAL_SELECTOR) !== null; }, [html]);
  assert.equal(await detect("<main></main>"), false);
  assert.equal(await detect("<dialog></dialog>"), false, "een gesloten dialoog telt niet");
  assert.equal(await detect("<dialog open></dialog>"), true);
  assert.equal(await detect('<div role="dialog" aria-modal="true"></div>'), true);
  assert.equal(await detect('<div data-kompas-tour role="presentation"></div>'), true, "rondleiding in beginfase, nog zonder aria-modal");
  await page.close();
  console.log("native-tabbar browserproef geslaagd");
} finally { await browser.close(); }
