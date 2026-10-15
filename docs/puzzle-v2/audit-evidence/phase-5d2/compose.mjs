// Zet de frame-reeksen vóór (5D-1) en na (5D-2) onder elkaar: node compose.mjs <voor-map> <na-map> <uitvoermap>
import { createRequire } from "node:module";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
const [before, after, out] = process.argv.slice(2); mkdirSync(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright"); const browser = await chromium.launch({ args: ["--no-sandbox"] }); const page = await browser.newPage();
const names = [["solo-desktop", "Solo (desktop): bevestigde verbinding"], ["solo-phone", "Solo (telefoon portrait): bevestigde verbinding"], ["solo-landscape", "Solo (telefoon landscape): bevestigde verbinding"], ["solo-reduced", "Solo met verminderde beweging: direct de bevestigde stand"], ["samen-desktop-dragger", "Samen: de speler die verbindt"], ["samen-desktop-other", "Samen: de andere speler ziet dezelfde snap"], ["samen-phone-other", "Samen (telefoon): de andere speler"], ["remote-smooth", "Samen: remote sleepbeweging zoals een andere speler die ziet"], ["remote-reduced", "Samen: remote sleepbeweging met verminderde beweging (geen interpolatie)"]];
const data = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
for (const [name, caption] of names) {
  const b = `${before}/frames-${name}.png`, a = `${after}/frames-${name}.png`; if (!existsSync(a)) continue;
  await page.setContent(`<body style="margin:0;font:16px system-ui;background:#fff"><h3 style="margin:8px 12px">${caption}</h3>${existsSync(b) ? `<div style="margin:0 12px"><b>Vóór (5D-1)</b></div><img style="width:100%;border-bottom:3px solid #444" src="${data(b)}">` : ""}<div style="margin:8px 12px 0"><b>Na (5D-2)</b></div><img style="width:100%" src="${data(a)}"></body>`);
  await page.setViewportSize({ width: 1800, height: 400 }); await page.waitForTimeout(100); await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}
await browser.close(); console.log("klaar");
