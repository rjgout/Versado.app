import test from "node:test";
import assert from "node:assert/strict";
import { courseTypeMatchesContent } from "../src/lib/courseContent";

test("CFM-leeswijzen horen uitsluitend bij CFM-content", () => {
  for (const type of ["STUDY_STEPS", "STUDY_FREE"]) {
    for (const work of ["bofm", "old-testament", "new-testament", "fsy", "podcasts", null]) assert.equal(courseTypeMatchesContent(type, work), false);
    for (const work of ["cfm-old-testament-2026", "cfm-new-testament-2027", "synthetic-study-cfm-test"]) assert.equal(courseTypeMatchesContent(type, work), true);
  }
  for (const type of ["FREE_CHOICE", "READING_LESSONS", "FRONT_TO_BACK", "PODCAST", "FSY", "KIDS", "INTRO"]) assert.equal(courseTypeMatchesContent(type, "bofm"), true);
});
