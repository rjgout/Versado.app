import type { StudyManifest } from "./manifest";

const root = "https://www.churchofjesuschrist.org/study/manual/come-follow-me-for-home-and-church-old-testament-2026";

// Deze kalenderwaarden zijn op 2026-10-14 uit de officiële Nederlandstalige
// inhoudsopgave gecontroleerd. Zij worden niet uit een weekpatroon berekend.
const lessons: ReadonlyArray<readonly [string, string, string, string]> = [
  ["01", "2025-12-29", "2026-01-04", "Inleiding tot het Oude Testament"],
  ["02", "2026-01-05", "2026-01-11", "Mozes 1; Abraham 3"],
  ["03", "2026-01-12", "2026-01-18", "Genesis 1–2; Mozes 2–3; Abraham 4–5"],
  ["04", "2026-01-19", "2026-01-25", "Genesis 3–4; Mozes 4–5"],
  ["05", "2026-01-26", "2026-02-01", "Genesis 5; Mozes 6"],
  ["06", "2026-02-02", "2026-02-08", "Mozes 7"],
  ["07", "2026-02-09", "2026-02-15", "Genesis 6–11; Mozes 8"],
  ["08", "2026-02-16", "2026-02-22", "Genesis 12–17; Abraham 1–2"],
  ["09", "2026-02-23", "2026-03-01", "Genesis 18–23"],
  ["10", "2026-03-02", "2026-03-08", "Genesis 24–33"],
  ["11", "2026-03-09", "2026-03-15", "Genesis 37–41"],
  ["12", "2026-03-16", "2026-03-22", "Genesis 42–50"],
  ["13", "2026-03-23", "2026-03-29", "Exodus 1–6"],
  ["14", "2026-03-30", "2026-04-05", "Pasen"],
  ["15", "2026-04-06", "2026-04-12", "Exodus 7–13"],
  ["16", "2026-04-13", "2026-04-19", "Exodus 14–18"],
  ["17", "2026-04-20", "2026-04-26", "Exodus 19–20; 24; 31–34"],
  ["18", "2026-04-27", "2026-05-03", "Exodus 35–40; Leviticus 1; 4; 16; 19"],
  ["19", "2026-05-04", "2026-05-10", "Numeri 11–14; 20–24; 27"],
  ["20", "2026-05-11", "2026-05-17", "Deuteronomium 6–8; 15; 18; 29–30; 34"],
  ["21", "2026-05-18", "2026-05-24", "Jozua 1–8; 23–24"],
  ["22", "2026-05-25", "2026-05-31", "Richteren 2–4; 6–8; 13–16"],
  ["23", "2026-06-01", "2026-06-07", "Ruth; 1 Samuel 1–7"],
  ["24", "2026-06-08", "2026-06-14", "1 Samuel 8–10; 13; 15–16"],
  ["25", "2026-06-15", "2026-06-21", "1 Samuel 17–18; 24–26; 2 Samuel 5–7"],
  ["26", "2026-06-22", "2026-06-28", "2 Samuel 11–12; 1 Koningen 3; 6–9; 11"],
  ["27", "2026-06-29", "2026-07-05", "1 Koningen 12–13; 17–22"],
  ["28", "2026-07-06", "2026-07-12", "2 Koningen 2–7"],
  ["29", "2026-07-13", "2026-07-19", "2 Koningen 16–25"],
  ["30", "2026-07-20", "2026-07-26", "2 Kronieken 14–20; 26; 30"],
  ["31", "2026-07-27", "2026-08-02", "Ezra 1; 3–7; Nehemia 2; 4–6; 8"],
  ["32", "2026-08-03", "2026-08-09", "Esther"],
  ["33", "2026-08-10", "2026-08-16", "Job 1–3; 12–14; 19; 21–24; 38–40; 42"],
  ["34", "2026-08-17", "2026-08-23", "Psalmen 1–2; 8; 19–33; 40; 46"],
  ["35", "2026-08-24", "2026-08-30", "Psalmen 49–51; 61–66; 69–72; 77–78; 85–86"],
  ["36", "2026-08-31", "2026-09-06", "Psalmen 102–103; 110; 116–119; 127–128; 135–139; 146–150"],
  ["37", "2026-09-07", "2026-09-13", "Spreuken 1–4; 15–16; 22; 31; Prediker 1–3; 11–12"],
  ["38", "2026-09-14", "2026-09-20", "Jesaja 1–12"],
  ["39", "2026-09-21", "2026-09-27", "Jesaja 13–14; 22; 24–30; 35"],
  ["40", "2026-09-28", "2026-10-04", "Jesaja 40–49"],
  ["41", "2026-10-05", "2026-10-11", "Jesaja 50–57"],
  ["42", "2026-10-12", "2026-10-18", "Jesaja 58–66"],
  ["43", "2026-10-19", "2026-10-25", "Jeremia 1–3; 7; 16–18; 20"],
  ["44", "2026-10-26", "2026-11-01", "Jeremia 31–33; 36–39; Klaagliederen 1; 3"],
  ["45", "2026-11-02", "2026-11-08", "Ezechiël 1–3; 33–34; 36–37; 47"],
  ["46", "2026-11-09", "2026-11-15", "Daniël 1–7"],
  ["47", "2026-11-16", "2026-11-22", "Hosea 1–6; 10–14; Joël"],
  ["48", "2026-11-23", "2026-11-29", "Amos; Obadja; Jona"],
  ["49", "2026-11-30", "2026-12-06", "Micha; Nahum; Habakuk; Zefanja"],
  ["50", "2026-12-07", "2026-12-13", "Haggaï 1–2; Zacharia 1–4; 7–14"],
  ["51", "2026-12-14", "2026-12-20", "Maleachi"],
  ["52", "2026-12-21", "2026-12-27", "Kerstmis"],
];

export const cfmOldTestament2026NlManifest: StudyManifest = {
  id: "cfm-old-testament-2026-nld",
  workKey: "cfm-old-testament-2026",
  editionKey: "church-cfm-ot-2026",
  language: "nl",
  year: 2026,
  canonicalUrl: `${root}/000-contents?lang=nld`,
  verifiedAt: "2026-10-14",
  // De projecteigenaar heeft voor dit programma expliciet gebruiksrechten
  // bevestigd. Schriftelijke bewijsstukken en eventuele voorwaarden horen
  // administratief buiten de repository beschikbaar te blijven.
  rightsStatus: "VALID",
  lessons: lessons.map(([sourceKey, startsOn, endsOn, title], index) => ({
    sourceKey,
    periodSourceKey: `cfm-old-testament-2026:${sourceKey}`,
    title,
    language: "nl",
    year: 2026,
    sourceUrl: `${root}/${sourceKey}?lang=nld`,
    startsOn,
    endsOn,
    order: index + 1,
    scriptureReferences: [title],
    fullContent: "AVAILABLE",
    // De officiële API meldt per les negen img-elementen; semantische selectie
    // en alternatieve teksten worden in fase 3B vastgelegd.
    media: { observedCount: 9, inventoryStatus: "WARNING" },
    sourceStatus: "VALID",
    // Een interne verwijzing wordt pas gepubliceerd wanneer de bestaande OTB-
    // editie en haar concrete boek-, hoofdstuk- en verzenbewijs zijn gevalideerd.
    referenceStatus: "BLOCKED",
  })),
};

/** Gedeelde exacte cataloguscontrole voor voorcontrole, bulkpublicatie en collectievrijgave (elke CFM-jaargang). */
export function matchesCfmCatalogue(
  manifest: StudyManifest,
  collection: { id: string; work: string | null; editionKey: string | null; language: string },
  editions: ReadonlyArray<{
    collectionId: string; workKey: string;
    lesson: { sourceKey: string; order: number; retiredAt: Date | null };
  }>,
): boolean {
  return collection.work === manifest.workKey && collection.editionKey === manifest.editionKey &&
    collection.language === manifest.language && editions.length === manifest.lessons.length &&
    editions.every((edition, i) => edition.collectionId === collection.id && edition.workKey === manifest.workKey &&
      edition.lesson.sourceKey === manifest.lessons[i].sourceKey && edition.lesson.order === manifest.lessons[i].order &&
      !edition.lesson.retiredAt);
}

/** De 2026-ingang blijft bestaan voor bestaande aanroepers en tests. */
export const matchesCfm2026Catalogue = (
  collection: Parameters<typeof matchesCfmCatalogue>[1],
  editions: Parameters<typeof matchesCfmCatalogue>[2],
) => matchesCfmCatalogue(cfmOldTestament2026NlManifest, collection, editions);
