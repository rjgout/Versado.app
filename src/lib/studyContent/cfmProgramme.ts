import { CFM_VOLUMES, type CfmScripture, type CfmVolume } from "./cfmVolumes";

/**
 * Het permanente programma "Kom dan en volg Mij": één gebruikersgerichte identiteit boven de jaargangscollecties
 * (cfmVolumes.ts). Alleen presentatie en selectie; lesidentiteit, revisies, voortgang en annotaties blijven bij de
 * jaargangscollectie zelf (docs/CFM-DOORLOPEND.md).
 */
export const CFM_PROGRAMME_KEY = "kom-dan-en-volg-mij";
/** Geen jaartal of schriftuuronderdeel in de primaire naam. */
export const CFM_PROGRAMME_NAME = "Kom dan en volg Mij";

/** Eén kalendermaand na het einde van de officiële lesweek verhuist een les naar het archief. */
export const CFM_ARCHIVE_MONTHS = 1;

export function cfmVolumeOfWork(workKey: string | null | undefined): CfmVolume | undefined {
  return workKey ? CFM_VOLUMES.find((v) => v.workKey === workKey) : undefined;
}
export function cfmVolumeOfCollection(collection: { id: string; work?: string | null }): CfmVolume | undefined {
  return CFM_VOLUMES.find((v) => v.collectionId === collection.id) ?? (collection.work ? cfmVolumeOfWork(collection.work) : undefined);
}
export const isCfmVolumeCollection = (collection: { id: string; work?: string | null }) => cfmVolumeOfCollection(collection) !== undefined;

/** De jaargangen van het programma in één taal, chronologisch. */
export function cfmProgrammeVolumes(language: string): CfmVolume[] {
  return CFM_VOLUMES.filter((v) => v.language === language).sort((a, b) => a.year - b.year);
}

/** De collectie die de programmacursussen draagt; voor een collectie buiten het programma is dat de collectie zelf. */
export function cfmAnchorCollectionId(collection: { id: string; work?: string | null }): string {
  const volume = cfmVolumeOfCollection(collection);
  return volume ? cfmProgrammeVolumes(volume.language)[0].collectionId : collection.id;
}
export const cfmAnchorOfCollectionId = (collectionId: string) => cfmAnchorCollectionId({ id: collectionId });

/** Alle jaargangscollecties van het programma waartoe deze collectie behoort (zichzelf als ze er niet in zit). */
export function cfmProgrammeCollectionIds(collection: { id: string; work?: string | null }): string[] {
  const volume = cfmVolumeOfCollection(collection);
  return volume ? cfmProgrammeVolumes(volume.language).map((v) => v.collectionId) : [collection.id];
}

export const CFM_SCRIPTURE_LABEL_KEY: Readonly<Record<CfmScripture, string>> = {
  "old-testament": "cfmProgramme.scripture.oldTestament",
  "new-testament": "cfmProgramme.scripture.newTestament",
  "book-of-mormon": "cfmProgramme.scripture.bookOfMormon",
  "doctrine-and-covenants": "cfmProgramme.scripture.doctrineAndCovenants",
};

// ---- Archiefregel -------------------------------------------------------------------------------------------------
// Datums zijn kalenderdagen ("YYYY-MM-DD", zoals userDayKey ze levert); er is hier geen tijdzonerekensom nodig.

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Telt kalendermaanden bij een dag op; een te lange dag valt terug op de laatste dag van de doelmaand (31 jan + 1 = 28/29 feb). */
export function addMonthsToDay(day: string, months: number): string {
  const m = DAY.exec(day);
  if (!m) throw new Error("CFM_DAY_FORMAT");
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dd = Math.min(Number(m[3]), last);
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/**
 * De eerste kalenderdag waarop een les gearchiveerd is: één kalendermaand na het einde van de officiële lesweek.
 * `endsOnExclusive` is de dag na de laatste lesdag; de les (einde 4 januari) blijft dus zichtbaar t/m 4 februari en is
 * gearchiveerd vanaf 5 februari. Een les zonder officiële einddatum wordt nooit gearchiveerd.
 */
export function archiveStartsOn(endsOnExclusive: string | null): string | null {
  return endsOnExclusive ? addMonthsToDay(endsOnExclusive, CFM_ARCHIVE_MONTHS) : null;
}
export function isWeekArchived(week: { endsOnExclusive: string | null }, today: string): boolean {
  const start = archiveStartsOn(week.endsOnExclusive);
  return start !== null && today >= start;
}
/** Verdeelt weken in het actuele aanbod (huidige, recente en toekomstige weken) en het archief; verwijdert niets. */
export function splitByArchive<W extends { endsOnExclusive: string | null }>(weeks: readonly W[], today: string): { current: W[]; archived: W[] } {
  const current: W[] = [];
  const archived: W[] = [];
  for (const week of weeks) (isWeekArchived(week, today) ? archived : current).push(week);
  return { current, archived };
}

export interface ArchiveYearGroup<W> { year: number; scripture: CfmScripture | null; workKey: string; weeks: W[] }
/**
 * Groepeert gearchiveerde weken op officiële jaargang (jaar + schriftuuronderdeel), recentste jaargang eerst en binnen een
 * jaargang chronologisch. Alleen jaargangen met echt gearchiveerde lessen komen voor: een lege of toekomstige jaargang niet.
 */
export function groupArchiveByYear<W extends { workKey: string; startsOn: string | null; order: number }>(weeks: readonly W[]): ArchiveYearGroup<W>[] {
  const groups = new Map<string, ArchiveYearGroup<W>>();
  for (const week of weeks) {
    const volume = cfmVolumeOfWork(week.workKey);
    if (!volume) continue;
    const group = groups.get(week.workKey) ?? { year: volume.year, scripture: volume.scripture, workKey: week.workKey, weeks: [] };
    group.weeks.push(week);
    groups.set(week.workKey, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, weeks: [...g.weeks].sort((a, b) => (a.startsOn ?? "").localeCompare(b.startsOn ?? "") || a.order - b.order) }))
    .sort((a, b) => b.year - a.year);
}
