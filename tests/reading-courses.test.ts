import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isActivityRoute } from "../src/lib/focusMode";
import { classifyContentRoute } from "../src/lib/contentRouting";
import {
  chapterCardState,
  chapterLocks,
  completedCount,
  defaultOpenBookKey,
  groupByBook,
  isReadingPathType,
  READING_PATH_TYPES,
  todayChapterId,
  usesChapterPath,
  type ChapterItem,
} from "../src/lib/readingCourses";

// Eén visuele familie voor Stap voor stap, Hoofdstuk voor hoofdstuk en Vrije keuze: de gedeelde regels (vergrendeling,
// aan-de-beurt, boekgroepering, standaard geopend boek) zijn puur en getest, de componenten via broncontracten.
// Het gedrag in de browser (inclusief "Vrije keuze schrijft niets weg") staat in scripts/reading-path/e2e-courses.mjs.

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

function chapter(id: string, book: string, number: number, extra: Partial<ChapterItem> = {}): ChapterItem {
  return { id, number, bookKey: `bofm/${book}`, bookName: book, verseCount: 10, read: "UNREAD", exercisesAnswered: 0, exercisesTotal: 12, exerciseScore: null, completed: false, ...extra };
}
const list = [
  chapter("a1", "1-ne", 1, { completed: true, read: "READ" }),
  chapter("a2", "1-ne", 2, { completed: true, read: "READ" }),
  chapter("a3", "1-ne", 3),
  chapter("b1", "2-ne", 1),
  chapter("b2", "2-ne", 2),
  chapter("c1", "alma", 1),
];

test("alleen de drie schriftuurlijke leescursussen krijgen het gedeelde leespad", () => {
  assert.deepEqual([...READING_PATH_TYPES], ["READING_LESSONS", "FRONT_TO_BACK", "FREE_CHOICE"]);
  for (const type of READING_PATH_TYPES) assert.ok(isReadingPathType(type));
  for (const type of ["PODCAST", "KIDS", "INTRO", "FSY", "", "reading_lessons"]) assert.equal(isReadingPathType(type), false, type);
  assert.deepEqual([usesChapterPath("FRONT_TO_BACK"), usesChapterPath("FREE_CHOICE"), usesChapterPath("READING_LESSONS")], [true, true, false]);
});

test("Hoofdstuk voor hoofdstuk: vaste volgorde, alles na het eerste onvoltooide hoofdstuk is vergrendeld", () => {
  const locks = chapterLocks(list, true);
  assert.deepEqual(list.map((c) => locks.get(c.id)), [false, false, false, true, true, true]);
});

test("Vrije keuze: nooit een slot, ook niet als je nog niet bent begonnen", () => {
  const fresh = list.map((c) => ({ ...c, completed: false, read: "UNREAD" as const }));
  const locks = chapterLocks(fresh, false);
  assert.ok(fresh.every((c) => locks.get(c.id) === false));
  assert.ok(fresh.every((c) => chapterCardState(c, { locked: locks.get(c.id)!, current: false }) === "open"));
});

test("een hoofdstuk dat via een andere route af is, staat als voltooid en ontgrendelt het volgende", () => {
  // a1 is via Stap voor stap afgerond: de gedeelde status (completed) is de enige bron
  const chapters = [chapter("x1", "1-ne", 1, { completed: true }), chapter("x2", "1-ne", 2)];
  const locks = chapterLocks(chapters, true);
  assert.equal(chapterCardState(chapters[0], { locked: locks.get("x1")!, current: false }), "done");
  assert.equal(locks.get("x2"), false);
});

test("kaartstatus: huidig gaat voor af; begonnen is herkenbaar; vergrendeld alleen met een slot", () => {
  const base = chapter("s", "1-ne", 5);
  assert.equal(chapterCardState(base, { locked: false, current: true }), "current");
  assert.equal(chapterCardState({ ...base, read: "READING" }, { locked: false, current: false }), "started");
  assert.equal(chapterCardState({ ...base, exercisesAnswered: 3 }, { locked: false, current: false }), "started");
  assert.equal(chapterCardState({ ...base, completed: true }, { locked: false, current: false }), "done");
  assert.equal(chapterCardState(base, { locked: true, current: false }), "locked");
});

test("aan de beurt: de cursor als die nog kan, anders het eerste onvoltooide hoofdstuk; nooit een vergrendeld hoofdstuk", () => {
  const locks = chapterLocks(list, true);
  assert.equal(todayChapterId(list, "a3", locks), "a3");
  assert.equal(todayChapterId(list, null, locks), "a3");
  assert.equal(todayChapterId(list, "a1", locks), "a3", "een cursor op een afgerond hoofdstuk valt terug");
  assert.equal(todayChapterId(list, "b2", locks), "a3", "een cursor op een vergrendeld hoofdstuk wordt genegeerd");
  assert.equal(todayChapterId(list.map((c) => ({ ...c, completed: true })), "a1", chapterLocks(list.map((c) => ({ ...c, completed: true })), true)), null);
});

test("boekgroepering behoudt de volgorde van de cursus en telt voltooide hoofdstukken, niet de positie", () => {
  const groups = groupByBook(list);
  assert.deepEqual(groups.map((g) => [g.key, g.chapters.length]), [["bofm/1-ne", 3], ["bofm/2-ne", 2], ["bofm/alma", 1]]);
  assert.equal(completedCount(list), 2);
  assert.equal(groupByBook([]).length, 0);
  // een collectie met één boek is één groep
  assert.equal(groupByBook(list.filter((c) => c.bookName === "alma")).length, 1);
  // zonder Book.key groepeert de naam
  assert.equal(groupByBook([{ bookKey: null, bookName: "X" }, { bookKey: null, bookName: "X" }]).length, 1);
});

test("standaard geopend boek: het eerste bekende hoofdstuk in volgorde van voorkeur; zonder positie alles ingeklapt", () => {
  const groups = groupByBook(list);
  // Hoofdstuk voor hoofdstuk: het boek van het hoofdstuk aan de beurt
  assert.equal(defaultOpenBookKey(groups, ["a3"]), "bofm/1-ne");
  // Vrije keuze: de positie in Stap voor stap gaat voor het laatst gebruikte hoofdstuk
  assert.equal(defaultOpenBookKey(groups, ["c1", "a1"]), "bofm/alma");
  assert.equal(defaultOpenBookKey(groups, [null, "b2"]), "bofm/2-ne");
  assert.equal(defaultOpenBookKey(groups, ["bestaat-niet", "a2"]), "bofm/1-ne", "een onbekend hoofdstuk valt terug op het volgende bruikbare");
  // geen bruikbare positie: bruikbaar blijven, alles ingeklapt
  assert.equal(defaultOpenBookKey(groups, []), null);
  assert.equal(defaultOpenBookKey(groups, [null, undefined, "weg"]), null);
  assert.equal(defaultOpenBookKey([], ["a1"]), null);
});

test("Focusmodus: de drie overzichten zijn navigatieschermen (geen activiteit); andere cursussen en lessen blijven zoals ze zijn", () => {
  assert.equal(isActivityRoute("/courses/cursus-1/pad"), false);
  assert.equal(isActivityRoute("/courses/cursus-1"), false);
  assert.equal(isActivityRoute("/lesson/h1"), true, "de les zelf blijft een activiteit");
  // het overzicht en de pad-route horen bij dezelfde cursuspagina voor de contentswitch
  assert.equal(classifyContentRoute("/courses/cursus-1/pad").kind, classifyContentRoute("/courses/cursus-1").kind);
});

test("de pagina's: één gedeelde padroute die alleen de drie ondersteunde typen toelaat, zonder lus", () => {
  const hub = read("src/app/courses/[courseId]/page.tsx");
  assert.match(hub, /if \(isReadingPathType\(course\.type\)\) redirect\(`\/courses\/\$\{course\.id\}\/pad`\);/);
  assert.doesNotMatch(hub, /ChapterListCourseView|getChapterStates|verses: \{ select/, "de cursushub laadt geen hoofdstukken of verzen meer");
  const pad = read("src/app/courses/[courseId]/pad/page.tsx");
  assert.match(pad, /if \(!isReadingPathType\(course\.type\)\) redirect\(`\/courses\/\$\{course\.id\}`\);/);
  assert.match(pad, /course\.type !== "READING_LESSONS"/);
  assert.match(pad, /sequential=\{course\.type === "FRONT_TO_BACK"\}/);
  assert.match(pad, /<LiveRefresh scopes=\{\["courses", "progress"\]\}/);
  // terug vanuit een hoofdstukles gaat naar het juiste overzicht
  assert.match(read("src/app/lesson/[chapterId]/page.tsx"), /route \? `\/courses\/\$\{course\.id\}\/pad` : `\/courses\/\$\{course\.id\}`/);
});

test("de drie leescursussen gebruiken dezelfde gedeelde componenten (geen drie gekopieerde implementaties)", () => {
  const steps = read("src/components/reading/ReadingPath.tsx");
  const chapters = read("src/components/reading/ChapterPath.tsx");
  for (const [name, source] of [["Stap voor stap", steps], ["Hoofdstuk voor hoofdstuk / Vrije keuze", chapters]] as const) {
    assert.match(source, /from "@\/components\/reading\/pathParts"/, name);
    assert.match(source, /<MyStepNav /, name);
    assert.match(source, /\bConnector\b/, name);
    assert.match(source, /\bHeading\b/, name);
  }
  assert.match(steps, /ActiveChapterCard/);
  assert.match(chapters, /ActiveChapterCard/);
  assert.match(steps, /LockedChapterCard/);
  assert.match(chapters, /LockedChapterCard/);
  // de gedeelde kop
  assert.match(read("src/components/ReadingCourseView.tsx"), /CoursePathHeader/);
  assert.match(read("src/components/ChapterListCourseView.tsx"), /CoursePathHeader/);
  // geen eigen kaart-CSS in de hoofdstukpadcomponent: alleen via de gedeelde bouwstenen
  assert.doesNotMatch(chapters, /bg-gradient-to-br from-vs-accent via-vs-accent/);
  assert.doesNotMatch(chapters, /<MediaArtwork/);
});

test("Hoofdstuk voor hoofdstuk toont geen kunstmatige leesgedeelten; Vrije keuze geen slot en geen verplichte volgende stap", () => {
  const chapters = read("src/components/reading/ChapterPath.tsx");
  assert.doesNotMatch(chapters, /StepGrid|StepTile|courseView\.path\.nextStep|startVerse|endVerse/);
  // Vrije keuze: sequential=false → geen vergrendeling, geen "aan de beurt", geen Naar mijn hoofdstuk-knop
  assert.match(chapters, /chapterLocks\(chapters, sequential\)/);
  assert.match(read("src/lib/chapterPathData.ts"), /todayId: null, todayMinutes: 0, todayXp: 0/);
  // één duidelijke leesactie die de bestaande hoofdstukles opent, met de cursus als context
  assert.match(chapters, /`\/lesson\/\$\{chapter\.id\}\?cursus=\$\{courseId\}`/);
  // ingeklapte boeken renderen niets (geen beelden, geen kaarten)
  assert.match(chapters, /\{isOpen && \(/);
});

test("de gegevens: Vrije keuze bepaalt het beginboek alleen lezend en wijzigt nooit voortgang of cursus", () => {
  const data = read("src/lib/chapterPathData.ts");
  // alleen leesqueries in het Vrije-keuzepad: geen create/update/upsert/delete en geen syncCourses/advanceCourseProgress
  const free = data.slice(data.indexOf("if (!sequential)"), data.indexOf("// Hoofdstuk voor hoofdstuk"));
  assert.doesNotMatch(free, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|syncCourses|advanceCourseProgress|markCourseStarted/);
  assert.match(free, /getStepOverview\(db, userId, sibling\.id\)/);
  assert.match(free, /courseLesson\.count/, "geen les, geen positie (en geen synchronisatie)");
  // geen verstekst van de hele cursus, geen query per hoofdstuk
  assert.doesNotMatch(data, /verses: \{ select: \{ text/);
  assert.equal((data.match(/getChapterStates\(/g) ?? []).length, 1);
  assert.match(data, /db\.verse\.findMany\(\{ where: \{ chapterId: todayId \}/, "leestijd alleen voor het hoofdstuk aan de beurt");
});

test("handmatig geopende boeken blijven open: de beginstand komt één keer uit de voortgang", () => {
  const chapters = read("src/components/reading/ChapterPath.tsx");
  assert.match(chapters, /useState<ReadonlySet<string>>\(\(\) => new Set\(defaultOpenBook \? \[defaultOpenBook\] : \[\]\)\)/);
  // een nieuw aan-de-beurt-boek gaat erbij open, er sluit nooit iets door een refresh
  assert.match(chapters, /setOpen\(new Set\(\[\.\.\.open, todayBook\]\)\)/);
  assert.doesNotMatch(chapters, /setOpen\(new Set\(\[todayBook\]\)\)|setOpen\(new Set\(\[defaultOpenBook\]\)\)/);
});

test("alle drie de leescursussen gebruiken dezelfde hoofdstuksleutels; zonder beeld een verzorgde neutrale kaart zonder fout", () => {
  const shared = read("src/components/reading/pathParts.tsx");
  assert.match(shared, /export function hasArtwork\(/);
  assert.match(shared, /min-h-\[6\.5rem\] bg-gradient-to-br from-vs-accent-soft to-vs-surface/);
  // Stap voor stap én de hoofdstukroute (Hoofdstuk voor hoofdstuk en Vrije keuze) vragen hun beeld op dezelfde plek op
  for (const rel of ["src/components/reading/ReadingPath.tsx", "src/components/reading/ChapterPath.tsx"]) {
    assert.match(read(rel), /chapterArtworkKeys\(chapter\.bookKey, chapter\.number\)/, rel);
  }
  // geen eigen beeldlogica of vulbeeld in de componenten: alleen het register, met hasArtwork als poort voor miniaturen
  for (const rel of ["src/components/reading/ReadingPath.tsx", "src/components/reading/ChapterPath.tsx", "src/components/reading/pathParts.tsx"]) {
    assert.doesNotMatch(read(rel), /book:\$\{|\/images\/book-of-mormon|startsWith\("bofm/, rel);
  }
  assert.match(read("src/components/reading/ChapterPath.tsx"), /bookArtworkKeys\(group\.bookKey\)/, "boekbeeld ook op de boekkaart");
  // een ontbrekend beeld: de miniatuur wordt niet gerenderd en de actieve kop valt terug op de neutrale kop
  assert.match(shared, /const hasImage = hasArtwork\(artworkKeys\);/);
  assert.match(read("src/components/reading/ChapterPath.tsx"), /const thumb = hasArtwork\(keys\);/);
  // responsive, lui en met fade: ongewijzigd
  assert.match(shared, /sizes="120px"/);
  assert.match(shared, /sizes="\(min-width: 1024px\) 640px, 100vw"/);
  assert.match(shared, /bg-gradient-to-r from-transparent/);
  assert.doesNotMatch(shared, /priority/);
});

test("alle nieuwe tekst loopt via i18n in alle talen", () => {
  for (const lang of ["nl", "en", "de", "fr", "es"]) {
    const source = read(`src/lib/i18n/messages/${lang}.ts`);
    for (const key of ["myChapter", "myChapterAria", "readChapter", "continueChapter", "chaptersDone", "books"]) {
      assert.match(source, new RegExp(`"?${key}"?: "[^"]+"`), `${lang}.${key}`);
    }
  }
});

// --- Cursusidentiteit (zie docs/CURSUSIDENTITEIT.md) --------------------------------------------------------------------------------

test("de canonieke slugs: het Boek van Mormon houdt de historische slugs, andere collecties krijgen de collectieslug erachter", async () => {
  const { canonicalReadingSlug } = await import("../src/lib/courseIntegrity");
  const { BOM_COLLECTION_ID } = await import("../src/lib/contentCollectionIds");
  assert.equal(BOM_COLLECTION_ID, "content_bom");
  const bom = { id: BOM_COLLECTION_ID, slug: "boek-van-mormon" };
  assert.deepEqual(READING_PATH_TYPES.map((type) => canonicalReadingSlug(bom, type)), ["lezen-van-voor-naar-achter", "voor-naar-achter", "vrije-keuze"]);
  assert.equal(canonicalReadingSlug({ id: "content_dc", slug: "leer-en-verbonden" }, "FRONT_TO_BACK"), "voor-naar-achter-leer-en-verbonden");
});

test("syncCourses kiest de standaardcollectie op vast id, nooit op volgorde of ingeschakelde status", () => {
  const courses = read("src/lib/courses.ts");
  const sync = courses.slice(courses.indexOf("export async function syncCourses"), courses.indexOf("const books = await db.book.findMany"));
  assert.match(sync, /findUnique\(\{\s*where: \{ id: BOM_COLLECTION_ID \}/);
  assert.doesNotMatch(sync, /enabled: true|orderBy/);
  assert.match(read("src/lib/contentCollections.ts"), /export \{ BOM_COLLECTION_ID \}/, "één constante, ook voor de rest van de app");
  const importContent = read("prisma/importContent.ts");
  assert.doesNotMatch(importContent.slice(importContent.indexOf("export async function importBooks")), /findFirst\(\{\s*where: \{ enabled: true \}/, "geen impliciete eerste collectie als importdoel");
});

test("de herstelscripts zijn standaard een dry-run en vereisen een bevestigde back-up voor --apply", () => {
  const repair = read("scripts/courses/repair-duplicates.ts");
  assert.match(repair, /--backup-gemaakt/);
  assert.match(repair, /const apply = process\.argv\.includes\("--apply"\)/);
  assert.match(repair, /--verwacht-database=/, "--apply bevestigt de naam van de doeldatabase");
  assert.match(repair, /resolveDatabase\(/);
  assert.match(repair, /confirmsDatabaseIdentity\(target, confirmation\)/, "host, poort en databasenaam worden bevestigd");
  assert.match(read("scripts/courses/audit-duplicates.ts"), /resolveDatabase\(/, "de audit toont eerst de doeldatabase");
  assert.doesNotMatch(read("scripts/courses/target.ts"), /username|password/, "de doelweergave bevat nooit geheimen");
  assert.doesNotMatch(read("scripts/courses/audit-duplicates.ts"), /\.(create|update|delete|upsert)\w*\(/, "de diagnose schrijft niets");
});

test("de drie leeswijzen krijgen in elke app-taal drie verschillende namen (vertaling veroorzaakt geen schijnduplicaten)", async () => {
  const { localizedCourse } = await import("../src/lib/courseText");
  for (const language of ["nl", "en", "de", "fr", "es"]) {
    const names = READING_PATH_TYPES.map((type) => localizedCourse({ type, name: { READING_LESSONS: "Stap voor stap", FRONT_TO_BACK: "Hoofdstuk voor hoofdstuk", FREE_CHOICE: "Vrije keuze" }[type], description: null, work: "bofm" }, language).name);
    assert.equal(new Set(names).size, 3, `${language}: ${names.join(" / ")}`);
    assert.ok(names.every((name) => name.length > 0));
  }
});
