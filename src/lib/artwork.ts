// Register van beeld bij content (zie docs/VERSADO-DESIGN.md, "Upcoming
// design assets"). Dit is de enige plek die weet welke afbeelding bij welke
// content hoort: pagina's vragen via de helpers onderaan een lijst sleutels
// op, van specifiek naar algemeen, en MediaArtwork toont de eerste die hier
// bestaat. Nieuwe artwork is dus één regel hieronder, zonder dat een pagina
// verandert. Geen server-imports: MediaArtwork gebruikt dit in de browser.
//
// Bestanden staan in public/images/. Next/image maakt er per schermbreedte
// een kleine WebP van, dus de originelen mogen groot zijn. De afbeeldingen
// bevatten bewust geen tekst: titels, labels en knoppen blijven echte UI.
// Eén versie per afbeelding, voor licht en donker.
//
// Uitgangspunt: beeld hoort inhoudelijk bij de content. Liever de neutrale
// placeholder dan een afbeelding die over iets anders gaat; daarom is er
// geen algemeen beeld per werk dat elke cursus zou krijgen.
//
// Sleutels: "book:<Book.key>", "course:<Course.slug>",
// "course-work:<werk>:<CourseType>", "course-type:<CourseType>",
// "podcast:<podcastId>", "podcast:default",
// "game:<GameId>", "daily:<soort>". Bewust niet de emoji uit de database
// (Achievement.icon, ContentCollection.icon) als bron.

import type { GameId } from "@/lib/gameCatalog";

export type ArtworkKind = "course" | "podcast" | "game" | "daily" | "reading" | "quiz" | "social";

export interface ArtworkAsset {
  src: string;
  /** Leeg voor puur decoratief beeld; de titel staat er altijd als tekst naast. */
  alt?: string;
  /** Hoe het beeld in een kader met een andere verhouding valt. */
  fit?: "cover" | "contain";
  /** Brandpunt bij bijsnijden, bv. "50% 30%": de kaders zijn smaller of vierkanter dan het beeld. */
  position?: string;
  /** Gemiddelde kleur, als rustig vlak zolang het beeld laadt. */
  tone?: string;
}

/** Een of meer sleutels; de eerste die bestaat wint. */
export type ArtworkKeys = string | readonly (string | null | undefined)[] | null | undefined;

// Per boek van de Schriften (Book.key, in elke taal hetzelfde).
const BOOKS: Record<string, ArtworkAsset> = {
  "bofm/1-ne": { src: "/images/book-of-mormon/1-nephi.png", position: "25% 40%", tone: "#987e6b" },
  "bofm/2-ne": { src: "/images/book-of-mormon/2-nephi.png", position: "30% 30%", tone: "#987558" },
  "bofm/jacob": { src: "/images/book-of-mormon/jakob.png", position: "45% 35%", tone: "#9a7149" },
  "bofm/enos": { src: "/images/book-of-mormon/enos.png", position: "40% 40%", tone: "#947248" },
  "bofm/jarom": { src: "/images/book-of-mormon/jarom.png", position: "35% 40%", tone: "#966946" },
  "bofm/omni": { src: "/images/book-of-mormon/omni.png", position: "45% 35%", tone: "#9b7558" },
  "bofm/w-of-m": { src: "/images/book-of-mormon/woorden-van-mormon.png", position: "30% 35%", tone: "#8c654a" },
  "bofm/mosiah": { src: "/images/book-of-mormon/mosiah.png", position: "30% 20%", tone: "#966e54" },
  "bofm/alma": { src: "/images/book-of-mormon/alma.png", position: "45% 30%", tone: "#8c705d" },
  "bofm/hel": { src: "/images/book-of-mormon/helaman.png", position: "40% 25%", tone: "#80522e" },
  "bofm/3-ne": { src: "/images/book-of-mormon/3-nephi.png", position: "50% 35%", tone: "#967053" },
  "bofm/4-ne": { src: "/images/book-of-mormon/4-nephi.png", position: "45% 45%", tone: "#936b4c" },
  "bofm/morm": { src: "/images/book-of-mormon/mormon.png", position: "40% 25%", tone: "#95755a" },
  "bofm/ether": { src: "/images/book-of-mormon/ether.png", position: "45% 25%", tone: "#95694e" },
  "bofm/moro": { src: "/images/book-of-mormon/moroni.png", position: "40% 35%", tone: "#947251" },
  "dc-testament/dc": { src: "/images/doctrine-and-covenants/leer-en-verbonden.png", position: "30% 40%", tone: "#916847" },
  "pgp/moses": { src: "/images/pearl-of-great-price/mozes.png", position: "35% 25%", tone: "#9b7c63" },
  "pgp/abr": { src: "/images/pearl-of-great-price/abraham.png", position: "50% 30%", tone: "#785c51" },
  "pgp/js-m": { src: "/images/pearl-of-great-price/joseph-smith-mattheus.png", position: "35% 35%", tone: "#966f4d" },
  "pgp/js-h": { src: "/images/pearl-of-great-price/joseph-smith-geschiedenis.png", position: "50% 35%", tone: "#906629" },
  "pgp/a-of-f": { src: "/images/pearl-of-great-price/geloofsartikelen.png", position: "45% 45%", tone: "#855e3f" },
};

// Per cursus (Course.slug) of per soort cursus (CourseType).
const COURSES: Record<string, ArtworkAsset> = {
  // Voor een toekomstige cursus met deze slug; die bestaat nog niet.
  "life-of-christ": { src: "/images/courses/life-of-christ.png", position: "50% 40%", tone: "#9e7b62" },
  "ontdek-boek-van-mormon": { src: "/images/courses/ontdek-boek-van-mormon.png", position: "35% 50%", tone: "#9c7353" },
  kinderen: { src: "/images/courses/kinderen.png", position: "45% 45%", tone: "#967256" },
  "voor-de-kracht-van-de-jeugd": { src: "/images/courses/voor-de-kracht-van-de-jeugd.png", position: "40% 45%", tone: "#90705a" },
};
// Per soort cursus binnen een werk ("<werk>:<CourseType>"), op werk en niet
// op slug: de slugs verschillen per taaluitgave, het werk niet.
const COURSE_WORKS: Record<string, ArtworkAsset> = {
  "bofm:FREE_CHOICE": { src: "/images/courses/vrije-keuze-boek-van-mormon.png", position: "35% 50%", tone: "#987656" },
  "dc-testament:FREE_CHOICE": { src: "/images/courses/vrije-keuze-leer-en-verbonden.png", position: "35% 50%", tone: "#937050" },
  "pgp:FREE_CHOICE": { src: "/images/courses/vrije-keuze-parel-van-grote-waarde.png", position: "30% 60%", tone: "#98745d" },
};
const COURSE_TYPES: Record<string, ArtworkAsset> = {};

// Spelcovers, per id uit src/lib/gameCatalog.ts: dezelfde cover op elke plek
// waar een spel als kaart staat (Vandaag, Voor jou, Spelen). Een spel zonder
// cover houdt de neutrale placeholder; een nieuwe cover is hier één regel.
// Een brandpunt alleen waar bijsnijden vanuit het midden aantoonbaar iets
// wegvalt (bij woordspel de W in het vierkante kader).
const GAME_COVERS: Partial<Record<GameId, ArtworkAsset>> = {
  "word-game": { src: "/images/games/woord-van-de-dag.png", tone: "#a4764e" },
  "word-search": { src: "/images/games/woordzoeker.png", tone: "#a76c3a" },
  jigsaw: { src: "/images/games/legpuzzel.png", tone: "#9a7356" },
  alleskenner: { src: "/images/games/de-slimste-heilige.png", position: "38% 75%", tone: "#a4714a" },
  scrabble: { src: "/images/games/woordspel.png", position: "35% 50%", tone: "#a67953" },
  "chapter-guess": { src: "/images/games/raad-het-hoofdstuk.png", tone: "#9d6e49" },
  gezinsavond: { src: "/images/games/gezinsavond.png", tone: "#a27141" },
  challenges: { src: "/images/games/uitdagingen.png", tone: "#996638" },
  "quick-missionary": { src: "/images/games/snelle-zendeling.png", tone: "#8ebfd0" },
};

const PODCASTS: Record<string, ArtworkAsset> = {
  // Voor podcasts (en afleveringen) zonder eigen beeld.
  default: { src: "/images/podcast/default.png", position: "62% 60%", tone: "#996b47" },
};

const DAILY: Record<string, ArtworkAsset> = {
  text: { src: "/images/daily/verse-of-the-day.png", position: "55% 70%", tone: "#9c744e" },
};

const ARTWORK: Record<string, ArtworkAsset> = Object.fromEntries([
  ...Object.entries(BOOKS).map(([key, asset]) => [`book:${key}`, asset]),
  ...Object.entries(COURSES).map(([key, asset]) => [`course:${key}`, asset]),
  ...Object.entries(COURSE_WORKS).map(([key, asset]) => [`course-work:${key}`, asset]),
  ...Object.entries(COURSE_TYPES).map(([key, asset]) => [`course-type:${key}`, asset]),
  ...Object.entries(GAME_COVERS).map(([key, asset]) => [`game:${key}`, asset]),
  ...Object.entries(PODCASTS).map(([key, asset]) => [`podcast:${key}`, asset]),
  ...Object.entries(DAILY).map(([key, asset]) => [`daily:${key}`, asset]),
]);

export function artworkFor(keys: ArtworkKeys): ArtworkAsset | null {
  const list = typeof keys === "string" ? [keys] : keys ?? [];
  for (const key of list) {
    if (key && ARTWORK[key]) return ARTWORK[key];
  }
  return null;
}

// Cursussen die het boek van voor naar achter volgen, beginnen in dit boek.
// Zolang je nog niet begonnen bent, is dat dus waar de cursus over gaat.
const START_BOOK_BY_WORK: Record<string, string> = { bofm: "bofm/1-ne", "dc-testament": "dc-testament/dc", pgp: "pgp/moses" };
const IN_BOOK_ORDER = new Set(["FRONT_TO_BACK", "READING_LESSONS"]);

/**
 * Een cursus: eigen beeld; anders het boek waar je nu bent (bv. Alma), of bij
 * een cursus die bij het begin start en nog geen plek heeft het beginboek;
 * anders beeld voor dit soort cursus in dit werk (bv. Vrije keuze in de Leer
 * en Verbonden), en dan voor dit soort cursus. Een plek in een boek zonder
 * beeld valt bewust niet terug op het beginboek: dat zou over iets anders gaan.
 */
export function courseArtworkKeys(course: {
  slug?: string | null;
  type?: string | null;
  work?: string | null;
  bookKey?: string | null;
}): string[] {
  const startBook = !course.bookKey && course.type && IN_BOOK_ORDER.has(course.type) && course.work ? START_BOOK_BY_WORK[course.work] : null;
  const bookKey = course.bookKey ?? startBook;
  return [
    course.slug ? `course:${course.slug}` : null,
    bookKey ? `book:${bookKey}` : null,
    course.work && course.type ? `course-work:${course.work}:${course.type}` : null,
    course.type ? `course-type:${course.type}` : null,
  ].filter((key): key is string => key !== null);
}

/** Een podcast(aflevering): eigen beeld per podcast, anders het algemene podcastbeeld. */
export function podcastArtworkKeys(podcastId: string | null | undefined): string[] {
  return [...(podcastId ? [`podcast:${podcastId}`] : []), "podcast:default"];
}

export function gameArtworkKeys(gameId: GameId): string[] {
  return [`game:${gameId}`];
}
