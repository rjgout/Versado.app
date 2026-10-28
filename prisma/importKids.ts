import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { randomUUID } from "crypto";
import { exerciseSignature } from "../src/lib/exerciseSync";
import { reconcileSimpleExercises } from "./reconcileExercises";
import {
  generateFillBlank,
  generateWordBank,
  generateTrueFalse,
  buildDistractorPool,
  shuffleWithSeed,
} from "../src/lib/exerciseGen";
import { getT } from "../src/lib/i18n";
import type { LanguageCode } from "../src/lib/languages";
import { KIDS_SLUG } from "../src/lib/courses";

// Kindercursus van de uitgave 2023, per taal (zie prisma/kidsStories2023.<taal>.json).
export const KIDS_2023_SLUG_PREFIX = "kinderen-2023-";

export interface KidsStorySeed {
  number: number;
  title: string;
  subtitle?: string | null;
  ref?: string | null;
  text: string;
  images: string[];
}

/**
 * Zorgt voor de kindercursus van de uitgave 2023 in deze collectie en geeft
 * het id terug. Wordt de Nederlandse cursus voor het eerst aangemaakt, dan
 * gaat de oudere Nederlandse kindercursus uit het aanbod (voortgang en
 * directe links blijven werken, zie Course.enabled); daarna blijft dat een
 * keuze van de beheerder.
 */
export async function ensureKids2023Course(
  prisma: PrismaClient,
  language: LanguageCode,
  contentCollectionId: string
): Promise<string> {
  const slug = `${KIDS_2023_SLUG_PREFIX}${language}`;
  const existing = await prisma.course.findUnique({ where: { slug }, select: { id: true } });
  if (existing) {
    await prisma.course.update({ where: { slug }, data: { contentCollectionId } });
    return existing.id;
  }
  const classic = await prisma.course.findUnique({ where: { slug: KIDS_SLUG }, select: { order: true } });
  const created = await prisma.course.create({
    data: {
      slug,
      type: "KIDS",
      name: "Verhalen uit het Boek van Mormon (voor kinderen)",
      description: "Korte, geïllustreerde verhalen met een plaatjesspel en simpele vraagjes — leuk voor de kleintjes.",
      order: classic?.order ?? 100,
      contentCollectionId,
    },
    select: { id: true },
  });
  if (language === "nl") await prisma.course.updateMany({ where: { slug: KIDS_SLUG }, data: { enabled: false } });
  return created.id;
}

const MAX_TEXT_EXERCISES_PER_STORY = 8;
const MIN_SENTENCE_LENGTH = 25;
const MAX_SENTENCE_LENGTH = 170;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SENTENCE_LENGTH && s.length <= MAX_SENTENCE_LENGTH);
}

/**
 * Laadt de kindercursus ("Verhalen uit het Boek van Mormon", zie
 * prisma/kidsManifest.json) in de database. Genereert per verhaal een aantal
 * FILL_BLANK/WORD_BANK/TRUE_FALSE-oefeningen uit de verhaaltekst (zelfde
 * generators als bij de boekhoofdstukken, hier toegepast op zinnen i.p.v.
 * verzen) plus één IMAGE_CHOICE-oefening: welke van vier afbeeldingen (één
 * van dit verhaal, drie afleiders van andere verhalen) hoort bij dit
 * verhaal? Idempotent: herdraaien vervangt de oefeningen van hetzelfde
 * verhaal, en laat andere verhalen en gebruikersvoortgang ongemoeid.
 */
export async function importKidsStories(
  prisma: PrismaClient,
  stories: KidsStorySeed[],
  log: (msg: string) => void = console.log,
  options: { courseId?: string; language?: LanguageCode } = {}
) {
  const language = options.language ?? "nl";
  // Zonder courseId: de oudere Nederlandse uitgave, bij de vaste kindercursus.
  const courseId =
    options.courseId ?? (await prisma.course.findUnique({ where: { slug: KIDS_SLUG }, select: { id: true } }))?.id;
  if (!courseId) throw new Error("Kindercursus ontbreekt; draai eerst de import van de boeken (syncCourses).");
  const t = getT(language);
  const allImages = stories.flatMap((s) => s.images);
  const totals = { items: 0, kept: 0, created: 0, deleted: 0 };

  for (let i = 0; i < stories.length; i++) {
    const seed = stories[i];
    const story = await prisma.kidsStory.upsert({
      where: { courseId_number: { courseId, number: seed.number } },
      update: {
        title: seed.title,
        subtitle: seed.subtitle ?? null,
        reference: seed.ref ?? null,
        text: seed.text,
        images: JSON.stringify(seed.images),
        order: seed.number,
      },
      create: {
        courseId,
        number: seed.number,
        title: seed.title,
        subtitle: seed.subtitle ?? null,
        reference: seed.ref ?? null,
        text: seed.text,
        images: JSON.stringify(seed.images),
        order: seed.number,
      },
    });

    const sentences = splitSentences(seed.text).slice(0, MAX_TEXT_EXERCISES_PER_STORY);
    const distractorPool = buildDistractorPool(sentences, language);

    const exerciseRows: Prisma.KidsExerciseCreateManyInput[] = [];
    const optionRows: Prisma.KidsExerciseOptionCreateManyInput[] = [];
    let order = 0;

    for (let s = 0; s < sentences.length; s++) {
      const sentence = sentences[s];
      const verseRef = t("misc.storyN", { n: seed.number });
      let generated;
      if (s % 3 === 2) {
        generated = generateTrueFalse(sentence, verseRef, s, language);
      } else if (s % 2 === 0) {
        generated = generateFillBlank(sentence, verseRef, s, distractorPool, language);
      } else {
        generated = generateWordBank(sentence, verseRef, s);
      }
      if (!generated) continue;

      const exerciseId = randomUUID();
      exerciseRows.push({
        id: exerciseId,
        storyId: story.id,
        order: order++,
        type: generated.type,
        prompt: generated.prompt,
        answers: JSON.stringify(generated.answers),
        wordBank: generated.wordBank ? JSON.stringify(generated.wordBank) : undefined,
      });
      generated.options?.forEach((label, idx) => {
        optionRows.push({
          id: randomUUID(),
          exerciseId,
          label,
          isCorrect: generated!.answers.includes(label.toLowerCase()),
          order: idx,
        });
      });
    }

    // IMAGE_CHOICE: welke afbeelding hoort bij dit verhaal? Correct antwoord
    // is een eigen afbeelding van dit verhaal; de 3 afleiders komen van
    // andere verhalen (deterministisch geshuffeld, dus stabiel bij herimport).
    if (seed.images.length > 0) {
      const correctImage = seed.images[0];
      const otherImages = allImages.filter((img) => !seed.images.includes(img));
      const distractors = shuffleWithSeed(otherImages, seed.number).slice(0, 3);
      const imageOptions = shuffleWithSeed([correctImage, ...distractors], seed.number + 11);

      const exerciseId = randomUUID();
      exerciseRows.push({
        id: exerciseId,
        storyId: story.id,
        order: order++,
        type: "IMAGE_CHOICE",
        prompt: t("misc.kidsImageChoice", { title: seed.title }),
        answers: JSON.stringify([correctImage.toLowerCase()]),
      });
      imageOptions.forEach((url, idx) => {
        optionRows.push({
          id: randomUUID(),
          exerciseId,
          label: url,
          imageUrl: url,
          isCorrect: url === correctImage,
          order: idx,
        });
      });
    }

    const optionsOf = (exerciseId: string) => optionRows.filter((option) => option.exerciseId === exerciseId);
    const existing = (await prisma.kidsExercise.findMany({ where: { storyId: story.id }, orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } })).map((row) => ({
      id: row.id, order: row.order, options: row.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })), signature: exerciseSignature({ type: row.type, verseRef: "", prompt: row.prompt, answers: row.answers, wordBank: row.wordBank, options: row.options }),
    }));
    const stats = await reconcileSimpleExercises({
      existing,
      desired: exerciseRows.map((row) => ({ row, signature: exerciseSignature({ type: row.type, verseRef: "", prompt: row.prompt, answers: row.answers, wordBank: row.wordBank, options: optionsOf(row.id!).map((o) => ({ label: o.label, isCorrect: o.isCorrect ?? false })) }), options: optionsOf(row.id!) })),
      replaceOptions: async (exerciseId, options) => { await prisma.kidsExerciseOption.deleteMany({ where: { exerciseId } }); await prisma.kidsExerciseOption.createMany({ data: options.map((o) => ({ ...o, exerciseId })) }); },
      setOrder: (id, order) => prisma.kidsExercise.update({ where: { id }, data: { order } }),
      remove: (ids) => prisma.kidsExercise.deleteMany({ where: { id: { in: ids } } }),
      create: async (rows, options) => { await prisma.kidsExercise.createMany({ data: rows }); if (options.length > 0) await prisma.kidsExerciseOption.createMany({ data: options }); },
    });

    totals.items++; totals.kept += stats.kept; totals.created += stats.created; totals.deleted += stats.deleted;
    log(`  - Verhaal ${seed.number} (${seed.title}): ${order} oefeningen (${stats.kept} behouden, ${stats.created} nieuw, ${stats.deleted} verwijderd)`);
  }
  return totals;
}
