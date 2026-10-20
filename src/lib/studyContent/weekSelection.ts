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
export type ResumeReason = "calendar" | "selected" | "unfinished" | "last";

export interface WeekSelection<W extends SelectableWeek> {
  /** De werkelijk actuele gepubliceerde week op de kalenderdag van de gebruiker; null als er geen is (of ze niet eenduidig is). */
  calendar: W | null;
  /** De week die de gebruiker zelf het laatst opende (studiecontext), mits nog gepubliceerd in deze collectie. */
  selected: W | null;
  /** De week waarin de gebruiker logisch verder kan; null alleen zonder gepubliceerde weken. */
  resume: W | null;
  resumeReason: ResumeReason | null;
}

/** Een week is af als de les bewust als gelezen is gemarkeerd of alle zes stappen zijn afgerond. */
export const isWeekDone = (week: Pick<SelectableWeek, "read" | "stepsDone">) => week.read || week.stepsDone >= PERSONAL_STUDY_STEPS;

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
 * Eén regel voor kaart ("Ga verder"), API en weekleerlijn:
 * 1. de kalenderweek, zo die bestaat;
 * 2. anders de week die de gebruiker zelf het laatst opende;
 * 3. anders de eerste week die nog niet af is;
 * 4. anders (alles af) de laatste week.
 * Een hervatweek is dus nooit "deze week" tenzij hij de kalenderweek is (`resumeReason === "calendar"`).
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
  const unfinished = weeks.find((w) => !isWeekDone(w));
  if (unfinished) return { calendar, selected, resume: unfinished, resumeReason: "unfinished" };
  return { calendar, selected, resume: weeks[weeks.length - 1], resumeReason: "last" };
}
