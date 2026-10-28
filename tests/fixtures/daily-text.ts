// Alleen synthetische content in de eigen wegwerpdatabase; geen officiële lesinhoud.
import { prisma } from "../../src/lib/db";
import { CFM_VOLUMES } from "../../src/lib/studyContent/cfmVolumes";
import { appendStudyRevision } from "../../src/lib/studyContent/revisions";

export function dailyTextTestEnvironment() {
  const url = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
  const base = new URL(process.env.CONTENT_ACCESS_TEST_BASE_URL ?? "http://invalid");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== url.href || base.hostname !== "127.0.0.1") throw new Error("Uitsluitend de eigen dagtekst-testdatabase");
  return base.origin;
}
const text = (value: string) => [{ type: "text" as const, text: value }];
export const QUOTE = "Synthetisch citaat uit de actuele weekles, uitsluitend bedoeld om de juiste herkomst van een dagtekst te testen.";
export async function dailyTextFixture() {
  dailyTextTestEnvironment();
  const volume = CFM_VOLUMES.find(v => v.year === 2026)!;
  const monday = new Date(); monday.setUTCHours(0, 0, 0, 0); monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const day = (offset: number) => new Date(monday.getTime() + offset * 86400000);
  const actor = await prisma.user.upsert({ where: { email: "publisher@daily-text.test.invalid" }, update: {}, create: { email: "publisher@daily-text.test.invalid", handle: "Dagtekstbeheer", discriminator: "00", passwordHash: "synthetic", isAdmin: true } });
  async function collection(id: string, work: string, name: string, kind: "SCRIPTURE" | "STUDY_PROGRAM" | "OTHER", language = "nl", editionKey = "daily-test") {
    await prisma.contentWork.upsert({ where: { key: work }, update: {}, create: { key: work, kind } });
    return prisma.contentCollection.upsert({ where: { work_editionKey_language: { work, editionKey, language } }, update: { enabled: true, visibleToUsers: true, publicationState: "PUBLISHED" }, create: { id, slug: id, work, name, icon: "", language, editionKey, visibleToUsers: true, enabled: true, publicationState: "PUBLISHED" } });
  }
  const own = await collection("daily-text-own", "daily-text-scripture", "Eigen Schriftbron", "SCRIPTURE");
  const ownEnglish = await collection("daily-text-own-en", "daily-text-scripture", "Own scripture source", "SCRIPTURE", "en");
  const other = await collection("daily-text-other", "daily-text-other-work", "Andere Schriftbron", "SCRIPTURE");
  const empty = await collection("daily-text-empty", "daily-text-empty-work", "Lege bron", "OTHER");
  const bible = await collection("daily-text-otb", "old-testament", "Synthetische OTB", "SCRIPTURE", "nl", "otb");
  const cfm = await collection(volume.collectionId, volume.workKey, "CFM synthetische les", "STUDY_PROGRAM", "nl", volume.editionKey);
  async function verse(collectionId: string, key: string, name: string, number: number, value: string) {
    const existing = await prisma.book.findUnique({ where: { slug: `daily-text-${key}` }, include: { chapters: true } });
    if (existing) return existing.chapters[0];
    const book = await prisma.book.create({ data: { slug: `daily-text-${key}`, key, name, order: 1, contentCollectionId: collectionId } });
    return prisma.chapter.create({ data: { bookId: book.id, number: 1, order: 1, verses: { create: { number, text: value } } } });
  }
  const ownChapter = await verse(own.id, "daily-own", "Eigen boek", 1, "ALLEEN-EIGEN-BRON");
  await verse(ownEnglish.id, "daily-own-en", "Own book", 1, "ONLY-OWN-ENGLISH-SOURCE");
  const otherChapter = await verse(other.id, "daily-other", "Ander boek", 1, "ALLEEN-ANDERE-BRON");
  const bibleChapter = await verse(bible.id, "jer", "Jeremia", 5, "ALLEEN-ACTUELE-CFM-SCHRIFTTEKST");
  const period = await prisma.studyPeriod.upsert({ where: { workKey_sourceKey: { workKey: volume.workKey, sourceKey: "daily-text-test" } }, update: {}, create: { workKey: volume.workKey, sourceKey: "daily-text-test", label: "Synthetische testweken", year: 2026 } });
  async function lesson(key: string, offset: number, published: boolean) {
    const existing = await prisma.studyLessonEdition.findUnique({ where: { id: `daily-text-${key}` } });
    if (existing) return existing;
    const lesson = await prisma.studyLesson.create({ data: { workKey: volume.workKey, periodId: period.id, sourceKey: `daily-text-${key}`, order: offset + 10, startsOn: day(offset), endsOnExclusive: day(offset + 7) } });
    const edition = await prisma.studyLessonEdition.create({ data: { id: `daily-text-${key}`, lessonId: lesson.id, collectionId: cfm.id, workKey: volume.workKey, slug: `daily-text-${key}` } });
    const current = offset === 0;
    const revision = await appendStudyRevision(actor, edition.id, { schemaVersion: 1, title: `Synthetische weekles ${key}`, body: { schemaVersion: 1, sections: [{ id: "body", blocks: [
      { type: "quote", id: "day-quote", content: text(current ? QUOTE : `ONJUISTE-WEEK-${key}: dit volledige synthetische citaat mag nooit als tekst voor de actuele week gekozen worden.`) },
      { type: "reference", id: "week-ref", label: "Jeremia 1:5", target: { workKey: "old-testament", editionKey: "otb", language: "nl", sourceKey: "otb:jer:1:5" } },
    ] }] }, sourceMetadata: { sourceKey: `daily-text-${key}` }, rightsMetadata: { holder: "Synthetische tests", permission: "Uitsluitend geïsoleerde tests" } });
    // Testfixture publicatiepointer; de inhoud is via dezelfde immutable validatie opgebouwd als productie.
    return prisma.studyLessonEdition.update({ where: { id: edition.id }, data: published ? { publishedRevisionId: revision.id } : { draftRevisionId: revision.id } });
  }
  const current = await lesson("current", 0, true);
  const previous = await lesson("previous", -7, true);
  const next = await lesson("next", 7, true);
  await lesson("draft", 0, false);
  await prisma.contentSwitcherSettings.upsert({ where: { id: "singleton" }, update: { enabled: true }, create: { id: "singleton", enabled: true } });
  return { own, other, empty, bible, cfm, ownChapter, otherChapter, bibleChapter, current, previous, next, monday, day };
}
