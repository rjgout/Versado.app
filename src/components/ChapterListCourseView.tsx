"use client";

import ChapterPath from "@/components/reading/ChapterPath";
import CoursePathHeader from "@/components/reading/CoursePathHeader";
import { completedCount, type ChapterItem } from "@/lib/readingCourses";

interface Props {
  /** Ingang naar Samen studeren, naast de titel (zie StudyTogetherButton). */
  studyAction?: React.ReactNode;
  courseId: string;
  courseName: string;
  chapters: ChapterItem[];
  // Hoofdstuk voor hoofdstuk volgt een vaste volgorde (elk hoofdstuk vergrendeld tot het vorige is afgerond);
  // Vrije keuze is expliciet bedoeld om in elke volgorde te doen, dus daar mag nooit iets op slot.
  sequential: boolean;
  /** Het hoofdstuk dat nu aan de beurt is (alleen vaste volgorde). */
  todayId: string | null;
  todayMinutes: number;
  todayXp: number;
  defaultOpenBook: string | null;
  /** "hoofdstukken", of "afdelingen" bij Leer en Verbonden (zie src/lib/chapterTerm.ts). */
  unitPlural: string;
}

// Hoofdstuk voor hoofdstuk en Vrije keuze: dezelfde visuele leespadfamilie als Stap voor stap (kaarten, miniaturen,
// verbindingen), gegroepeerd onder inklapbare boeken. Lees- en oefenvoortgang zijn gedeeld over alle routes (zie
// ContentProgress); dit component bepaalt alleen de presentatie, niet de afronding, volgorde of vergrendeling.
export default function ChapterListCourseView({ studyAction, courseId, courseName, chapters, sequential, todayId, todayMinutes, todayXp, defaultOpenBook, unitPlural }: Props) {
  const completed = completedCount(chapters);
  const allDone = chapters.length > 0 && completed === chapters.length;
  const anyProgress = chapters.some((chapter) => chapter.read !== "UNREAD" || chapter.exercisesAnswered > 0);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 sm:gap-8">
      <CoursePathHeader courseName={courseName} studyAction={studyAction} completed={completed} total={chapters.length} unitPlural={unitPlural} anyProgress={anyProgress} allDone={allDone} />
      <ChapterPath
        courseId={courseId}
        chapters={chapters}
        sequential={sequential}
        todayId={todayId}
        todayMinutes={todayMinutes}
        todayXp={todayXp}
        defaultOpenBook={defaultOpenBook}
        unitPlural={unitPlural}
      />
    </div>
  );
}
