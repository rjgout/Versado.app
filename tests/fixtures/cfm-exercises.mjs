import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db.ts";
import {
  referenceAccount,
  assertReferenceTestEnvironment,
} from "./reference-content.mjs";
import { appendStudyRevision } from "../../src/lib/studyContent/revisions.ts";
import { text8 } from "../../src/lib/studyContent/personalStudy.ts";
import { personalStudyFor } from "../../src/lib/studyContent/personalStudyOverrides.ts";
import { generateStudyQuestion } from "../../src/lib/studyContent/exercisePlan.ts";
export async function cfmExerciseFixture() {
  assertReferenceTestEnvironment();
  const admin = await referenceAccount(true),
    key = "synthetic-study-cfm-" + randomUUID();
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  await prisma.contentCollection.create({
    data: {
      id: key,
      slug: key,
      name: "Synthetische CFM-vragen",
      work: key,
      editionKey: key,
      language: "nl",
      icon: "",
      publicationState: "PUBLISHED",
      visibleToUsers: true,
    },
  });
  const period = await prisma.studyPeriod.create({
    data: {
      workKey: key,
      sourceKey: "2026",
      year: 2026,
      label: "Synthetisch 2026",
    },
  });
  const lesson = await prisma.studyLesson.create({
    data: {
      workKey: key,
      periodId: period.id,
      sourceKey: "01",
      order: 1,
      startsOn: new Date("2026-10-19Z"),
      endsOnExclusive: new Date("2026-10-26Z"),
    },
  });
  const edition = await prisma.studyLessonEdition.create({
    data: {
      lessonId: lesson.id,
      collectionId: key,
      workKey: key,
      slug: "synthetic-questions",
    },
  });
  const text = "Geen ding zal bij God onmogelijk zijn",
    sourceUrl =
      "https://www.churchofjesuschrist.org/study/scriptures/nt/luke/1?lang=nld&id=p37#p37";
  const blocks = [
    {
      id: "title",
      type: "heading",
      level: 2,
      content: [{ type: "text", text: "Synthetische schriftstudie" }],
    },
    {
      id: "intro",
      type: "paragraph",
      content: [
        { type: "text", text: "Dit is een geïsoleerde, synthetische testles." },
      ],
    },
    {
      id: "personal",
      type: "heading",
      level: 2,
      content: [{ type: "text", text: "Studietips voor thuis en in de kerk" }],
    },
  ];
  for (let i = 1; i <= 6; i++)
    blocks.push(
      {
        id: "topic-" + i,
        type: "heading",
        level: 3,
        content: [{ type: "text", text: "Synthetisch onderwerp " + i }],
      },
      {
        id: "quote-" + i,
        type: "paragraph",
        content: [
          {
            type: "text",
            text:
              "Synthetische testcontext rond dit werkelijke schriftcitaat: ‘" +
              text +
              "’. ",
          },
          {
            id: "ref-" + i,
            type: "reference",
            label: "Lukas 1:37",
            target: { sourceKey: sourceUrl, externalUrl: sourceUrl },
          },
        ],
      },
    );
  blocks.push(
    {
      id: "teaching",
      type: "heading",
      level: 2,
      content: [{ type: "text", text: "Ideeën voor onderwijs aan kinderen" }],
    },
    {
      id: "outside",
      type: "paragraph",
      content: [{ type: "text", text: "Niet voor persoonlijke leesvragen." }],
    },
  );
  const body = { schemaVersion: 1, sections: [{ id: "main", blocks }] };
  const revision = await appendStudyRevision(admin.actor, edition.id, {
    schemaVersion: 1,
    title: "Synthetische CFM-vragen — lange titel voor kleine telefoons",
    body,
    sourceMetadata: { sourceKey: "01" },
    rightsMetadata: {
      holder: "Testbron",
      permission: "Alleen geïsoleerde test",
    },
  });
  await prisma.studyLessonEdition.update({
    where: { id: edition.id },
    data: { publishedRevisionId: revision.id },
  });
  const plan = personalStudyFor({ workKey: key, sourceKey: "01", body });
  if (!plan.supported) throw new Error("Geen synthetisch persoonlijk plan");
  for (const step of plan.steps) {
    const blockId = step.blockIds.find((id) => id.startsWith("quote-"));
    if (!blockId) throw new Error("Geen gelezen citaat in stap " + step.index);
    for (let n = 0; n < 3; n++) {
      const proof = {
        blockId,
        blockTextHash: text8(blocks.find((b) => b.id === blockId)),
        quote: text,
        sourceUrl,
        verseRef: "Lukas 1:37",
        type: n === 1 ? "WORD_BANK" : "FILL_BLANK",
        seed: n,
      };
      const q = generateStudyQuestion(proof, "nl");
      if (!q) throw new Error("Ongeldige testvraag");
      await prisma.exercise.create({
        data: {
          id: `${key}-${step.index}-${n}`,
          studyLessonEditionId: edition.id,
          studySource: proof,
          order: n,
          type: q.type,
          status: "APPROVED",
          prompt: q.prompt,
          verseRef: q.verseRef,
          answers: JSON.stringify(q.answers),
          wordBank: q.wordBank ? JSON.stringify(q.wordBank) : null,
          options: {
            create: (q.options ?? []).map((label, order) => ({
              label,
              order,
              isCorrect: label.toLowerCase() === q.answers[0],
            })),
          },
        },
      });
    }
  }
  return { admin, key, lesson, edition, revision, body, plan };
}

// Vergelijking met de echte bestaande hoofdstukengine, uitsluitend synthetische testinhoud.
export async function standardExerciseFixture(parts = 1) {
  assertReferenceTestEnvironment();
  const book = await prisma.book.create({
    data: {
      slug: "synthetic-standard-" + randomUUID(),
      name: "Synthetisch vergelijkingsboek",
      order: 999,
      contentCollectionId: "content_bom",
    },
  });
  const chapter = await prisma.chapter.create({
    data: { bookId: book.id, number: 1, order: 1 },
  });
  for (let n = 1; n <= parts * 10; n++) {
    const verse = await prisma.verse.create({
      data: {
        chapterId: chapter.id,
        number: n,
        text: "Uitsluitend synthetische testtekst voor de bestaande hoofdstukflow.",
      },
    });
    if (n % 10 === 1)
      for (let q = 0; q < 3; q++)
        await prisma.exercise.create({
          data: {
            chapterId: chapter.id,
            sourceVerseId: verse.id,
            order: n * 3 + q,
            type: "TRUE_FALSE",
            status: "APPROVED",
            verseRef: `Synthetische controle 1:${n}`,
            prompt: `Dit is synthetische teststelling ${n}/${q}.`,
            answers: '["true"]',
          },
        });
  }
  return chapter;
}

export async function officialCfmExerciseFixture(year = 2027) {
  assertReferenceTestEnvironment();
  const { CFM_SOURCE_2026, CFM_SOURCE_2027 } =
    await import("../../src/lib/studyContent/cfmSources.ts");
  const { loadCfmLesson } =
    await import("../../src/lib/studyContent/cfm2026Import.ts");
  const source = year === 2026 ? CFM_SOURCE_2026 : CFM_SOURCE_2027,
    sourceKey = year === 2026 ? "02" : "01",
    parsed = await loadCfmLesson(sourceKey, source),
    key = "official-cfm-copy-" + randomUUID(),
    admin = await referenceAccount(true);
  await prisma.contentWork.upsert({
    where: { key: source.manifest.workKey },
    create: { key: source.manifest.workKey, kind: "STUDY_PROGRAM" },
    update: {},
  });
  await prisma.contentCollection.create({
    data: {
      id: key,
      slug: key,
      name: "Geïsoleerde kopie CFM " + year,
      work: source.manifest.workKey,
      editionKey: key,
      language: "nl",
      icon: "",
      publicationState: "PUBLISHED",
      visibleToUsers: true,
    },
  });
  const period = await prisma.studyPeriod.create({
    data: {
      workKey: source.manifest.workKey,
      sourceKey: key,
      year,
      label: "Geïsoleerde officiële bronkopie",
    },
  });
  const lesson = await prisma.studyLesson.create({
      data: {
        workKey: source.manifest.workKey,
        periodId: period.id,
        sourceKey,
        order: 1,
      },
    }),
    edition = await prisma.studyLessonEdition.create({
      data: {
        lessonId: lesson.id,
        collectionId: key,
        workKey: source.manifest.workKey,
        slug: sourceKey,
      },
    });
  const revision = await appendStudyRevision(admin.actor, edition.id, {
    schemaVersion: 1,
    title: parsed.title,
    body: parsed.document,
    sourceMetadata: { sourceKey },
    rightsMetadata: {
      holder: "Geïsoleerde bronfixture",
      permission: "Uitsluitend testkopie; geen productiepublicatie",
    },
  });
  await prisma.studyLessonEdition.update({
    where: { id: edition.id },
    data: { publishedRevisionId: revision.id },
  });
  return { admin, key, lesson, edition, revision };
}
