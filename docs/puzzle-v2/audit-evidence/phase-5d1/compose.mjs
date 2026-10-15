// Zet "vóór" (main na 5C) en "na" (5D-1) naast elkaar met een bijschrift: node compose.mjs <voor-map> <na-map> <uitvoermap>
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const [before, after, out] = process.argv.slice(2); mkdirSync(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright"); const browser = await chromium.launch({ args: ["--no-sandbox"] }); const page = await browser.newPage();
const pairs = [["solo-near-phone", "Solo, telefoon portrait: stuk binnen de snapafstand"], ["solo-far-phone", "Solo, telefoon: buiten de snapafstand"], ["solo-near-landscape", "Solo, telefoon landscape"], ["solo-near-desktop", "Solo, desktop"], ["board-discoverer", "Ontdekker: bordplek binnen snapafstand"], ["board-adventurer", "Avonturier: bordplek binnen snapafstand"], ["board-expert", "Expert: geen bordhulp"], ["board-master", "Meester: geen bordhulp"], ["master-rotation-0", "Meester, juiste rotatie"], ["master-rotation-90", "Meester, onjuiste rotatie (90°)"], ["reduced-motion", "Verminderde beweging: statisch, direct"]];
const data = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
for (const [name, caption] of pairs) {
  await page.setContent(`<body style="margin:0;font:16px system-ui;background:#fff"><h3 style="margin:8px 12px">${caption}</h3><div style="display:flex;gap:12px;padding:0 12px 12px;align-items:flex-start"><figure style="margin:0;flex:1;min-width:0"><figcaption>Vóór (main na 5C)</figcaption><img style="width:100%;border:1px solid #999" src="${data(`${before}/${name}.png`)}"></figure><figure style="margin:0;flex:1;min-width:0"><figcaption>Na (5D-1)</figcaption><img style="width:100%;border:1px solid #999" src="${data(`${after}/${name}.png`)}"></figure></div></body>`);
  const wide = name.includes("phone") ? 900 : 1700; await page.setViewportSize({ width: wide, height: 600 }); await page.waitForTimeout(100);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, type: "png" });
}
await page.setContent(`<body style="margin:0;font:16px system-ui"><h3 style="margin:8px 12px">Samen: de slepende speler (links) ziet de feedback, de andere speler (rechts) niet</h3><div style="display:flex;gap:12px;padding:0 12px 12px"><img style="width:50%;border:1px solid #999" src="${data(`${after}/samen-dragger.png`)}"><img style="width:50%;border:1px solid #999" src="${data(`${after}/samen-other-player.png`)}"></div></body>`);
await page.setViewportSize({ width: 1700, height: 600 }); await page.screenshot({ path: `${out}/samen-dragger-vs-other.png`, fullPage: true });
await browser.close(); console.log("klaar");
