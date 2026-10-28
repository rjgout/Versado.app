// Alleen de expliciet goedgekeurde pilotselectie; geen algemene automatische bronverbreding.
import { createHash } from "node:crypto";
import { z } from "zod";
import manifest from "../../../data/study-content/cfm-pilot-2026-02.json";
import { personalStudyFor } from "./personalStudyOverrides";
import { text8 } from "./personalStudy";
import type { ReaderDocument } from "./readingPositionContract";

export const pilotScriptureProofSchema = z
  .object({
    pilot: z.literal("cfm-2026-02-pgp-v1"),
    bookKey: z.string().min(1).max(100),
    chapter: z.number().int().positive(),
    verse: z.number().int().positive(),
    chapterHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type PilotScriptureProof = z.infer<typeof pilotScriptureProofSchema>;
export interface StudyScriptureReading {
  stepIndex: number;
  collectionId: string;
  chapterId: string;
  work: string;
  editionKey: string;
  language: string;
  bookKey: string;
  bookName: string;
  chapter: number;
  chapterHash: string;
  verses: Array<{ id: string; number: number; text: string }>;
}
type Lesson = {
  workKey: string;
  sourceKey: string;
  editionKey?: string;
  language: string;
  body: ReaderDocument;
};
export function pilotBlockReferencesHash(value: unknown): string {
  function references(node: unknown): unknown[] {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(references);
    const o = node as Record<string, unknown>;
    if (o.type === "reference" && o.target && typeof o.target === "object") {
      const t = o.target as Record<string, unknown>;
      return [
        [
          o.label,
          t.sourceKey ?? null,
          t.externalUrl ?? null,
          t.workKey ?? null,
          t.editionKey ?? null,
          t.language ?? null,
        ],
      ];
    }
    return Object.values(o).flatMap(references);
  }
  return createHash("sha256")
    .update(JSON.stringify(references(value)))
    .digest("hex");
}
export function pilotReadingSelections(lesson: Lesson) {
  const identity = manifest.cfm;
  if (
    lesson.workKey !== identity.workKey ||
    lesson.sourceKey !== identity.sourceKey ||
    lesson.editionKey !== identity.editionKey ||
    lesson.language !== identity.language
  )
    return [];
  const plan = personalStudyFor(lesson);
  if (!plan.supported || plan.fingerprint !== identity.personalFingerprint)
    return [];
  const blocks = lesson.body.sections.flatMap((s) => s.blocks);
  return manifest.questions.filter((q) => {
    const step = plan.steps.find((s) => s.index === q.stepIndex);
    const block = blocks.find((b) => b.id === q.blockId);
    return (
      step?.fingerprint === q.stepFingerprint &&
      step.blockIds.includes(q.blockId) &&
      !!block &&
      text8(block) === q.blockTextHash &&
      pilotBlockReferencesHash(block) === q.blockReferencesHash
    );
  });
}
export function validPilotScriptureSource(
  lesson: Lesson & { scriptureReadings?: StudyScriptureReading[] },
  source: {
    blockId: string;
    blockTextHash: string;
    quote: string;
    sourceUrl: string;
    verseRef: string;
    type: string;
    seed: number;
    scripture: PilotScriptureProof;
  },
) {
  const proof = source.scripture;
  if (proof.pilot !== manifest.version) return false;
  const selected = pilotReadingSelections(lesson).find(
    (q) =>
      q.bookKey === proof.bookKey &&
      q.chapter === proof.chapter &&
      q.verse === proof.verse &&
      q.type === source.type &&
      q.seed === source.seed &&
      q.blockId === source.blockId &&
      q.blockTextHash === source.blockTextHash &&
      q.chapterHash === proof.chapterHash,
  );
  if (!selected) return false;
  const reading = lesson.scriptureReadings?.find(
    (r) =>
      r.stepIndex === selected.stepIndex &&
      r.work === selected.work &&
      r.editionKey === selected.editionKey &&
      r.language === selected.language &&
      r.bookKey === selected.bookKey &&
      r.chapter === selected.chapter &&
      r.chapterHash === selected.chapterHash,
  );
  const verse = reading?.verses.find((v) => v.number === selected.verse);
  const key = selected.bookKey.slice(4);
  return (
    !!verse &&
    source.quote === verse.text &&
    source.verseRef ===
      `${reading!.bookName} ${selected.chapter}:${selected.verse}` &&
    source.sourceUrl ===
      `https://www.churchofjesuschrist.org/study/scriptures/pgp/${key}/${selected.chapter}?lang=nld&id=p${selected.verse}#p${selected.verse}`
  );
}
export function pilotQuestionSources(
  lesson: Lesson & { scriptureReadings?: StudyScriptureReading[] },
) {
  return pilotReadingSelections(lesson).flatMap((q) => {
    const reading = lesson.scriptureReadings?.find(
      (r) =>
        r.stepIndex === q.stepIndex &&
        r.bookKey === q.bookKey &&
        r.chapter === q.chapter &&
        r.chapterHash === q.chapterHash,
    );
    const verse = reading?.verses.find((v) => v.number === q.verse);
    if (!reading || !verse) return [];
    return [
      {
        blockId: q.blockId,
        blockTextHash: q.blockTextHash,
        quote: verse.text,
        verseRef: `${reading.bookName} ${q.chapter}:${q.verse}`,
        sourceUrl: `https://www.churchofjesuschrist.org/study/scriptures/pgp/${q.bookKey.slice(4)}/${q.chapter}?lang=nld&id=p${q.verse}#p${q.verse}`,
        seed: q.seed,
        type: q.type as "FILL_BLANK" | "WORD_BANK" | "TRUE_FALSE",
        scripture: {
          pilot: manifest.version as PilotScriptureProof["pilot"],
          bookKey: q.bookKey,
          chapter: q.chapter,
          verse: q.verse,
          chapterHash: q.chapterHash,
        },
      },
    ];
  });
}
