import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const reader = read("src/components/LessonFlow.tsx");
const player = read("src/components/ReadAloudPlayer.tsx");
const actions = read("src/components/annotations/AnnotationActionsView.tsx");
const menu = read("src/components/annotations/useVerseAnnotationMenu.tsx");
const readerView = reader.slice(reader.indexOf("export function ReaderView"), reader.indexOf("function formatCorrectAnswer"));

test("de verslezer heeft geen aparte actierij of puntjesknop per vers", () => {
  assert.doesNotMatch(readerView, /<AnnotationTrigger/);
  assert.doesNotMatch(readerView, /flex flex-col gap-4/);
  assert.match(menu, /aria-label=\{t\("annotations\.verseActions"/);
});

test("tikken is beveiligd tegen selectie, slepen en preview", () => {
  assert.match(readerView, /useVerseAnnotationMenu\(!preview,colorForVerse\)/);
  assert.match(menu, /onVerseClick:enabled\?tapVerse:undefined/);
  assert.match(read("src/components/reading/ScriptureReaderView.tsx"), /onClick=\{\s*onVerseClick\s*\?\s*\(?event\)?\s*=>\s*onVerseClick\(event,\s*v.id\)/);
  assert.match(menu, /hadSelection/);
  assert.match(menu, /Math\.hypot/);
  assert.match(menu, /closest\("button, a, input, textarea, select"\)/);
  assert.match(menu, /event\.stopPropagation\(\)/);
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
  assert.match(actions, /disabled=\{audio\.status !== "ready" \|\| busy \|\| uncertain\}/);
  assert.doesNotMatch(read("src/components/annotations/StudyAnnotations.tsx"), /audio=/);
});

test("een mislukte audiotaalopvraag is een eigen status, geen gereed", () => {
  assert.match(player, /editions\?\.id === sourceId \? "ready" : failed \? "error" : "loading"/);
  assert.match(player, /if \(status !== "ready"\) return false/);
  assert.match(actions, /annotations\.audioFailed/);
});

test("een onopgeslagen notitie beschermt de audioactie", () => {
  assert.match(actions, /function startAudio\(\)/);
  assert.match(actions, /setAudioPending\(true\)/);
  assert.match(actions, /onClick=\{confirmDiscard\}/);
  assert.match(actions, /busy \|\| lock\.current \|\| uncertain\) \{\n\s+setDiscard\(false\)/);
});
