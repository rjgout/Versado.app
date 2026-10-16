// Expliciete, controleerbare koppeling tussen een schriftuurlijk hoofdstuk en een bestaande
// kinderverhaal-illustratie (public/kids/images, 216 scènes). De nummering van de
// kinderverhalen en die van de hoofdstukken horen bij verschillende structuren: een koppeling
// bestaat dus alleen waar de scène inhoudelijk hetzelfde gebeurtenis toont als het hoofdstuk.
// Geen koppeling = het boekbeeld (artwork.ts) of een neutrale kaart, nooit een gokplaatje.
//
// `story` is KidsStory.number; `title` is de titel in prisma/kidsManifest.json en wordt door
// tests/reading-path.test.ts vergeleken, zodat een hernummering of hertitelling de koppeling
// niet stilletjes laat wijzen naar een ander verhaal. `book` is Book.key (taalonafhankelijk).

export interface ChapterScene {
  book: string;
  chapter: number;
  story: number;
  title: string;
}

export const CHAPTER_SCENES: readonly ChapterScene[] = [
  { book: "pgp/js-h", chapter: 1, story: 1, title: "Hoe we het Boek van Mormon gekregen hebben" },
  { book: "bofm/1-ne", chapter: 2, story: 3, title: "Lehi gaat weg uit Jeruzalem" },
  { book: "bofm/1-ne", chapter: 4, story: 4, title: "De koperen platen" },
  { book: "bofm/1-ne", chapter: 8, story: 6, title: "De droom van Lehi" },
  { book: "bofm/1-ne", chapter: 16, story: 5, title: "Reizen in de wildernis" },
  { book: "bofm/1-ne", chapter: 17, story: 7, title: "De bouw van de boot" },
  { book: "bofm/1-ne", chapter: 18, story: 8, title: "De oversteek" },
  { book: "bofm/jacob", chapter: 7, story: 10, title: "Jakob en Sherem" },
  { book: "bofm/enos", chapter: 1, story: 11, title: "Enos" },
  { book: "bofm/mosiah", chapter: 2, story: 12, title: "Koning Benjamin" },
  { book: "bofm/mosiah", chapter: 9, story: 13, title: "Zeniff" },
  { book: "bofm/mosiah", chapter: 12, story: 14, title: "Abinadi en koning Noach" },
  { book: "bofm/mosiah", chapter: 18, story: 15, title: "Alma onderricht en doopt" },
  { book: "bofm/mosiah", chapter: 22, story: 16, title: "Koning Limhi en zijn volk ontsnappen" },
  { book: "bofm/mosiah", chapter: 24, story: 17, title: "Alma en zijn volk ontsnappen" },
  { book: "bofm/mosiah", chapter: 27, story: 18, title: "De bekering van Alma de jonge" },
  { book: "bofm/mosiah", chapter: 28, story: 19, title: "De zoons van Mosiah gaan op zending" },
  { book: "bofm/alma", chapter: 1, story: 20, title: "Alma en Nehor" },
  { book: "bofm/alma", chapter: 2, story: 21, title: "De Amlicieten" },
  { book: "bofm/alma", chapter: 8, story: 22, title: "Alma's zending naar Ammonihah" },
  { book: "bofm/alma", chapter: 17, story: 23, title: "Ammon, een uitmuntend dienstknecht" },
  { book: "bofm/alma", chapter: 20, story: 24, title: "Ammon ontmoet de vader van koning Lamoni" },
  { book: "bofm/alma", chapter: 22, story: 25, title: "Aäron onderwijst de vader van Lamoni" },
  { book: "bofm/alma", chapter: 24, story: 26, title: "Het volk van Ammon" },
  { book: "bofm/alma", chapter: 30, story: 27, title: "Korihor" },
  { book: "bofm/alma", chapter: 31, story: 28, title: "De Zoramieten en de Rameumptom" },
  { book: "bofm/alma", chapter: 32, story: 29, title: "Alma spreekt over geloof en het woord van God" },
  { book: "bofm/alma", chapter: 43, story: 31, title: "Opperbevelhebber Moroni verslaat Zerahemnah" },
  { book: "bofm/alma", chapter: 46, story: 32, title: "Moroni en de banier der vrijheid" },
  { book: "bofm/alma", chapter: 51, story: 33, title: "Koningsgezinden tegen vrijen" },
  { book: "bofm/alma", chapter: 56, story: 34, title: "Helaman en de tweeduizend strijders" },
  { book: "bofm/alma", chapter: 60, story: 35, title: "Opperbevelhebber Moroni en Pahoran" },
  { book: "bofm/alma", chapter: 63, story: 36, title: "Hagoth" },
  { book: "bofm/hel", chapter: 5, story: 37, title: "Nephi en Lehi in de gevangenis" },
  { book: "bofm/hel", chapter: 9, story: 38, title: "De moord op de hoofdrechter" },
  { book: "bofm/hel", chapter: 10, story: 39, title: "Nephi krijgt grote macht" },
  { book: "bofm/hel", chapter: 13, story: 40, title: "De Lamaniet Samuël vertelt over Jezus Christus" },
  { book: "bofm/3-ne", chapter: 1, story: 41, title: "De tekens van Christus' geboorte" },
  { book: "bofm/3-ne", chapter: 8, story: 42, title: "De tekens van Christus' kruisiging" },
  { book: "bofm/3-ne", chapter: 11, story: 43, title: "Jezus Christus verschijnt aan de Nephieten" },
  { book: "bofm/3-ne", chapter: 17, story: 44, title: "Jezus Christus zegent de kinderen" },
  { book: "bofm/3-ne", chapter: 18, story: 45, title: "Jezus Christus legt het avondmaal en het gebed uit" },
  { book: "bofm/4-ne", chapter: 1, story: 48, title: "Vrede in Amerika" },
  { book: "bofm/ether", chapter: 1, story: 50, title: "De Jaredieten gaan weg uit Babel" },
  { book: "bofm/ether", chapter: 2, story: 51, title: "De Heer leidt de Jaredieten naar het beloofde land" },
  { book: "bofm/ether", chapter: 15, story: 52, title: "De vernietiging van de Jaredieten" },
  { book: "bofm/moro", chapter: 10, story: 54, title: "De belofte van het Boek van Mormon" },
];

/** Registersleutel van het hoofdstukbeeld; zie courseChapterArtworkKeys in artwork.ts. */
export function chapterSceneKey(book: string, chapter: number): string {
  return `chapter:${book}:${chapter}`;
}

/** De eerste scène van het verhaal; het beeld bevat geen tekst. */
export function chapterSceneSrc(scene: ChapterScene): string {
  return `/kids/images/story-${scene.story}-0.jpg`;
}
