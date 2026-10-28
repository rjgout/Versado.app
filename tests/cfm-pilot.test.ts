import test from "node:test";
import assert from "node:assert/strict";
import { CFM_SOURCES } from "../src/lib/studyContent/cfmSources";
import { loadCfmLesson } from "../src/lib/studyContent/cfm2026Import";
import {
  preparedStudyQuestions,
  studyExercisePlan,
  validStudyQuestionSource,
} from "../src/lib/studyContent/exercisePlan";
import { pilotReadingSelections } from "../src/lib/studyContent/pilotReadings";
import { snapshotPilotReadings } from "../scripts/study-content/cfm-pilot-snapshot";
import { isExerciseCorrect, normalizeAnswer } from "../src/lib/exerciseGen";
import { restoreExerciseCheckpoint } from "../src/lib/learning/exerciseCheckpoint";
async function pilot() {
  const volume = CFM_SOURCES[0],
    parsed = await loadCfmLesson("02", volume);
  const lesson = {
    workKey: volume.manifest.workKey,
    sourceKey: "02",
    editionKey: volume.manifest.editionKey,
    language: "nl",
    editionId: "stable-pilot-proof",
    body: parsed.document,
  };
  return { ...lesson, scriptureReadings: snapshotPilotReadings(lesson) };
}

test("officiële pilot: zes maal drie, vijftien uniek aangeboden verzen, letterlijke vragen en stabiele bestaande stap-1-identiteiten", async () => {
  const lesson = await pilot(),
    before = JSON.stringify(lesson.body),
    questions = preparedStudyQuestions(lesson),
    plan = studyExercisePlan(lesson, questions)!;
  assert.deepEqual(
    plan.parts.map((p) => p.questions.length),
    [3, 3, 3, 3, 3, 3],
  );
  assert.equal(
    new Set(plan.parts.flatMap((p) => p.questions.map((q) => q.id))).size,
    18,
  );
  assert.equal(lesson.scriptureReadings.flatMap((r) => r.verses).length, 15);
  assert.equal(
    new Set(
      lesson.scriptureReadings.flatMap((r) =>
        r.verses.map((v) => `${r.bookKey}:${r.chapter}:${v.number}`),
      ),
    ).size,
    15,
  );
  const old = studyExercisePlan(
    { ...lesson, scriptureReadings: [] },
    preparedStudyQuestions({ ...lesson, scriptureReadings: [] }),
  )!;
  assert.deepEqual(
    plan.parts[0].questions.map((q) => q.id),
    old.parts[0].questions.map((q) => q.id),
  );
  const wanted = [
    "zoon",
    "vol genade en waarheid",
    "satan",
    "almachtige",
    "toon ik u mozes",
    "heerlijkheid",
    "zoon",
    "de gelijkenis van mijn",
    "onderscheid",
    "kracht",
    "naam van de eniggeborene",
    "uitverkoren",
    "onsterfelijkheid",
    "zullen een aarde maken",
    "beproeven",
  ];
  const linked = questions.filter((q) => q.studySource.scripture);
  assert.equal(linked.length, 15);
  assert.deepEqual(
    linked.map((q) => q.answers.join(" ")),
    wanted,
  );
  for (const q of questions) {
    assert.ok(validStudyQuestionSource(lesson, q.studySource));
    const rebuilt =
      q.type === "FILL_BLANK"
        ? q.prompt.replace("____", q.answers[0])
        : q.type === "WORD_BANK"
          ? q.prompt.replace(/\[(?:____\s*)+\]/, q.answers.join(" "))
          : q.prompt;
    assert.equal(
      normalizeAnswer(rebuilt),
      normalizeAnswer(q.studySource.quote),
    );
    assert.equal(isExerciseCorrect(q.type, q.answers, q.answers), true);
    assert.equal(
      isExerciseCorrect(q.type, ["ongeldig-controleantwoord"], q.answers),
      false,
    );
    if (q.options)
      assert.equal(
        q.options.filter((o) => isExerciseCorrect(q.type, [o], q.answers))
          .length,
        1,
      );
  }
  assert.equal(JSON.stringify(lesson.body), before);
  assert.equal(
    studyExercisePlan(lesson, structuredClone(questions))!.fingerprint,
    plan.fingerprint,
  );
});

test("alle jaargangen: alleen 2026/02 groeit; 22 van 624 brongebonden stappen en één volledige week bij beschikbare PGP-teksten", async () => {
  let ready = 0,
    weeks = 0,
    total = 0;
  for (const volume of CFM_SOURCES)
    for (const item of volume.manifest.lessons) {
      const parsed = await loadCfmLesson(item.sourceKey, volume),
        lesson = {
          workKey: volume.manifest.workKey,
          sourceKey: item.sourceKey,
          editionKey: volume.manifest.editionKey,
          language: volume.manifest.language,
          editionId: "coverage-" + volume.manifest.workKey,
          body: parsed.document,
        };
      const readings = snapshotPilotReadings(lesson),
        enriched = { ...lesson, scriptureReadings: readings },
        plan = studyExercisePlan(enriched, preparedStudyQuestions(enriched))!;
      total += plan.parts.length;
      ready += plan.parts.filter((p) => p.questions.length === 3).length;
      weeks += Number(plan.parts.every((p) => p.questions.length === 3));
      if (
        lesson.workKey !== "cfm-old-testament-2026" ||
        lesson.sourceKey !== "02"
      )
        assert.equal(readings.length, 0);
    }
  assert.equal(total, 624);
  assert.equal(ready, 22);
  assert.equal(weeks, 1);
});

test("bronverbreding blijft strikt op week, taal, editie, staptekst, verwijzing en werkelijk aangeboden vers gebonden", async () => {
  const lesson = await pilot();
  for (const changed of [
    { ...lesson, language: "en" },
    { ...lesson, editionKey: "andere-uitgave" },
    { ...lesson, sourceKey: "03" },
    { ...lesson, workKey: "cfm-new-testament-2027" },
  ])
    assert.equal(pilotReadingSelections(changed).length, 0);
  const q = preparedStudyQuestions(lesson).find(
    (q) => q.studySource.scripture,
  )!;
  assert.ok(q.studySource.scripture);
  assert.equal(
    validStudyQuestionSource(
      { ...lesson, scriptureReadings: [] },
      q.studySource,
    ),
    false,
  );
  assert.equal(
    validStudyQuestionSource(lesson, {
      ...q.studySource,
      quote: q.studySource.quote + " Ongelezen toevoeging.",
    }),
    false,
  );
  assert.equal(
    validStudyQuestionSource(lesson, {
      ...q.studySource,
      seed: q.studySource.seed + 1,
    }),
    false,
  );
  assert.equal(
    validStudyQuestionSource(lesson, {
      ...q.studySource,
      scripture: { ...q.studySource.scripture, verse: 42 },
    }),
    false,
  );
  assert.equal(
    validStudyQuestionSource(lesson, {
      ...q.studySource,
      scripture: { ...q.studySource.scripture, chapterHash: "0".repeat(64) },
    }),
    false,
  );
  const changed = structuredClone(lesson),
    block = changed.body.sections
      .flatMap((s) => s.blocks)
      .find((b) => b.id === "b-p3")!;
  function alter(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(alter);
      return;
    }
    const x = value as Record<string, unknown>;
    if (x.type === "reference" && x.target && typeof x.target === "object") {
      const t = x.target as Record<string, unknown>;
      t.externalUrl =
        "https://www.churchofjesuschrist.org/study/scriptures/pgp/moses/2?lang=nld";
    } else Object.values(x).forEach(alter);
  }
  alter(block);
  assert.equal(
    pilotReadingSelections(changed).filter((q) => q.stepIndex === 2).length,
    0,
  );
  assert.equal(
    studyExercisePlan(
      { ...lesson, scriptureReadings: [] },
      preparedStudyQuestions({ ...lesson, scriptureReadings: [] }),
    )!.parts.filter((p) => p.questions.length === 3).length,
    1,
  );
});

test("hervatten accepteert alleen een begrensd checkpoint van exact de uitgegeven vraagvolgorde", () => {
  const ids = ["a", "b", "c"],
    first = { exerciseId: "a", given: ["antwoord"], correct: true };
  const valid = {
    index: 1,
    answers: [first],
    reviewQueue: null,
    reviewPos: 0,
    pending: null,
  };
  assert.deepEqual(restoreExerciseCheckpoint(valid, ids), valid);
  for (const invalid of [
    { ...valid, index: 3 },
    { ...valid, answers: [{ ...first, exerciseId: "vreemd" }] },
    { ...valid, index: 0 },
    { ...valid, reviewQueue: ["vreemd"] },
    { ...valid, pending: [first] },
  ])
    assert.equal(restoreExerciseCheckpoint(invalid, ids), null);
  const completed = ids.map((exerciseId) => ({ ...first, exerciseId }));
  assert.ok(
    restoreExerciseCheckpoint(
      {
        index: 2,
        answers: completed,
        reviewQueue: ["b"],
        reviewPos: 0,
        pending: null,
      },
      ids,
    ),
  );
  assert.ok(
    restoreExerciseCheckpoint(
      {
        index: 2,
        answers: completed,
        reviewQueue: null,
        reviewPos: 0,
        pending: completed,
      },
      ids,
    ),
  );
});
