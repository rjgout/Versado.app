// Kleine bronadapter: geen antwoord-, sessie- of beloningsengine.
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  generateFillBlank,
  generateWordBank,
  generateTrueFalse,
  type GeneratedExercise,
} from "@/lib/exerciseGen";
import { QUESTIONS_PER_PART } from "@/lib/learning/exercisePlan";
import sourceCatalogue from "../../../data/study-content/cfm-reading-question-sources.json";
import { text8 } from "./personalStudy";
import { personalStudyFor } from "./personalStudyOverrides";
import {
  readingBlockText,
  type ReaderDocument,
} from "./readingPositionContract";

export const STUDY_EXERCISES_TOTAL = 6 * QUESTIONS_PER_PART;
export const studyQuestionSourceSchema = z
  .object({
    blockId: z.string().min(1).max(128),
    blockTextHash: z.string().regex(/^[a-f0-9]{8}$/),
    verseRef: z.string().min(1).max(100),
    quote: z.string().min(20).max(600),
    sourceUrl: z.string().url(),
    seed: z.number().int().min(0).max(100),
    type: z.enum(["FILL_BLANK", "WORD_BANK", "TRUE_FALSE"]),
  })
  .strict();
export type StudyQuestionSource = z.infer<typeof studyQuestionSourceSchema>;
export type StudyQuestion = GeneratedExercise & {
  id: string;
  studySource: StudyQuestionSource;
};
export type ExerciseLesson = {
  workKey: string;
  sourceKey: string;
  language: string;
  editionId: string;
  body: ReaderDocument;
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
// Expliciet gecontroleerde citaten die daadwerkelijk in de persoonlijke tekst staan.
// Andere stappen blijven zonder vragen; een verwijzing alleen is nooit vraaginhoud.
const SOURCES = z
  .record(
    z.string(),
    z.array(studyQuestionSourceSchema.omit({ type: true })),
  )
  .parse(sourceCatalogue.sources);
export function generateStudyQuestion(
  source: StudyQuestionSource,
  language: string,
): GeneratedExercise | null {
  if (!["nl", "en", "de", "fr", "es"].includes(language)) return null;
  // Alleen de echte contenttaal, geen generatorfallback naar Nederlands.
  const lang = language as "nl" | "en" | "de" | "fr" | "es";
  const ref = source.verseRef;
  return source.type === "FILL_BLANK"
    ? generateFillBlank(source.quote, ref, source.seed, [], lang)
    : source.type === "WORD_BANK"
      ? generateWordBank(source.quote, ref, source.seed)
      : generateTrueFalse(source.quote, ref, source.seed, lang);
}
function hasReference(value: unknown, url: URL): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => hasReference(v, url));
  const o = value as Record<string, unknown>;
  if (o.type === "reference" && o.target && typeof o.target === "object") {
    const t = o.target as Record<string, unknown>;
    try {
      const u = new URL(String(t.externalUrl ?? t.sourceKey));
      if (
        u.hostname === url.hostname &&
        u.pathname === url.pathname &&
        u.searchParams.get("id") === url.searchParams.get("id")
      )
        return true;
    } catch {}
  }
  return Object.values(o).some((v) => hasReference(v, url));
}
export function validStudyQuestionSource(
  lesson: ExerciseLesson,
  source: StudyQuestionSource,
) {
  const url = new URL(source.sourceUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.churchofjesuschrist.org" ||
    !/^\/study\/scriptures\/(ot|nt|bofm|dc-testament|pgp)\//.test(
      url.pathname,
    ) ||
    url.username ||
    url.password ||
    url.port
  )
    return false;
  if (
    url.searchParams.get("lang") !==
    (
      { nl: "nld", en: "eng", de: "deu", fr: "fra", es: "spa" } as Record<
        string,
        string
      >
    )[lesson.language]
  )
    return false;
  const block = lesson.body.sections
    .flatMap((s) => s.blocks)
    .find((b) => b.id === source.blockId);
  return (
    !!block &&
    text8(block) === source.blockTextHash &&
    readingBlockText(block).includes(source.quote) &&
    hasReference(block, url)
  );
}
export function preparedStudyQuestions(
  lesson: ExerciseLesson,
): StudyQuestion[] {
  if (lesson.language !== "nl") return [];
  const sources = SOURCES[`${lesson.workKey}/${lesson.sourceKey}`] ?? [];
  if (!sources.length) return [];
  // Eén kandidaat per bestaand vraagtype per gelezen citaat; geen extra
  // invulvarianten maken om een inhoudelijk tekort kunstmatig aan te vullen.
  // De vastgelegde seed blijft gelijk wanneer de catalogus wordt uitgebreid/herordend.
  return sources.flatMap((citation) => {
    return (["FILL_BLANK", "WORD_BANK", "TRUE_FALSE"] as const).flatMap(
      (type) => {
        const source = { ...citation, type };
        if (!validStudyQuestionSource(lesson, source)) return [];
        const generated = generateStudyQuestion(source, lesson.language);
        return generated
          ? [
              {
                ...generated,
                id:
                  "studyq-" +
                  sha(
                    `${lesson.editionId}|${source.blockId}|${source.quote}|${type}|${source.seed}`,
                  ).slice(0, 40),
                studySource: source,
              },
            ]
          : [];
      },
    );
  });
}
export function studyExercisePlan(
  lesson: ExerciseLesson,
  questions: StudyQuestion[],
) {
  const personal = personalStudyFor(lesson);
  if (!personal.supported) return null;
  const parts = personal.steps.map((step) => ({
    index: step.index,
    fingerprint: step.fingerprint,
    questions: questions
      .filter(
        (q) =>
          step.blockIds.includes(q.studySource.blockId) &&
          validStudyQuestionSource(lesson, q.studySource),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, QUESTIONS_PER_PART),
  }));
  for (const part of parts)
    if (part.questions.length < QUESTIONS_PER_PART) part.questions = [];
  return {
    parts,
    total: STUDY_EXERCISES_TOTAL,
    personalVersion: personal.version,
    fingerprint: sha(
      JSON.stringify({
        personal: personal.fingerprint,
        questions: parts.map((p) =>
          p.questions.map((q) => [
            q.id,
            q.type,
            q.prompt,
            q.answers,
            q.wordBank ?? null,
            q.options ?? [],
            q.studySource.blockId,
            q.studySource.verseRef,
            q.studySource.quote,
            q.studySource.sourceUrl,
            q.studySource.seed,
          ]),
        ),
      }),
    ),
  };
}
