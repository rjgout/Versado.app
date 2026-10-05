import assert from "node:assert/strict";
import test from "node:test";
import { isFocusRoute } from "../src/lib/focusMode";

test("actieve leer- en spelroutes gebruiken focus mode", () => {
  assert.equal(isFocusRoute("/lesson/chapter-1"), true);
  assert.equal(isFocusRoute("/reading-lesson/step-1"), true);
  assert.equal(isFocusRoute("/word-search/game-1"), true);
  assert.equal(isFocusRoute("/scrabble/game-1"), true);
  assert.equal(isFocusRoute("/live/ABCD"), true);
  assert.equal(isFocusRoute("/word-game"), true);
  assert.equal(isFocusRoute("/jigsaw"), true);
  assert.equal(isFocusRoute("/alleskenner/alleen/run-1"), true);
  assert.equal(isFocusRoute("/snelle-zendeling/run/run-1"), true);
  assert.equal(isFocusRoute("/mysteries/001a/play"), true);
});

test("overzichtspagina's behouden de normale shell", () => {
  assert.equal(isFocusRoute("/courses"), false);
  assert.equal(isFocusRoute("/courses/course-1"), false);
  assert.equal(isFocusRoute("/live"), false);
  assert.equal(isFocusRoute("/word-search"), false);
  assert.equal(isFocusRoute("/friends"), false);
  assert.equal(isFocusRoute("/snelle-zendeling"), false);
  assert.equal(isFocusRoute("/mysteries/001a"), false);
});
