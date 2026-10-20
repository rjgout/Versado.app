import { prisma } from "@/lib/db";
import { getStudyReader, type StudyReaderDTO } from "./reader";
import { safePersonalPlan } from "./personalStudyOverrides";
import { personalStudyView, type PersonalStudyView } from "./personalStudy";
import { getStepProgress, type StepProgressState } from "./stepProgress";
import { getLessonWeekContext, type WeekContext } from "./weekContext";

export interface PersonalStudyPageData {
  /** Programmanaam en jaar uit de collectie en periode, voor de kop van het weekoverzicht. */
  program: { name: string; year: number | null };
  reader: StudyReaderDTO;
  /** null: dit programma of deze les heeft geen persoonlijke studieroute (bv. FSY); de lezer toont dan de volledige les. */
  view: PersonalStudyView | null;
  progress: StepProgressState | null;
  week: WeekContext;
}

/** Eén server-aanroep voor Vrije studie, het stappenoverzicht en een stap: dezelfde revisie, hetzelfde plan. */
export async function loadPersonalStudyPage(
  actor: { id: string; isAdmin: boolean },
  lessonId: string,
  collectionId: string,
  sessionKey: string,
): Promise<PersonalStudyPageData | null> {
  const reader = await getStudyReader(actor, lessonId, collectionId, sessionKey);
  if (!reader) return null;
  const plan = safePersonalPlan(reader.lesson);
  const [progress, week, meta] = await Promise.all([
    getStepProgress(actor, reader.lesson, plan),
    getLessonWeekContext(actor, { lessonId: reader.lesson.lessonId, collectionId: reader.lesson.collectionId }),
    prisma.studyLessonEdition.findUnique({
      where: { id: reader.lesson.editionId },
      select: { collection: { select: { name: true } }, lesson: { select: { period: { select: { year: true } } } } },
    }),
  ]);
  return { program: { name: meta?.collection.name ?? "", year: meta?.lesson.period.year ?? null }, reader, view: personalStudyView(plan), progress, week };
}
