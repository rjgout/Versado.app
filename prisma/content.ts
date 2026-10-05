// LET OP — auteursrecht:
// De verzen hieronder zijn de letterlijke, officiële Nederlandse tekst van
// het Boek van Mormon, in de huidige uitgave zoals die op de website van de
// kerk staat (churchofjesuschrist.org, lang=nld), met toestemming van de
// gebruiker gebruikt. Dat is ook de uitgave die de Nederlandse audio
// voorleest; de eerdere tekst (34404_nld.pdf) was een oudere vertaling met
// o.a. "gij" en "zeide". Voetnoten zijn bewust weggelaten. De brontekst
// zelf staat in prisma/bomContent.json (te groot om als TS-array te
// onderhouden); dit bestand voegt daar alleen de
// handmatig geschreven begrijpend-lezen-oefeningen aan toe voor de paar
// hoofdstukken die die al hadden.

// Begrijpend-lezen-oefeningen (zie ExerciseType.MULTIPLE_CHOICE/SEQUENCE):
// bewust handmatig geschreven, niet uit de verzen gegenereerd — dat vereist
// nu eenmaal daadwerkelijk begrip van wat er gebeurt, niet alleen de tekst.
export interface ComprehensionMultipleChoice {
  type: "MULTIPLE_CHOICE";
  verseRef: string;
  prompt: string;
  options: string[];
  correctIndex: number;
}

export interface ComprehensionSequence {
  type: "SEQUENCE";
  verseRef: string;
  prompt: string;
  items: string[]; // in de juiste volgorde
}

export type ComprehensionExercise = ComprehensionMultipleChoice | ComprehensionSequence;

export interface SeedChapter {
  number: number;
  verses: string[];
  comprehension?: ComprehensionExercise[];
  heading?: string;
}

export interface SeedBook {
  slug: string;
  /** Taalonafhankelijke sleutel (zie prisma/bookKeys.ts); anders afgeleid van de slug. */
  key?: string;
  name: string;
  chapters: SeedChapter[];
}

import bomContent from "./bomContent.json";
import bomChapterHeadings from "./bomChapterHeadings.json";

// De officiële hoofdstukkop (samenvatting + jaartal, bv. "Ongeveer 600 v.C.")
// die boven elk hoofdstuk staat — apart bestand omdat dit, anders dan de
// verzen, uit een tweede extractieslag komt (zie het "Raad het hoofdstuk"-
// spel, src/lib/chapterGuess.ts, waar dit als introtekst dient).
const headingByChapter = new Map<string, string>(
  (bomChapterHeadings as [string, number, string][]).map(([slug, number, heading]) => [`${slug}:${number}`, heading])
);

// Handmatig geschreven begrijpend-lezen-oefeningen bij een paar hoofdstukken
// (zie ComprehensionExercise hierboven).
const comprehensionByChapter: Record<string, ComprehensionExercise[]> = {
  "1-nephi:1": [
    {
      type: "MULTIPLE_CHOICE",
      verseRef: "1 Nephi 1",
      prompt: "Wat is de kernboodschap van dit hoofdstuk?",
      options: [
        "Nephi legt uit waarom hij dit verslag schrijft en vertelt over de roeping van zijn vader Lehi als profeet.",
        "Nephi beschrijft hoe een oorlog tussen twee koninkrijken Jeruzalem bedreigt en zijn familie tot handelen dwingt.",
        "Nephi vertelt hoe een groot feest in Jeruzalem zijn familie samenbrengt en aanleiding geeft om hun geschiedenis vast te leggen.",
        "Nephi geeft een overzicht van de wetten van Mozes en legt uit hoe zijn volk die wetten in Jeruzalem naleeft.",
      ],
      correctIndex: 0,
    },
    {
      type: "SEQUENCE",
      verseRef: "1 Nephi 1",
      prompt: "Zet deze gebeurtenissen in de juiste volgorde.",
      items: [
        "Nephi krijgt onderwijs van zijn vader.",
        "Profeten waarschuwen dat Jeruzalem verwoest zal worden.",
        "Lehi bidt en ziet een groot licht.",
        "Lehi keert terug naar huis, overweldigd door de Geest.",
      ],
    },
  ],
};

export const seedBooks: SeedBook[] = (bomContent as SeedBook[]).map((book) => ({
  ...book,
  chapters: book.chapters.map((chapter) => {
    const comprehension = comprehensionByChapter[`${book.slug}:${chapter.number}`];
    const heading = headingByChapter.get(`${book.slug}:${chapter.number}`);
    return { ...chapter, ...(comprehension ? { comprehension } : {}), ...(heading ? { heading } : {}) };
  }),
}));
