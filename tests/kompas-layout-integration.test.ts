// Contract tussen Versado Kompas en de centrale shell-layout (docs/KOMPAS.md,
// docs/LAYOUT.md): Kompas meet de vaste balken uit dezelfde elementen als de
// shell en introduceert geen eigen offsetlogica of shellvariabelen.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : /\.(tsx|ts)$/.test(file) ? [file] : [];
  });
}
const kompasFiles = [...walk(path.join(root, "src/lib/kompas")), ...walk(path.join(root, "src/components/kompas")), ...walk(path.join(root, "src/app/kompas"))];

test("Kompas zet of meet geen shellvariabelen zelf", () => {
  for (const file of kompasFiles) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/setProperty\(\s*["']--(header|nav)/.test(source), `${file} zet een shellvariabele`);
    assert.ok(!/--main-pad|--header-height/.test(source), `${file} rekent met een eigen headerhoogte`);
  }
});

test("de rondleiding leest de balken uit de elementen van de shell en volgt een meescrollende header", () => {
  const dom = read("src/lib/kompas/dom.ts");
  assert.match(dom, /\[data-sticky-header\]/);
  assert.match(dom, /\[data-main-nav\]/);
  assert.match(dom, /position === "fixed"/);
  assert.match(dom, /--vs-safe-area-bottom/);
});

test("de uitnodiging staat boven de gemeten onderbalk en gebruikt geen vaste hoogtes", () => {
  const offer = read("src/components/kompas/ContextOffer.tsx");
  assert.match(offer, /bottom-\[calc\(var\(--nav-height,/);
  assert.doesNotMatch(offer, /4\.75rem/);
  for (const file of kompasFiles.filter((f) => f.endsWith(".tsx"))) {
    assert.ok(!/!h-1[01]\b/.test(readFileSync(file, "utf8")), `${file}: vaste knophoogte`);
  }
});

test("Kompas-tekst en -knoppen volgen de reflow-regels (wrappen, min-hoogte, decoratieve beelden met px-minimum)", () => {
  const overlay = read("src/components/kompas/TourOverlay.tsx");
  assert.match(overlay, /flex-wrap/);
  assert.match(overlay, /maxHeight: layout\.card\.maxHeight/);
  for (const file of kompasFiles.filter((f) => f.endsWith(".tsx"))) {
    assert.ok(!/w-\[clamp\(\d+(\.\d+)?rem/.test(readFileSync(file, "utf8")), `${file}: rem-minimum voor decoratief beeld`);
  }
  assert.match(read("src/components/kompas/KompasEntryCard.tsx"), /min-h-\[4\.5rem\]/);
});

test("de integratie behoudt beide ankers op de contentkiezer en zijn minimumbreedte", () => {
  const switcher = read("src/components/ContentSwitcher.tsx");
  assert.match(switcher, /data-kompas-target="content-switcher"/);
  assert.match(switcher, /min-w-\[4\.5rem\]/);
});

test("CLAUDE.md schrijft zowel Kompas als de shell-layout voor", () => {
  const claude = read("CLAUDE.md");
  assert.match(claude, /## ⚠️ Harde regel: shell-layout, safe areas en tekstschaling/);
  assert.match(claude, /## Versado Kompas: uitleg, rondleidingen en begeleiding/);
  assert.match(claude, /docs\/LAYOUT\.md/);
  assert.match(claude, /docs\/KOMPAS\.md/);
  assert.match(claude, /test:kompas/);
  assert.match(claude, /scripts\/layout-audit/);
  assert.equal(read("AGENTS.md"), claude);
});
