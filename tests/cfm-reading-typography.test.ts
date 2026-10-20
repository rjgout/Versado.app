import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regressie: een schriftverwijzing (knop = inline-block) met een minimale hoogte rekt de regel op en geeft grote gaten
// midden in een alinea. De regelafstand staat op de container, niet per blok.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("schriftverwijzing in lopende tekst heeft geen minimale hoogte", () => {
  const source = read("src/components/study/ReferenceLink.tsx");
  assert.doesNotMatch(source, /min-h-(?!0\b)\d+/);
  assert.match(source, /min-h-0/);
});

test("compacte studietekst gebruikt één regelafstand op de container", () => {
  const source = read("src/components/study/RichContentBlocks.tsx");
  assert.match(source, /leading-\[1\.6\]/);
  assert.doesNotMatch(source, /leading-7/);
});

test("de studieles heeft geen leeswijzeswitcher en geen permanente annotatieknop", () => {
  for (const file of ["StudyReader", "StepOverview"]) assert.doesNotMatch(read(`src/components/study/${file}.tsx`), /ModeSwitch/);
  assert.match(read("src/components/annotations/StudyAnnotations.tsx"), /\(!compact \|\| pickMode\)/);
});
