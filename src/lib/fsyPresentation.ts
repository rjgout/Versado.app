import type { TFunction } from "@/lib/i18n/core";
import { getLanguage } from "@/lib/languages";

export const FSY_CATEGORY_KEYS = {
  INTRO: "courseViews.fsy.intro",
  FAST_SUNDAY: "courseViews.fsy.fastSunday",
  SECOND_SUNDAY: "courseViews.fsy.secondSunday",
  THIRD_SUNDAY: "courseViews.fsy.thirdSunday",
  LAST_SUNDAY_YOUNG_WOMEN: "courseViews.fsy.lastSundayYoungWomen",
  LAST_SUNDAY_AARONIC_PRIESTHOOD: "courseViews.fsy.lastSundayAaronic",
  ACTIVITY: "courseViews.fsy.activity",
  OTHER: "courseViews.fsy.other",
} as const;

/** Presentatie van echte FSY-maandgegevens; geen kalenderkeuze of weekindeling. */
export function fsyLessonMetadata(
  lesson: { year: number | null; month: number | null; category: string | null },
  language: string,
  t: TFunction,
): string {
  const { year, month, category } = lesson;
  const categoryKey = category && Object.hasOwn(FSY_CATEGORY_KEYS, category)
    ? FSY_CATEGORY_KEYS[category as keyof typeof FSY_CATEGORY_KEYS]
    : "courseViews.fsy.lesson";
  let period = year == null ? null : String(year);
  if (year != null && month != null && Number.isInteger(year) && year >= 1 && year <= 9999 && Number.isInteger(month) && month >= 1 && month <= 12) {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, 1);
    period = new Intl.DateTimeFormat(getLanguage(language).intlLocale, {
      month: "long", year: "numeric", timeZone: "UTC",
    }).format(date);
  }
  return [period, t(categoryKey)].filter(Boolean).join(" · ");
}
