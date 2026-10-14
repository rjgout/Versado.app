// Verkleint screenshots (PNG → JPEG, max. breedte) voor in de repository: node shrink.mjs <invoermap> <uitvoermap> <bestand...>
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const [from, to, ...files] = process.argv.slice(2); mkdirSync(to, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright"); const browser = await chromium.launch({ args: ["--no-sandbox"] }); const page = await browser.newPage();
for (const file of files) {
  const data = `data:image/png;base64,${readFileSync(`${from}/${file}.png`).toString("base64")}`;
  const jpeg = await page.evaluate(async (src) => { const image = new Image(); image.src = src; await image.decode(); const width = Math.min(760, image.width); const height = Math.round(image.height * width / image.width); const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; canvas.getContext("2d").drawImage(image, 0, 0, width, height); return canvas.toDataURL("image/jpeg", 0.82); }, data);
  writeFileSync(`${to}/${file}.jpg`, Buffer.from(jpeg.split(",")[1], "base64"));
}
await browser.close();
