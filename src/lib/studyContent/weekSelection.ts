import { PERSONAL_STUDY_STEPS } from "./personalStudy";

/** Het minimale weekgegeven dat de resolver nodig heeft (een gepubliceerde CFM-les van één collectie, in programmavolgorde). */
export interface SelectableWeek {
  lessonKey: string;
  startsOn: string | null;
  endsOnExclusive: string | null;
  read: boolean;
  stepsDone: number;
}

/** Waarom de hervatweek deze week is; de interface noemt alleen een kalenderweek "deze week". */
export type ResumeReason = "calendar" | "selected" | "studied";

export interface WeekSelection<W extends SelectableWeek> {
  /** De werkelijk actuele gepubliceerde week op de kalenderdag van de gebruiker; null als er geen is (of ze niet eenduidig is). */
  calendar: W | null;
  /** De week die de gebruiker zelf het laatst opende (studiecontext), mits nog gepubliceerd in deze collectie. */
  selected: W | null;
  /** De week waarin de gebruiker logisch verder kan; null als er geen betrouwbare hervatweek is (dan volgt een neutraal weekoverzicht). */
  resume: W | null;
  resumeReason: ResumeReason | null;
}

/** Een week is af als de les bewust als gelezen is gemarkeerd of alle zes stappen zijn afgerond. */
export const isWeekDone = (week: Pick<SelectableWeek, "read" | "stepsDone">) => week.read || week.stepsDone >= PERSONAL_STUDY_STEPS;

/** Is er in deze week daadwerkelijk gestudeerd (een stap afgerond of de les als gelezen gemarkeerd)? */
export const hasStudyActivity = (week: Pick<SelectableWeek, "read" | "stepsDone">) => week.read || week.stepsDone > 0;

/**
 * De kalenderweek: de ene gepubliceerde week waarvan [startsOn, endsOnExclusive) de kalenderdag van de gebruiker bevat
 * (`today` komt uit `userDayKey`, dus uit de eigen tijdzone). Een niet-gepubliceerde actuele week bestaat hier niet; bij
 * overlappende weken geldt er geen kalenderweek in plaats van een willekeurige keuze.
 */
export function calendarWeekOf<W extends SelectableWeek>(weeks: readonly W[], today: string): W | null {
  const matches = weeks.filter((w) => w.startsOn && w.endsOnExclusive && w.startsOn <= today && today < w.endsOnExclusive);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Eén regel voor Vandaag, de cursuskaart in Leren, de API en het weekpad. CFM is deelname, geen inhaalprogramma:
 * 1. de kalenderweek, zo die bestaat;
 * 2. anders de week die de gebruiker zelf het laatst opende (bewust geselecteerd);
 * 3. anders de laatste week waarin daadwerkelijk is gestudeerd;
 * 4. anders geen hervatweek (`resume` is null): de interface toont dan een neutraal overzicht van de beschikbare weken.
 * Nooit de oudste onafgeronde week: dat zou een niet-gestudeerde week als achterstand presenteren. Een hervatweek is
 * alleen "deze week" als hij de kalenderweek is (`resumeReason === "calendar"`).
 */
export function resolveWeekSelection<W extends SelectableWeek>(
  weeks: readonly W[],
  input: { today: string; selectedLessonKey?: string | null },
): WeekSelection<W> {
  if (!weeks.length) return { calendar: null, selected: null, resume: null, resumeReason: null };
  const calendar = calendarWeekOf(weeks, input.today);
  const selected = (input.selectedLessonKey && weeks.find((w) => w.lessonKey === input.selectedLessonKey)) || null;
  if (calendar) return { calendar, selected, resume: calendar, resumeReason: "calendar" };
  if (selected) return { calendar, selected, resume: selected, resumeReason: "selected" };
  const studied = [...weeks].reverse().find(hasStudyActivity) ?? null;
  if (studied) return { calendar, selected, resume: studied, resumeReason: "studied" };
  return { calendar, selected, resume: null, resumeReason: null };
}
