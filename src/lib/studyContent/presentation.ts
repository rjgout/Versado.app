export function lessonBase(lessonId: string, collectionId: string) {
  return `/study-lesson/${encodeURIComponent(lessonId)}/${encodeURIComponent(collectionId)}`;
}
export function formatWeekPeriod(startsOn: string | null, endsOnExclusive: string | null, locale: string): string | null {
  if (!startsOn || !endsOnExclusive) return null;
  const start = new Date(`${startsOn}T00:00:00Z`);
  const end = new Date(new Date(`${endsOnExclusive}T00:00:00Z`).getTime() - 86_400_000);
  try {
    // ICU/CLDR gebruikt per runtime andere dunne/vaste spaties; dezelfde tekst
    // op server en browser voorkomt hydratatiefouten bij maand-/jaargrenzen.
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).formatRange(start, end).replace(/[\u00a0\u2009\u202f]/g, " ");
  } catch {
    return `${startsOn} – ${end.toISOString().slice(0, 10)}`;
  }
}
