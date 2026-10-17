import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const reader = read("src/components/LessonFlow.tsx");
const player = read("src/components/ReadAloudPlayer.tsx");
const actions = read("src/components/annotations/AnnotationActions.tsx");
const readerView = reader.slice(reader.indexOf("export function ReaderView"), reader.indexOf("function formatCorrectAnswer"));

test("de verslezer heeft geen aparte actierij of puntjesknop per vers", () => {
  assert.doesNotMatch(readerView, /<AnnotationTrigger/);
  assert.doesNotMatch(readerView, /flex flex-col gap-4/);
  assert.match(readerView, /aria-label=\{t\("annotations\.verseActions"/);
});

test("tikken is beveiligd tegen selectie, slepen en preview", () => {
  assert.match(readerView, /onClick=\{preview \? undefined : \(event\) => tapVerse/);
  assert.match(readerView, /hadSelection/);
  assert.match(readerView, /Math\.hypot/);
  assert.match(readerView, /closest\("button, a, input, textarea, select"\)/);
  assert.match(readerView, /event\.stopPropagation\(\)/);
});

test("voorlezen vanaf een vers gebruikt de taal- en bronkeuze van ReadAloudPlayer", () => {
  assert.match(player, /startAtVerse\(number\)/);
  assert.match(player, /spokenVerses\.findIndex\(\(verse\) => verse\.number === number\)/);
  assert.match(player, /audio: selectedAudio, language: selectedLanguage/);
  assert.doesNotMatch(readerView, /useReadAloudPlayer\(\)\.start|\bstart\(\{/);
  assert.match(readerView, /audio=\{audioFor\(annotationTarget\.verseId\)\}/);
});

test("de audioactie staat bovenaan het bestaande menu en alleen waar een bron is", () => {
  assert.ok(actions.indexOf("data-annotation-read-aloud") < actions.indexOf('t(\n            active("bookmark")'));
  assert.match(actions, /disabled=\{!audio\.ready\}/);
  assert.doesNotMatch(read("src/components/annotations/StudyAnnotations.tsx"), /audio=/);
});
