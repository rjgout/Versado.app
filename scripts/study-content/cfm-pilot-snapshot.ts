// Alleen een readonly bronrapport/test: dit bewijst geen publicatie of beschikbaarheid in productie.
import pgp from "../../prisma/pgpContent.json";
import { chapterEvidenceHash } from "../../src/lib/references/evidence";
import {
  pilotReadingSelections,
  type StudyScriptureReading,
} from "../../src/lib/studyContent/pilotReadings";
import type { ExerciseLesson } from "../../src/lib/studyContent/exercisePlan";
export function snapshotPilotReadings(
  lesson: ExerciseLesson,
): StudyScriptureReading[] {
  const selections = pilotReadingSelections(lesson);
  const groups = new Map<string, StudyScriptureReading>();
  for (const selected of selections) {
    const slug = selected.bookKey === "pgp/moses" ? "mozes" : "abraham";
    const book = pgp.find((b) => b.slug === slug)!;
    const chapter = book.chapters.find((c) => c.number === selected.chapter)!;
    const verses = chapter.verses.map((text, i) => ({
      id: `snapshot:${selected.bookKey}:${chapter.number}:${i + 1}`,
      number: i + 1,
      text,
    }));
    if (
      verses.length !== selected.verseCount ||
      chapterEvidenceHash(verses) !== selected.chapterHash
    )
      throw new Error("Pilotbron wijkt af van gecontroleerde snapshot");
    const key = `${selected.stepIndex}:${selected.bookKey}:${selected.chapter}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        stepIndex: selected.stepIndex,
        collectionId: "snapshot:pgp:nl",
        chapterId: `snapshot:${selected.bookKey}:${selected.chapter}`,
        work: "pgp",
        editionKey: "pgp",
        language: "nl",
        bookKey: selected.bookKey,
        bookName: book.name,
        chapter: selected.chapter,
        chapterHash: selected.chapterHash,
        verses: [],
      };
      groups.set(key, group);
    }
    if (!group.verses.some((v) => v.number === selected.verse))
      group.verses.push(verses[selected.verse - 1]);
  }
  return [...groups.values()].sort((a, b) => a.stepIndex - b.stepIndex);
}
