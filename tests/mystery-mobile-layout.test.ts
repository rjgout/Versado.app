import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const mysteryClient = readFileSync(path.join(process.cwd(), "src/components/mysteries/Mystery001aClient.tsx"), "utf8");

test("mobiele mystery-shell is viewportbreed en houdt de actiebalk buiten het scrollpane", () => {
  assert.match(css, /main:has\(\.mystery-game-layout\)/);
  assert.match(css, /max-width: none !important;/);
  assert.match(css, /padding: 1rem 0 0 !important;/);
  assert.match(css, /\.mystery-game-layout[\s\S]*?height: calc\(100svh - var\(--mystery-focus-header-height\) - 1rem\)/);
  assert.match(css, /\.mystery-action-bar[\s\S]*?padding-bottom: max\(0\.55rem, var\(--vs-safe-area-bottom\)\)/);
  assert.match(css, /\.mystery-character-pane[\s\S]*?overflow-y: auto/);
});

test("boardmaat gebruikt een stabiele viewport- en focusheader-reservering", () => {
  assert.match(css, /--mystery-focus-header-height: calc\(3\.3125rem \+ var\(--vs-safe-area-top\)\)/);
  const boardRule = css.match(/\.mystery-board-frame \{([\s\S]*?)\n  \}/);
  assert.ok(boardRule, "de gedeelde boardregel ontbreekt");
  assert.match(boardRule[1], /100svh/);
  assert.doesNotMatch(boardRule[1], /--header-height/);
  assert.match(boardRule[1], /--mystery-focus-header-height/);
});

test("resultaat toont de verhaalssamenvatting zonder zichtbare puzzelfictie-disclaimer", () => {
  assert.match(mysteryClient, /t\(definition\.story\.summaryKey\)/);
  assert.doesNotMatch(mysteryClient, /puzzleFictionDisclaimer/);
});
