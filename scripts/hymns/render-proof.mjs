// Rendert MusicXML-bestanden met OpenSheetMusicDisplay in Chromium naar PNG (visuele controle en rapportage).
//   PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... node scripts/hymns/render-proof.mjs <breedte> <uitvoermap> <bestand.xml>...
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const [width, outDir, ...files] = process.argv.slice(2);
const osmd = fs.readFileSync(path.join(process.cwd(), "node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js"), "utf8");
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 } });
await page.setContent(`<html><body style="margin:0;background:#fff"><div id="c"></div></body></html>`);
await page.addScriptTag({ content: osmd });
for (const file of files) {
  const xml = fs.readFileSync(file, "utf8");
  const info = await page.evaluate(async (xml) => {
    const el = document.getElementById("c"); el.innerHTML = "";
    const o = new opensheetmusicdisplay.OpenSheetMusicDisplay(el, { autoResize: false, backend: "svg", drawTitle: false, drawComposer: false, drawPartNames: false, drawingParameters: "compact", renderSingleHorizontalStaffline: false });
    await o.load(xml); o.zoom = 1; o.render();
    return { measures: o.GraphicSheet.MeasureList.length, systems: o.GraphicSheet.MusicPages[0].MusicSystems.length };
  }, xml);
  await page.setViewportSize({ width: Number(width), height: await page.evaluate(() => document.body.scrollHeight + 10) });
  const out = path.join(outDir, path.basename(file).replace(/\.xml$/, ".png"));
  await page.screenshot({ path: out, fullPage: true });
  console.log(out, JSON.stringify(info));
}
await browser.close();
