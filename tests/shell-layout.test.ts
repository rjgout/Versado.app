// De shell-layout (docs/LAYOUT.md): één positioneringsmodel voor de vaste
// bovenbalk, de onderbalk, safe areas, tekstschaling en het toetsenbord. Puur
// en op broncode-contracten; de echte weergave wordt met scripts/layout-audit
// in een browser gemeten.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { TALL_HEADER_RATIO, isEditableElement, isHeaderTall, isKeyboardOpen, isLargeText } from "../src/lib/shellMetrics";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const css = read("src/app/globals.css");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : /\.(tsx|ts)$/.test(file) ? [file] : [];
  });
}

test("een te grote header blijft niet vast staan", () => {
  assert.equal(isHeaderTall(64, 700), false);
  assert.equal(isHeaderTall(120, 700), false);
  assert.equal(isHeaderTall(Math.ceil(700 * TALL_HEADER_RATIO) + 1, 700), true);
  assert.equal(isHeaderTall(250, 568), true);
  assert.equal(isHeaderTall(100, 0), false);
});

test("grote tekst wordt herkend vanaf 140% en decoratieve beelden wijken dan", () => {
  assert.equal(isLargeText(1), false);
  assert.equal(isLargeText(1.25), false);
  assert.equal(isLargeText(1.4), true);
  assert.equal(isLargeText(2), true);
  assert.match(css, /html\[data-text-large\] \.vs-decor \{\s*display: none/);
  // Elk decoratief beeld naast tekst (rem-vrije clamp) draagt de klasse.
  for (const file of walk(path.join(root, "src"))) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (/aspect-square w-\[clamp\(\d+px/.test(line)) assert.ok(line.includes("vs-decor"), `${file}: mist vs-decor: ${line.trim().slice(0, 80)}`);
    }
  }
});

test("het toetsenbord wordt alleen herkend bij een tekstveld én een kleinere zichtbare hoogte", () => {
  const input = { tagName: "INPUT", type: "text" };
  assert.equal(isEditableElement(input), true);
  assert.equal(isEditableElement({ tagName: "input", type: "email" }), true);
  assert.equal(isEditableElement({ tagName: "TEXTAREA" }), true);
  assert.equal(isEditableElement({ tagName: "DIV", isContentEditable: true }), true);
  for (const type of ["checkbox", "radio", "button", "submit", "range"]) assert.equal(isEditableElement({ tagName: "INPUT", type }), false, type);
  assert.equal(isEditableElement({ tagName: "INPUT", type: "text", readOnly: true }), false);
  assert.equal(isEditableElement({ tagName: "BUTTON" }), false);
  assert.equal(isEditableElement(null), false);
  assert.equal(isKeyboardOpen({ editableFocused: true, visibleHeight: 400, maxHeight: 800 }), true);
  // Een inklappende adresbalk zonder tekstveld is geen toetsenbord.
  assert.equal(isKeyboardOpen({ editableFocused: false, visibleHeight: 400, maxHeight: 800 }), false);
  assert.equal(isKeyboardOpen({ editableFocused: true, visibleHeight: 760, maxHeight: 800 }), false);
});

test("alle schermen gebruiken één positioneringsmodel voor de bovenbalk: fixed, nooit sticky op de wrapper", () => {
  assert.match(read("src/components/StickyHeader.tsx"), /fixed top-0 inset-x-0/);
  assert.doesNotMatch(css, /\[data-shell-mode="focus"\] \[data-sticky-header\] \{\s*position: sticky/);
  // Focus mode houdt ruimte voor de terugbalk via dezelfde variabelen als de gewone shell.
  assert.match(css, /\[data-shell-mode="focus"\] main \{[^}]*padding-top: var\(--main-pad-top\)/);
  // Een vast hoogteblok maakte van body het omvattende blok van alles wat sticky is.
  assert.doesNotMatch(css, /html,\s*body \{\s*height: 100%/);
  assert.match(css, /body \{\s*\/\*[\s\S]*?min-height: 100%/);
});

test("de shell-maten komen uit één meetplek en de sticky/fixed-gebruikers rekenen met --header-offset", () => {
  const metrics = read("src/components/shell/ShellMetrics.tsx");
  for (const name of ["--header-height", "--header-offset", "--nav-height", "data-header-tall", "data-keyboard"]) assert.ok(metrics.includes(name), name);
  const files = walk(path.join(root, "src")).filter((file) => !file.endsWith("ShellMetrics.tsx"));
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // Niemand anders zet of meet de shellmaten.
    assert.ok(!/style\.setProperty\(\s*["']--(header-height|header-offset|nav-height)/.test(source), `${file} zet een shell-variabele`);
    // Iets dat tegen de bovenbalk plakt gebruikt --header-offset, niet --header-height.
    for (const line of source.split("\n")) {
      if (/\b(sticky|fixed)\b/.test(line) && /top-\[[^\]]*--header-height/.test(line)) assert.fail(`${file}: plakt aan --header-height in plaats van --header-offset: ${line.trim().slice(0, 90)}`);
    }
  }
  assert.match(css, /html\[data-header-tall\] \[data-sticky-header\] \{\s*position: absolute/);
});

test("vaste delen kunnen niet breder worden dan het scherm en respecteren safe areas aan alle kanten", () => {
  assert.match(css, /\[data-sticky-header\],\s*\[data-main-nav\] \{[^}]*overflow-x: clip/);
  assert.match(css, /padding-left: var\(--vs-safe-area-left\)/);
  assert.match(css, /padding-right: var\(--vs-safe-area-right\)/);
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /pl-\[max\(1rem,var\(--vs-safe-area-left\)\)\]/);
  assert.match(layout, /pr-\[max\(1rem,var\(--vs-safe-area-right\)\)\]/);
  // De header heeft geen vaste hoogte en mag over meerdere regels lopen.
  assert.match(layout, /min-h-14[^"]*flex-wrap/);
  assert.doesNotMatch(layout, /<div className="relative mx-auto flex h-14/);
});

test("de onderbalk is fluïde en schaalt met de tekst", () => {
  const nav = read("src/components/BottomNav.tsx");
  assert.match(nav, /fixed bottom-0 inset-x-0/);
  assert.match(nav, /text-\[0\.6875rem\]/);
  assert.doesNotMatch(nav, /text-\[11px\]/);
  assert.match(nav, /min-w-0/);
  assert.match(nav, /vs-wrap/);
  assert.match(css, /html\[data-keyboard\] \[data-main-nav\] \{\s*display: none/);
});

test("de ruimte onder de pagina volgt de gemeten onderbalk, met een standaardwaarde vóór de meting", () => {
  assert.match(css, /--main-pad-bottom: calc\(var\(--nav-height, calc\(var\(--nav-default\) \+ var\(--vs-safe-area-bottom\)\)\) \+ 1\.5rem\)/);
  assert.match(css, /--header-default:/);
});

test("viewport: zoomen blijft toegestaan en tekst wordt niet vastgezet", () => {
  const layout = read("src/app/layout.tsx");
  assert.doesNotMatch(layout, /maximumScale|userScalable|maximum-scale|user-scalable/);
  assert.match(layout, /viewportFit: "cover"/);
  assert.match(css, /text-size-adjust: 100%/);
});

test("de bestaande shellmodi blijven: immersive zonder balken, focus zonder header en onderbalk", () => {
  assert.match(css, /\[data-shell-mode="focus"\] \[data-app-global-header\],\s*\[data-shell-mode="focus"\] nav\[data-main-nav\] \{\s*display: none/);
  assert.match(css, /\[data-shell-mode="immersive"\] \[data-sticky-header\],\s*\[data-shell-mode="immersive"\] nav\[data-main-nav\] \{\s*display: none/);
});

test("Capacitor: toetsenbord en systeembalken lopen via de centrale variabelen", () => {
  const config = read("capacitor.config.ts");
  assert.match(config, /Keyboard:/);
  assert.match(config, /insetsHandling: "css"/);
  assert.match(css, /--vs-safe-area-bottom: max\(env\(safe-area-inset-bottom, 0px\), var\(--safe-area-inset-bottom, 0px\)\)/);
});
