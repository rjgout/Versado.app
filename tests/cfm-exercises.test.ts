import test from "node:test";
import assert from "node:assert/strict";
import { loadCfmLesson } from "../src/lib/studyContent/cfm2026Import";
import { CFM_SOURCES } from "../src/lib/studyContent/cfmSources";
import {
  preparedStudyQuestions,
  studyExercisePlan,
  validStudyQuestionSource,
  generateStudyQuestion,
} from "../src/lib/studyContent/exercisePlan";
import { isExerciseCorrect } from "../src/lib/exerciseGen";
import { isFocusRoute } from "../src/lib/focusMode";
import { classifyContentRoute } from "../src/lib/contentRouting";

test("alle jaargangen: bron ongewijzigd; alleen gecontroleerde gelezen citaten, drie per beschikbare stap", async () => {
  let available = 0;
  for (const volume of CFM_SOURCES)
    for (const item of volume.manifest.lessons) {
      const parsed = await loadCfmLesson(item.sourceKey, volume),
        lesson = {
          workKey: volume.manifest.workKey,
          sourceKey: item.sourceKey,
          language: volume.manifest.language,
          editionId: "test-" + volume.manifest.workKey,
          body: parsed.document,
        };
      const before = JSON.stringify(lesson.body),
        questions = preparedStudyQuestions(lesson),
        plan = studyExercisePlan(lesson, questions);
      assert.ok(plan);
      for (const part of plan.parts) {
        assert.ok(part.questions.length === 0 || part.questions.length === 3);
        if (part.questions.length === 3) available++;
      }
      assert.equal(plan.total, 18);
      assert.equal(JSON.stringify(lesson.body), before);
      assert.deepEqual(preparedStudyQuestions(lesson), questions);
      for (const q of questions) {
        assert.ok(validStudyQuestionSource(lesson, q.studySource));
        assert.equal(isExerciseCorrect(q.type, q.answers, q.answers), true);
        assert.ok(q.verseRef.length > 0);
      }
    }
  assert.equal(
    available,
    17,
    "geen stil verlies van gecontroleerde dekking en geen extra invulvarianten",
  );
});
test("alleen een verwijzing, andere taal/editie of gewijzigde citaattekst geeft geen vragen", async () => {
  const volume = CFM_SOURCES[1],
    parsed = await loadCfmLesson("01", volume),
    lesson = {
      workKey: volume.manifest.workKey,
      sourceKey: "01",
      language: "nl",
      editionId: "test",
      body: parsed.document,
    };
  const questions = preparedStudyQuestions(lesson);
  assert.equal(questions.length, 4);
  assert.equal(preparedStudyQuestions({ ...lesson, language: "en" }).length, 0);
  const changed = structuredClone(lesson);
  const block = changed.body.sections[0].blocks.find(
    (b) => b.id === questions[0].studySource.blockId,
  )!;
  if ("content" in block)
    block.content = block.content.map((v) =>
      v.type === "text"
        ? { ...v, text: "Alleen een verwijzing, geen schriftcitaat." }
        : v,
    );
  assert.equal(preparedStudyQuestions(changed).length, 0);
  assert.equal(
    validStudyQuestionSource(lesson, {
      ...questions[0].studySource,
      sourceUrl: questions[0].studySource.sourceUrl.replace("nld", "eng"),
    }),
    false,
  );
  assert.equal(
    validStudyQuestionSource(lesson, {
      ...questions[0].studySource,
      sourceUrl: "https://example.org/study/scriptures/nt/luke/1",
    }),
    false,
  );
});
test("de bestaande generator en antwoordcontrole bepalen ook woordbankvolgorde en waar/niet waar", () => {
  const proof = {
    blockId: "p",
    blockTextHash: "0".repeat(8),
    quote: "Nephi ging met zijn broeders naar Jeruzalem terug.",
    verseRef: "Synthetische controle",
    sourceUrl:
      "https://www.churchofjesuschrist.org/study/scriptures/bofm/1-ne/3?lang=nld&id=p1",
    seed: 0,
    type: "TRUE_FALSE" as const,
  };
  const q = generateStudyQuestion(proof, "nl");
  assert.ok(q);
  assert.equal(isExerciseCorrect(q.type, ["true"], q.answers), true);
  assert.equal(isExerciseCorrect(q.type, ["false"], q.answers), false);
  const bank = generateStudyQuestion({ ...proof, type: "WORD_BANK" }, "nl");
  assert.ok(bank);
  assert.equal(isExerciseCorrect(bank.type, bank.answers, bank.answers), true);
  assert.equal(
    isExerciseCorrect(bank.type, [...bank.answers].reverse(), bank.answers),
    false,
  );
  assert.equal(generateStudyQuestion(proof, "zz"), null);
});
test("vragenroute houdt focus-shell en centrale contentclassificatie", () => {
  const path = "/study-lesson/lesson-id/collection-id/vragen";
  assert.equal(isFocusRoute(path), true);
  assert.deepEqual(classifyContentRoute(path), {
    kind: "studyLesson",
    lessonId: "lesson-id",
    collectionId: "collection-id",
  });
});
