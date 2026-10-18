import test from "node:test";
import assert from "node:assert/strict";
import { FSY_CATEGORY_KEYS, fsyLessonMetadata } from "../src/lib/fsyPresentation";
import { getT } from "../src/lib/i18n";

for (const [language, month] of [["nl", "mei 2026"], ["en", "May 2026"], ["de", "Mai 2026"], ["fr", "mai 2026"], ["es", "mayo de 2026"]]) {
  test(`FSY-categorieën en echte maand/jaar in ${language}, zonder technische fallback`, () => {
    const t = getT(language);
    for (const [category, key] of Object.entries(FSY_CATEGORY_KEYS)) {
      assert.equal(fsyLessonMetadata({year:2026,month:5,category},language,t), `${month} · ${t(key)}`);
      assert.notEqual(t(key), key);
      assert.notEqual(t(key), category);
    }
    for (const category of ["historical_unknown", "__proto__", "toString", null]) {
      assert.equal(fsyLessonMetadata({year:2026,month:5,category},language,t), `${month} · ${t("courseViews.fsy.lesson")}`);
    }
    assert.equal(fsyLessonMetadata({year:2026,month:null,category:"ACTIVITY"},language,t), `2026 · ${t("courseViews.fsy.activity")}`);
    assert.equal(fsyLessonMetadata({year:2026,month:13,category:"ACTIVITY"},language,t), `2026 · ${t("courseViews.fsy.activity")}`);
  });
}
