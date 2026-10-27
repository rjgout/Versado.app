import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { officialPilotFixture } from "./fixtures/cfm-exercises.mjs";
import { referenceAccount } from "./fixtures/reference-content.mjs";
import {
  issueStudyExerciseSession,
  resumeStudyExerciseSession,
  submitStudyExerciseSession,
  resetReadingProgress,
  type IssuedStudySet,
} from "../src/lib/learning/contentProgress";
import { loadStudyExerciseSource } from "../src/lib/studyContent/exerciseSource";
import { getStudyReader } from "../src/lib/studyContent/reader";
import { personalStudyFor } from "../src/lib/studyContent/personalStudyOverrides";
import { applyStepProgress } from "../src/lib/studyContent/stepProgress";
import {
  maxContentBaseXp,
  XP_PER_CORRECT,
  COMPLETION_BONUS,
} from "../src/lib/learning/rewards";
import { applyRepeatDiscount } from "../src/lib/xpRules";
import { countCanonicalReadContributions } from "../src/lib/dorp/growth";
import { mutateAnnotation } from "../src/lib/annotations/service";
import { passageBlocks } from "../src/lib/annotations/contract";
import {
  canonicalJson,
  appendStudyRevision,
} from "../src/lib/studyContent/revisions";
let f: Awaited<ReturnType<typeof officialPilotFixture>>;
before(async () => {
  f = await officialPilotFixture({ scriptures: false });
});
after(() => prisma.$disconnect());
const account = async () => (await referenceAccount()).actor;
const input = (stepIndex: number | null = null) => ({
  editionId: f.edition.id,
  revisionId: f.revision.id,
  stepIndex,
});
async function issue(
  actor: Awaited<ReturnType<typeof account>>,
  stepIndex: number | null = null,
) {
  const s = await issueStudyExerciseSession(actor, input(stepIndex));
  assert.ok(s);
  return s;
}
async function answers(s: IssuedStudySet, wrong = 0) {
  const rows = await prisma.exercise.findMany({
    where: { id: { in: s.exercises.map((q) => q.id) } },
  });
  return s.exercises.map((q, i) => ({
    exerciseId: q.id,
    given:
      i < wrong
        ? ["onjuist-controleantwoord"]
        : (JSON.parse(rows.find((r) => r.id === q.id)!.answers) as string[]),
  }));
}
const locked = (error: unknown) =>
  error instanceof Error && error.message === "LOCKED";

test("pilotvrijgave behoudt reeds verdiende stap-1-credits; extra vragen komen uitsluitend bij echte, toegankelijke PGP-tekst", async () => {
  const actor = await account();
  const existing = await prisma.contentCollection.findFirst({
    where: { work: "pgp", editionKey: "pgp", language: "nl" },
  });
  if (existing)
    await prisma.contentCollection.update({
      where: { id: existing.id },
      data: { visibleToUsers: false },
    });
  const before = await getStudyReader(actor, f.lesson.id, f.key);
  assert.ok(before);
  assert.deepEqual(before.exerciseCounts, [3, 0, 0, 0, 0, 0]);
  assert.deepEqual(before.scriptureReadings, []);
  const old = await issue(actor, 1),
    oldIds = old.exercises.map((q) => q.id);
  const first = await submitStudyExerciseSession(
    actor,
    old.sessionId,
    await answers(old),
  );
  assert.equal(first.baseXp, 3 * XP_PER_CORRECT);
  assert.equal(first.bonusXp, 0);
  f = await officialPilotFixture();
  const after = await getStudyReader(actor, f.lesson.id, f.key);
  assert.ok(after);
  assert.deepEqual(after.exerciseCounts, [3, 3, 3, 3, 3, 3]);
  assert.equal(after.scriptureReadings!.flatMap((r) => r.verses).length, 15);
  assert.equal(
    canonicalJson(after.lesson.body),
    canonicalJson(before.lesson.body),
  );
  assert.deepEqual(
    (await issue(actor, 1)).exercises.map((q) => q.id),
    oldIds,
  );
  const full = await issue(actor),
    result = await submitStudyExerciseSession(
      actor,
      full.sessionId,
      await answers(full),
    );
  assert.equal(result.baseXp, 15 * XP_PER_CORRECT);
  assert.equal(result.bonusXp, COMPLETION_BONUS);
  assert.equal(
    first.baseXp + result.baseXp + result.bonusXp,
    maxContentBaseXp(18),
  );
  assert.equal(
    await prisma.contentExerciseCredit.count({ where: { userId: actor.id } }),
    18,
  );
});

test("echte officiële week: alle zes stappen krijgen exact hun aangeboden verzen en dezelfde achttien vraag-ID's als de weekroute", async () => {
  const actor = await account(),
    dto = await getStudyReader(actor, f.lesson.id, f.key);
  assert.ok(dto);
  const full = await issue(actor);
  assert.equal(full.exercises.length, 18);
  assert.deepEqual(
    full.groups.map((g) => g.count),
    [3, 3, 3, 3, 3, 3],
  );
  const ids: string[] = [];
  for (let step = 1; step <= 6; step++) {
    const part = await issue(actor, step);
    assert.equal(part.exercises.length, 3);
    ids.push(...part.exercises.map((q) => q.id));
    for (const q of part.exercises) {
      assert.equal("answers" in q, false);
      const row = await prisma.exercise.findUniqueOrThrow({
          where: { id: q.id },
        }),
        proof = row.studySource as {
          quote: string;
          scripture?: { bookKey: string; chapter: number; verse: number };
        };
      if (step === 1)
        assert.ok(canonicalJson(dto.lesson.body).includes(proof.quote));
      else {
        const verses: Array<{
          bookKey: string;
          chapter: number;
          number: number;
          text: string;
        }> = dto
          .scriptureReadings!.filter((r) => r.stepIndex === step)
          .flatMap((r) =>
            r.verses.map((v) => ({
              bookKey: r.bookKey,
              chapter: r.chapter,
              ...v,
            })),
          );
        assert.equal(verses.length, 3);
        assert.ok(
          verses.some(
            (v) =>
              v.bookKey === proof.scripture!.bookKey &&
              v.chapter === proof.scripture!.chapter &&
              v.number === proof.scripture!.verse &&
              v.text === proof.quote,
          ),
        );
      }
    }
  }
  assert.deepEqual(
    ids,
    full.exercises.map((q) => q.id),
  );
  const again = await issue(actor);
  assert.deepEqual(again.exercises, full.exercises);
});

test("zes echte stappen gevolgd door de week: één basisgrens, één perfecte bonus en normale herhalingskorting", async () => {
  const actor = await account();
  let base = 0,
    bonus = 0;
  for (let step = 1; step <= 6; step++) {
    const s = await issue(actor, step),
      r = await submitStudyExerciseSession(
        actor,
        s.sessionId,
        await answers(s),
      );
    base += r.baseXp;
    bonus += r.bonusXp;
    assert.equal(r.repeatXp, 0);
  }
  assert.equal(base, 18 * XP_PER_CORRECT);
  assert.equal(bonus, COMPLETION_BONUS);
  const repeat = await issue(actor),
    r = await submitStudyExerciseSession(
      actor,
      repeat.sessionId,
      await answers(repeat),
    );
  assert.equal(r.baseXp + r.bonusXp, 0);
  assert.equal(r.repeatXp, applyRepeatDiscount(18 * XP_PER_CORRECT));
  assert.equal(
    await prisma.studyStepProgress.count({
      where: { userId: actor.id, status: "COMPLETED" },
    }),
    6,
  );
  assert.equal(
    await prisma.contentProgress.count({ where: { userId: actor.id } }),
    1,
  );
  assert.equal(await countCanonicalReadContributions(prisma, [actor.id]), 0);
  assert.equal(
    await prisma.chapterProgress.count({ where: { userId: actor.id } }),
    0,
  );
});

test("echte week gevolgd door stappen: eerdere goede antwoorden krijgen geen tweede basis- of bonus-XP", async () => {
  const actor = await account(),
    full = await issue(actor),
    first = await submitStudyExerciseSession(
      actor,
      full.sessionId,
      await answers(full),
    );
  assert.equal(first.baseXp + first.bonusXp, maxContentBaseXp(18));
  for (let step = 1; step <= 6; step++) {
    const s = await issue(actor, step),
      r = await submitStudyExerciseSession(
        actor,
        s.sessionId,
        await answers(s),
      );
    assert.equal(r.baseXp + r.bonusXp, 0);
    assert.equal(r.repeatXp, applyRepeatDiscount(3 * XP_PER_CORRECT));
  }
  assert.equal(
    await prisma.contentExerciseCredit.count({ where: { userId: actor.id } }),
    18,
  );
});

test("foutieve echte week later verbeteren betaalt uitsluitend de ontbrekende basis en eenmalige perfecte bonus", async () => {
  const actor = await account(),
    full = await issue(actor),
    first = await submitStudyExerciseSession(
      actor,
      full.sessionId,
      await answers(full, 4),
    );
  assert.equal(first.baseXp, 14 * XP_PER_CORRECT);
  assert.equal(first.bonusXp, 0);
  const improved = await issue(actor),
    second = await submitStudyExerciseSession(
      actor,
      improved.sessionId,
      await answers(improved),
    );
  assert.equal(second.baseXp, 4 * XP_PER_CORRECT);
  assert.equal(second.bonusXp, COMPLETION_BONUS);
  assert.equal(second.repeatXp, 0);
  const third = await issue(actor),
    repeat = await submitStudyExerciseSession(
      actor,
      third.sessionId,
      await answers(third),
    );
  assert.equal(repeat.baseXp + repeat.bonusXp, 0);
  assert.equal(repeat.repeatXp, applyRepeatDiscount(18 * XP_PER_CORRECT));
});

test("gelijktijdige sessies, dubbele submit en verloren response: echte pilot behoudt één basisgrens en een hervatbaar resultaat", async () => {
  const actor = await account(),
    one = await issue(actor),
    two = await issue(actor);
  const results = await Promise.all([
    submitStudyExerciseSession(actor, one.sessionId, await answers(one)),
    submitStudyExerciseSession(actor, two.sessionId, await answers(two)),
  ]);
  assert.equal(
    results.reduce((n, r) => n + r.baseXp + r.bonusXp, 0),
    maxContentBaseXp(18),
  );
  const count = await prisma.xPTransaction.count({
    where: { userId: actor.id },
  });
  const recovered = await resumeStudyExerciseSession(actor, {
    sessionId: one.sessionId,
    ...input(),
  });
  assert.ok(recovered.result);
  assert.equal(recovered.issued.sessionId, one.sessionId);
  const replay = await submitStudyExerciseSession(
    actor,
    one.sessionId,
    await answers(one),
  );
  assert.equal(replay.replayed, true);
  assert.equal(
    await prisma.xPTransaction.count({ where: { userId: actor.id } }),
    count,
  );
  const other = await account();
  await assert.rejects(
    resumeStudyExerciseSession(other, { sessionId: one.sessionId, ...input() }),
  );
  await assert.rejects(
    resumeStudyExerciseSession(actor, {
      sessionId: one.sessionId,
      ...input(1),
    }),
  );
  const open = await issue(actor, 3);
  const restored = await resumeStudyExerciseSession(actor, {
    sessionId: open.sessionId,
    ...input(3),
  });
  assert.deepEqual(restored.issued, open);
  assert.equal(restored.result, null);
});

test("annotaties, privénotities, bladwijzers, leespositie, oude leesvinkjes, cursusinschrijving en Dorp blijven behouden", async () => {
  const actor = await account(),
    source = await loadStudyExerciseSource(actor, f.edition.id, prisma);
  assert.ok(source);
  const section = source.lesson.body.sections[0],
    block = passageBlocks(source.lesson.body, section.id).find(
      (b) => b.id === "b-p1",
    )!;
  const target = {
    type: "lesson",
    lessonEditionId: f.edition.id,
    revisionId: f.revision.id,
    selector: {
      normalizationVersion: 1,
      originalRevisionId: f.revision.id,
      sectionAnchor: section.id,
      ranges: [{ blockId: block.id, start: 0, end: [...block.text].length }],
      exact: block.text,
      prefix: "",
      suffix: "",
    },
  };
  for (const kind of ["bookmark", "highlight", "note"]) {
    await mutateAnnotation(actor, {
      kind,
      target,
      expectedVersion: 0,
      actionId: randomUUID(),
      ...(kind === "note"
        ? { text: "Ongewijzigde privénotitie" }
        : kind === "highlight"
          ? { color: "blue" }
          : {}),
    });
  }
  const annotations = async () => ({
    bookmarks: await prisma.bookmark.findMany({ where: { userId: actor.id } }),
    highlights: await prisma.highlight.findMany({
      where: { userId: actor.id },
    }),
    notes: await prisma.note.findMany({ where: { userId: actor.id } }),
  });
  const before = await annotations();
  await prisma.readingPosition.create({
    data: {
      userId: actor.id,
      lessonEditionId: f.edition.id,
      revisionId: f.revision.id,
      sectionAnchor: section.id,
      blockAnchor: block.id,
      sectionFraction: 0.2,
      quoteContext: block.text.slice(0, 30),
      lastActionId: randomUUID(),
      lastActionHash: "a".repeat(64),
    },
  });
  const position = await prisma.readingPosition.findUniqueOrThrow({
    where: {
      userId_lessonEditionId: {
        userId: actor.id,
        lessonEditionId: f.edition.id,
      },
    },
  });
  const course = await prisma.course.findFirst();
  if (course)
    await prisma.userCourseProgress.create({
      data: {
        userId: actor.id,
        courseId: course.id,
        subscribed: true,
        comboCount: 2,
      },
    });
  const enrollment = await prisma.userCourseProgress.findMany({
    where: { userId: actor.id },
  });
  await prisma.contentProgress.create({
    data: {
      userId: actor.id,
      contentKey: source.contentKey,
      readStatus: "READ",
    },
  });
  const plan = personalStudyFor(source.lesson);
  assert.ok(plan.supported);
  await prisma.$transaction((tx) =>
    applyStepProgress(tx, actor.id, {
      lessonEditionId: f.edition.id,
      revisionId: f.revision.id,
      step: plan.steps[2],
      action: "COMPLETE",
    }),
  );
  const s = await issue(actor);
  await submitStudyExerciseSession(actor, s.sessionId, await answers(s));
  assert.deepEqual(await annotations(), before);
  assert.deepEqual(
    await prisma.readingPosition.findUniqueOrThrow({
      where: {
        userId_lessonEditionId: {
          userId: actor.id,
          lessonEditionId: f.edition.id,
        },
      },
    }),
    position,
  );
  assert.deepEqual(
    await prisma.userCourseProgress.findMany({ where: { userId: actor.id } }),
    enrollment,
  );
  await prisma.$transaction((tx) => resetReadingProgress(tx, actor.id));
  assert.equal(
    await prisma.studyStepProgress.count({
      where: { userId: actor.id, status: "COMPLETED" },
    }),
    6,
  );
  const repeat = await issue(actor),
    r = await submitStudyExerciseSession(
      actor,
      repeat.sessionId,
      await answers(repeat),
    );
  assert.equal(r.baseXp + r.bonusXp, 0);
  assert.equal(await countCanonicalReadContributions(prisma, [actor.id]), 0);
  assert.equal(
    await prisma.dorpVillage.count({ where: { ownerId: actor.id } }),
    0,
  );
});

test("ontbrekende, verborgen, verkeerde uitgave/taal of gewijzigde schrifttekst geeft geen ongelezene vragen of XP", async () => {
  const actor = await account(),
    s = await issue(actor),
    pgp = f.pgpCollection!;
  await prisma.contentCollection.update({
    where: { id: pgp.id },
    data: { visibleToUsers: false },
  });
  try {
    const dto = await getStudyReader(actor, f.lesson.id, f.key);
    assert.ok(dto);
    assert.deepEqual(dto.exerciseCounts, [3, 0, 0, 0, 0, 0]);
    assert.deepEqual(dto.scriptureReadings, []);
    assert.equal(await issueStudyExerciseSession(actor, input()), null);
    await assert.rejects(
      submitStudyExerciseSession(actor, s.sessionId, await answers(s)),
      locked,
    );
  } finally {
    await prisma.contentCollection.update({
      where: { id: pgp.id },
      data: { visibleToUsers: true },
    });
  }
  for (const update of [
    { editionKey: "verkeerde-pilot-uitgave" },
    { language: "xx" },
  ]) {
    await prisma.contentCollection.update({
      where: { id: pgp.id },
      data: update,
    });
    try {
      assert.equal(await issueStudyExerciseSession(actor, input()), null);
    } finally {
      await prisma.contentCollection.update({
        where: { id: pgp.id },
        data: { editionKey: "pgp", language: "nl" },
      });
    }
  }
  const verse = await prisma.verse.findFirstOrThrow({
    where: {
      number: 4,
      chapter: {
        number: 1,
        book: { key: "pgp/moses", contentCollectionId: pgp.id },
      },
    },
  });
  await prisma.verse.update({
    where: { id: verse.id },
    data: { text: verse.text + " Ongeldige bronwijziging." },
  });
  try {
    await assert.rejects(
      resumeStudyExerciseSession(actor, { sessionId: s.sessionId, ...input() }),
      locked,
    );
    await assert.rejects(
      submitStudyExerciseSession(actor, s.sessionId, await answers(s)),
      locked,
    );
  } finally {
    await prisma.verse.update({
      where: { id: verse.id },
      data: { text: verse.text },
    });
  }
  assert.equal(
    await prisma.xPTransaction.count({ where: { userId: actor.id } }),
    0,
  );
});

test("herpublicatie behoudt vragen/credits maar verouderde sessies blijven geblokkeerd", async () => {
  const actor = await account(),
    s = await issue(actor),
    ids = s.exercises.map((q) => q.id);
  const newer = await appendStudyRevision(f.admin.actor, f.edition.id, {
    schemaVersion: 1,
    title: f.revision.title + " — revisiecontrole",
    body: f.revision.body,
    sourceMetadata: { sourceKey: "02" },
    rightsMetadata: {
      holder: "Echte bronfixture",
      permission: "Alleen geïsoleerde revisiecontrole",
    },
  });
  await prisma.studyLessonEdition.update({
    where: { id: f.edition.id },
    data: { publishedRevisionId: newer.id },
  });
  try {
    await assert.rejects(
      submitStudyExerciseSession(actor, s.sessionId, await answers(s)),
      locked,
    );
    const next = await issueStudyExerciseSession(actor, {
      ...input(),
      revisionId: newer.id,
    });
    assert.ok(next);
    assert.deepEqual(
      next.exercises.map((q) => q.id),
      ids,
    );
  } finally {
    await prisma.studyLessonEdition.update({
      where: { id: f.edition.id },
      data: { publishedRevisionId: f.revision.id },
    });
  }
});

test("een ingetrokken pilotvraag wordt niet door automatische voorbereiding herpubliceerd", async () => {
  const actor = await account(),
    s = await issue(actor),
    row = await prisma.exercise.findFirstOrThrow({
      where: {
        studyLessonEditionId: f.edition.id,
        id: { startsWith: "studyq-pilot-" },
      },
    });
  await prisma.exercise.update({
    where: { id: row.id },
    data: { status: "IN_REVIEW" },
  });
  try {
    assert.equal(await issueStudyExerciseSession(actor, input()), null);
    await assert.rejects(
      submitStudyExerciseSession(actor, s.sessionId, await answers(s)),
      locked,
    );
    assert.equal(
      (await prisma.exercise.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
      "IN_REVIEW",
    );
  } finally {
    await prisma.exercise.update({
      where: { id: row.id },
      data: { status: "APPROVED" },
    });
  }
});
