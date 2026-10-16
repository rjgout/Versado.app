"use client";

import CoursePathHeader from "@/components/reading/CoursePathHeader";
import ReadingPath from "@/components/reading/ReadingPath";
import type { PathChapter } from "@/lib/readingPath";

interface Props {
  /** Ingang naar Samen studeren, naast de titel (zie StudyTogetherButton). */
  studyAction?: React.ReactNode;
  courseName: string;
  /** De eerste stap die nog niet af is (de bestaande voortgangscursor), of null als alles af is. */
  today: { id: string } | null;
  /** Elk schriftuurlijk hoofdstuk met zijn echte stappen en statussen, in cursusvolgorde. */
  chapters: PathChapter[];
  /** "hoofdstukken", of "afdelingen" bij Leer en Verbonden (zie src/lib/chapterTerm.ts). */
  unitPlural?: string;
}

// Stap voor stap: hoofdstukken met de echte leesgedeelten (stappen) erin, in vaste volgorde.
export default function ReadingCourseView({ today, chapters, courseName, unitPlural = "hoofdstukken", studyAction }: Props) {
  const allDone = chapters.length > 0 && chapters.every((chapter) => chapter.completedLessons === chapter.lessonCount);
  // Voltooide hoofdstukken, niet het nummer van het hoofdstuk waar je nu bezig bent.
  const completedChapters = chapters.filter((chapter) => chapter.lessonCount > 0 && chapter.completedLessons === chapter.lessonCount).length;
  const anyProgress = chapters.some((chapter) => chapter.read !== "UNREAD" || chapter.exercisesAnswered > 0);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 sm:gap-8">
      <CoursePathHeader courseName={courseName} studyAction={studyAction} completed={completedChapters} total={chapters.length} unitPlural={unitPlural} anyProgress={anyProgress} allDone={allDone} />
      <ReadingPath chapters={chapters} currentStepId={today?.id ?? null} />
    </div>
  );
}
