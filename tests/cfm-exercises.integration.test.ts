import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { cfmExerciseFixture } from "./fixtures/cfm-exercises.mjs";
import { referenceAccount } from "./fixtures/reference-content.mjs";
import {
  issueStudyExerciseSession,
  submitStudyExerciseSession,
  resetReadingProgress,
} from "../src/lib/learning/contentProgress";
import { loadStudyExerciseSource } from "../src/lib/studyContent/exerciseSource";
import { appendStudyRevision } from "../src/lib/studyContent/revisions";
import { applyStepProgress } from "../src/lib/studyContent/stepProgress";
import {
  maxContentBaseXp,
  XP_PER_CORRECT,
  COMPLETION_BONUS,
} from "../src/lib/learning/rewards";
import { applyRepeatDiscount } from "../src/lib/xpRules";
import { countCanonicalReadContributions } from "../src/lib/dorp/growth";
let f: Awaited<ReturnType<typeof cfmExerciseFixture>>;
before(async () => {
  f = await cfmExerciseFixture();
});
after(() => prisma.$disconnect());
async function account() {
  return (await referenceAccount()).actor;
}
async function issue(
  actor: Awaited<ReturnType<typeof account>>,
  stepIndex: number | null = null,
) {
  const s = await issueStudyExerciseSession(actor, {
    editionId: f.edition.id,
    revisionId: f.revision.id,
    stepIndex,
  });
  assert.ok(s);
  return s;
}
async function answers(
  s: NonNullable<Awaited<ReturnType<typeof issueStudyExerciseSession>>>,
  wrong = 0,
) {
  const rows = await prisma.exercise.findMany({
    where: { id: { in: s.exercises.map((e) => e.id) } },
  });
  return s.exercises.map((e, i) => ({
    exerciseId: e.id,
    given:
      i < wrong
        ? ["fout"]
        : JSON.parse(rows.find((r) => r.id === e.id)!.answers),
  }));
}

test("zes maal drie en exact dezelfde achttien identiteiten; geen antwoorden in uitgifte", async () => {
  const actor = await account(),
    full = await issue(actor);
  assert.equal(full.exercises.length, 18);
  assert.deepEqual(
    full.groups.map((g) => g.count),
    [3, 3, 3, 3, 3, 3],
  );
  const ids = [];
  for (let i = 1; i <= 6; i++) {
    const part = await issue(actor, i);
    assert.equal(part.exercises.length, 3);
    ids.push(...part.exercises.map((e) => e.id));
  }
  assert.deepEqual(
    ids,
    full.exercises.map((e) => e.id),
  );
  assert.ok(
    full.exercises.every((e) => !("answers" in e) && !("studySource" in e)),
  );
});
test("eerste perfecte week: gedeelde formule/bonus, één oefeninhoud, zes stapstatussen, geen READ of Dorp-groei", async () => {
  const actor = await account(),
    s = await issue(actor);
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
  });
  const result = await submitStudyExerciseSession(
    actor,
    s.sessionId,
    await answers(s),
  );
  assert.equal(result.baseXp, 18 * XP_PER_CORRECT);
  assert.equal(result.bonusXp, COMPLETION_BONUS);
  assert.equal(result.xpEarned, maxContentBaseXp(18));
  const rows = await prisma.contentProgress.findMany({
    where: { userId: actor.id },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].exerciseAnswered, 18);
  assert.equal(rows[0].readStatus, null);
  assert.ok(rows[0].exercisesCompletedAt);
  assert.equal(
    await prisma.studyStepProgress.count({
      where: { userId: actor.id, status: "COMPLETED" },
    }),
    6,
  );
  assert.equal(await countCanonicalReadContributions(prisma, [actor.id]), 0);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: actor.id } })).xpTotal,
    before.xpTotal + maxContentBaseXp(18),
  );
  const again = await issue(actor);
  assert.equal(
    (
      await submitStudyExerciseSession(
        actor,
        again.sessionId,
        await answers(again),
      )
    ).repeatXp,
    applyRepeatDiscount(18 * XP_PER_CORRECT),
  );
});
test("fout kan later verbeteren; geen bonus per stap en geen tweede basisbeloning via weekroute", async () => {
  const actor = await account(),
    part = await issue(actor, 1),
    r = await submitStudyExerciseSession(
      actor,
      part.sessionId,
      await answers(part, 1),
    );
  assert.equal(r.baseXp, 2 * XP_PER_CORRECT);
  assert.equal(r.bonusXp, 0);
  const full = await issue(actor),
    done = await submitStudyExerciseSession(
      actor,
      full.sessionId,
      await answers(full),
    );
  assert.equal(done.baseXp, 16 * XP_PER_CORRECT);
  assert.equal(done.bonusXp, COMPLETION_BONUS);
  const after = await issue(actor, 1);
  const repeat = await submitStudyExerciseSession(
    actor,
    after.sessionId,
    await answers(after),
  );
  assert.equal(repeat.baseXp, 0);
  assert.equal(repeat.repeatXp, applyRepeatDiscount(3 * XP_PER_CORRECT));
});
test("gedeeltelijk foute volledige week wordt gemaakt; later verbeteren verdient alleen ontbrekende basis/bonus", async () => {
  const actor = await account(),
    full = await issue(actor),
    r = await submitStudyExerciseSession(
      actor,
      full.sessionId,
      await answers(full, 1),
    );
  assert.equal(r.baseXp, 17 * XP_PER_CORRECT);
  assert.equal(r.bonusXp, 0);
  assert.equal(r.content.exercisesAnswered, 18);
  const retry = await issue(actor),
    better = await submitStudyExerciseSession(
      actor,
      retry.sessionId,
      await answers(retry),
    );
  assert.equal(better.baseXp, XP_PER_CORRECT);
  assert.equal(better.bonusXp, COMPLETION_BONUS);
  assert.equal(better.repeatXp, 0);
});
test("twee apparaten en verloren response: één claim per sessie, één basisgrens en één reeksdag", async () => {
  const actor = await account(),
    a = await issue(actor),
    b = await issue(actor, 1),
    aa = await answers(a),
    bb = await answers(b);
  const results = await Promise.all([
    submitStudyExerciseSession(actor, a.sessionId, aa),
    submitStudyExerciseSession(actor, b.sessionId, bb),
  ]);
  assert.equal(
    results.reduce((n, r) => n + r.baseXp + r.bonusXp, 0),
    maxContentBaseXp(18),
  );
  const xp = await prisma.xPTransaction.count({ where: { userId: actor.id } }),
    credits = await prisma.contentExerciseCredit.count({
      where: { userId: actor.id },
    });
  const replay = await submitStudyExerciseSession(actor, a.sessionId, aa);
  assert.equal(replay.xpEarned, results[0].xpEarned);
  assert.equal(
    await prisma.xPTransaction.count({ where: { userId: actor.id } }),
    xp,
  );
  assert.equal(
    await prisma.contentExerciseCredit.count({ where: { userId: actor.id } }),
    credits,
  );
  assert.equal(
    await prisma.streakDay.count({ where: { userId: actor.id } }),
    1,
  );
});
test("onvolledig en andermans sessie verdienen niets; replay van dezelfde sessie is idempotent", async () => {
  const actor = await account(),
    other = await account(),
    s = await issue(actor, 1),
    aa = await answers(s);
  await assert.rejects(
    submitStudyExerciseSession(actor, s.sessionId, aa.slice(1)),
  );
  await assert.rejects(submitStudyExerciseSession(other, s.sessionId, aa));
  assert.equal(
    await prisma.xPTransaction.count({ where: { userId: actor.id } }),
    0,
  );
  const rs = await Promise.all([
    submitStudyExerciseSession(actor, s.sessionId, aa),
    submitStudyExerciseSession(actor, s.sessionId, aa),
  ]);
  assert.equal(rs[0].xpEarned, rs[1].xpEarned);
  assert.equal(
    await prisma.xPTransaction.count({ where: { userId: actor.id } }),
    1,
  );
});
test("reset bewaart beloningshistorie en reeds afgevinkte CFM-stappen; oude READ geeft geen retroactieve XP", async () => {
  const actor = await account(),
    source = await loadStudyExerciseSource(actor, f.edition.id, prisma);
  assert.ok(source);
  await prisma.contentProgress.create({
    data: {
      userId: actor.id,
      contentKey: source.contentKey,
      readStatus: "READ",
    },
  });
  await prisma.$transaction((tx) =>
    applyStepProgress(tx, actor.id, {
      lessonEditionId: f.edition.id,
      revisionId: f.revision.id,
      step: f.plan.steps[0],
      action: "COMPLETE",
    }),
  );
  assert.equal(
    await prisma.xPTransaction.count({ where: { userId: actor.id } }),
    0,
  );
  const s = await issue(actor);
  await submitStudyExerciseSession(actor, s.sessionId, await answers(s));
  await prisma.$transaction((tx) => resetReadingProgress(tx, actor.id));
  const again = await issue(actor),
    r = await submitStudyExerciseSession(
      actor,
      again.sessionId,
      await answers(again),
    );
  assert.equal(r.baseXp + r.bonusXp, 0);
  assert.equal(r.repeatXp, applyRepeatDiscount(18 * XP_PER_CORRECT));
  assert.equal(
    await prisma.studyStepProgress.count({
      where: { userId: actor.id, status: "COMPLETED" },
    }),
    6,
  );
});
test("nieuwe revisie of ingetrokken collectie blokkeert oude sessies zonder mutatie", async () => {
  const actor = await account(),
    s = await issue(actor),
    aa = await answers(s);
  await prisma.contentCollection.update({
    where: { id: f.key },
    data: { visibleToUsers: false },
  });
  try {
    await assert.rejects(submitStudyExerciseSession(actor, s.sessionId, aa));
  } finally {
    await prisma.contentCollection.update({
      where: { id: f.key },
      data: { visibleToUsers: true },
    });
  }
  const newer = await appendStudyRevision(f.admin.actor, f.edition.id, {
    schemaVersion: 1,
    title: "Nieuwe synthetische revisie",
    body: f.body,
    sourceMetadata: { sourceKey: "01" },
    rightsMetadata: { holder: "Testbron", permission: "Alleen test" },
  });
  await prisma.studyLessonEdition.update({
    where: { id: f.edition.id },
    data: { publishedRevisionId: newer.id },
  });
  try {
    await assert.rejects(submitStudyExerciseSession(actor, s.sessionId, aa));
    assert.equal(
      await prisma.xPTransaction.count({ where: { userId: actor.id } }),
      0,
    );
  } finally {
    await prisma.studyLessonEdition.update({
      where: { id: f.edition.id },
      data: { publishedRevisionId: f.revision.id },
    });
  }
});

test("de bestaande hoofdstukengine en CFM betalen voor N=18 exact dezelfde basis-, bonus- en herhaal-XP", async () => {
  const { standardExerciseFixture } =
    await import("./fixtures/cfm-exercises.mjs");
  const { issueExerciseSession, submitExerciseSession } =
    await import("../src/lib/learning/contentProgress");
  const actor = await account(),
    chapter = await standardExerciseFixture(6);
  const ordinary = await issueExerciseSession(actor.id, chapter.id);
  assert.equal(ordinary.exercises.length, 18);
  assert.ok(ordinary.sessionId);
  const given = ordinary.exercises.map((e) => ({
    exerciseId: e.id,
    given: ["true"],
  }));
  const a = await submitExerciseSession(actor.id, ordinary.sessionId, given),
    study = await issue(actor),
    b = await submitStudyExerciseSession(
      actor,
      study.sessionId,
      await answers(study),
    );
  assert.deepEqual(
    [a.baseXp, a.bonusXp, a.repeatXp, a.content.exercisesAnswered],
    [b.baseXp, b.bonusXp, b.repeatXp, b.content.exercisesAnswered],
  );
  const ordinary2 = await issueExerciseSession(actor.id, chapter.id);
  assert.ok(ordinary2.sessionId);
  const a2 = await submitExerciseSession(
      actor.id,
      ordinary2.sessionId,
      ordinary2.exercises.map((e) => ({ exerciseId: e.id, given: ["true"] })),
    ),
    study2 = await issue(actor),
    b2 = await submitStudyExerciseSession(
      actor,
      study2.sessionId,
      await answers(study2),
    );
  assert.deepEqual(
    [a2.baseXp, a2.bonusXp, a2.repeatXp],
    [b2.baseXp, b2.bonusXp, b2.repeatXp],
  );
});
test("mijlpaal bij een reeds bestaande READ-rij telt één week, niet zes stappen of een herhaalde week", async () => {
  const actor = await account(),
    source = await loadStudyExerciseSource(actor, f.edition.id, prisma);
  assert.ok(source);
  for (let n = 0; n < 9; n++)
    await prisma.contentProgress.create({
      data: {
        userId: actor.id,
        contentKey: "synthetic-prior-exercise-" + n,
        exercisesCompletedAt: new Date(),
      },
    });
  await prisma.contentProgress.create({
    data: {
      userId: actor.id,
      contentKey: source.contentKey,
      readStatus: "READ",
    },
  });
  const first = await issue(actor);
  await submitStudyExerciseSession(
    actor,
    first.sessionId,
    await answers(first, 18),
  );
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: actor.id },
  });
  assert.equal(before.freezeCount, 1);
  const second = await issue(actor);
  await submitStudyExerciseSession(
    actor,
    second.sessionId,
    await answers(second),
  );
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: actor.id } }))
      .freezeCount,
    1,
  );
  assert.equal(
    await prisma.freezeTransaction.count({
      where: { userId: actor.id, type: "EARNED" },
    }),
    1,
  );
});
test("verlopen sessies, verkeerde editie en veranderde contenttaal blijven zonder beloning; noodstop behoudt lezen", async () => {
  const actor = await account(),
    s = await issue(actor, 1),
    aa = await answers(s),
    saved = await prisma.exerciseSession.findUniqueOrThrow({
      where: { id: s.sessionId },
    });
  await assert.rejects(
    prisma.exerciseSession.update({
      where: { id: s.sessionId },
      data: { exerciseIds: "[]" },
    }),
    /STUDY_EXERCISE_SESSION_IMMUTABLE/,
  );
  const expired = await prisma.exerciseSession.create({
    data: {
      userId: actor.id,
      contentKey: saved.contentKey,
      exerciseIds: saved.exerciseIds,
      studyContext: saved.studyContext!,
      createdAt: new Date(Date.now() - 8 * 86400000),
    },
  });
  await assert.rejects(submitStudyExerciseSession(actor, expired.id, aa));
  const other = await cfmExerciseFixture();
  await assert.rejects(
    issueStudyExerciseSession(actor, {
      editionId: other.edition.id,
      revisionId: f.revision.id,
      stepIndex: 1,
    }),
  );
  await prisma.contentCollection.update({
    where: { id: f.key },
    data: { language: "en" },
  });
  try {
    assert.equal(
      await issueStudyExerciseSession(actor, {
        editionId: f.edition.id,
        revisionId: f.revision.id,
        stepIndex: 1,
      }),
      null,
    );
  } finally {
    await prisma.contentCollection.update({
      where: { id: f.key },
      data: { language: "nl" },
    });
  }
  const previous = process.env.CFM_EXERCISES;
  process.env.CFM_EXERCISES = "off";
  try {
    await assert.rejects(submitStudyExerciseSession(actor, s.sessionId, aa));
    const { getStudyReader } = await import("../src/lib/studyContent/reader");
    assert.ok(await getStudyReader(actor, f.lesson.id, f.key));
  } finally {
    if (previous === undefined) delete process.env.CFM_EXERCISES;
    else process.env.CFM_EXERCISES = previous;
  }
  assert.equal(
    await prisma.xPTransaction.count({ where: { userId: actor.id } }),
    0,
  );
});

test("echte gepinde bronkopieën 2026/2027: gelijktijdige eerste uitgifte hergebruikt catalogus en vraag-ID’s zonder dubbele opties", async () => {
  const { officialCfmExerciseFixture } =
    await import("./fixtures/cfm-exercises.mjs");
  for (const year of [2026, 2027]) {
    const real = await officialCfmExerciseFixture(year),
      a = await account(),
      b = await account();
    const request = {
      editionId: real.edition.id,
      revisionId: real.revision.id,
      stepIndex: 1,
    };
    const [s1, s2] = await Promise.all([
      issueStudyExerciseSession(a, request),
      issueStudyExerciseSession(b, request),
    ]);
    assert.ok(s1);
    assert.ok(s2);
    assert.equal(s1.exercises.length, 3);
    assert.deepEqual(
      s1.exercises.map((q) => q.id),
      s2.exercises.map((q) => q.id),
    );
    const count = await prisma.questionOption.count({
      where: { exercise: { studyLessonEditionId: real.edition.id } },
    });
    const next = await issueStudyExerciseSession(a, request);
    assert.ok(next);
    assert.equal(
      await prisma.questionOption.count({
        where: { exercise: { studyLessonEditionId: real.edition.id } },
      }),
      count,
    );
    assert.equal(
      (await submitStudyExerciseSession(a, s1.sessionId, await answers(s1)))
        .baseXp,
      3 * XP_PER_CORRECT,
    );
    assert.equal(
      await issueStudyExerciseSession(a, { ...request, stepIndex: null }),
      null,
      "geen kunstmatige achttien vragen uit alleen de inleiding",
    );
  }
});
