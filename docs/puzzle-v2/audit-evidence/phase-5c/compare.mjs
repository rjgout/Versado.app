// Vergelijkt twee uitvoeren van render-compare.mjs. Gelijke sha256 = pixel-identiek; bij een verschil telt een
// headless browser de afwijkende pixels (alleen voor de rapportage, niet voor de beoordeling van "gelijk").
//   node compare.mjs /tmp/render-before /tmp/render-after
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const [a, b] = process.argv.slice(2); const left = JSON.parse(readFileSync(`${a}/hashes.json`, "utf8")); const right = JSON.parse(readFileSync(`${b}/hashes.json`, "utf8"));
const names = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(); const different = []; let same = 0;
for (const name of names) { if (left[name] === right[name]) same++; else different.push(name); }
console.log(`${names.length} scenario's: ${same} pixel-identiek, ${different.length} verschillend`);
if (different.length) {
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright"); const browser = await chromium.launch({ args: ["--no-sandbox"] }); const page = await browser.newPage();
  for (const name of different) {
    if (!left[name] || !right[name]) { console.log(`${name}: alleen in één uitvoer`); continue; }
    const result = await page.evaluate(async ([x, y]) => {
      const load = (b64) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.src = `data:image/png;base64,${b64}`; });
      const [p, q] = await Promise.all([load(x), load(y)]); const c = document.createElement("canvas"); c.width = p.width; c.height = p.height; const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(p, 0, 0); const d1 = ctx.getImageData(0, 0, c.width, c.height).data; ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(q, 0, 0); const d2 = ctx.getImageData(0, 0, c.width, c.height).data;
      let count = 0, max = 0; for (let i = 0; i < d1.length; i += 4) { const delta = Math.max(Math.abs(d1[i] - d2[i]), Math.abs(d1[i + 1] - d2[i + 1]), Math.abs(d1[i + 2] - d2[i + 2]), Math.abs(d1[i + 3] - d2[i + 3])); if (delta) { count++; max = Math.max(max, delta); } }
      return { size: `${c.width}x${c.height}`, count, max };
    }, [readFileSync(`${a}/${name}.png`).toString("base64"), readFileSync(`${b}/${name}.png`).toString("base64")]);
    console.log(`${name}: ${result.count} afwijkende pixels van ${result.size}, grootste kanaalverschil ${result.max}`);
  }
  await browser.close();
  process.exitCode = 1;
}
