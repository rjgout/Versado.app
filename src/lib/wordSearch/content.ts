import bomWords from "../../../prisma/bomWords.json";
import bomWordCountsEn from "../../../prisma/bomWordCounts.en.json";
import bomWordCountsEs from "../../../prisma/bomWordCounts.es.json";
import bomWordCountsDe from "../../../prisma/bomWordCounts.de.json";
import bomWordCountsFr from "../../../prisma/bomWordCounts.fr.json";
import type { LanguageCode } from "@/lib/languages";
import { stopwordsFor } from "@/lib/exerciseGen";
import { prisma } from "@/lib/db";
import type { WordSearchCandidate } from "./generator";

type CountPair = [string, number];

const DUTCH_WORDS = bomWords as string[];
const ENGLISH_WORDS = (bomWordCountsEn as CountPair[]).map(([word]) => word);
const SPANISH_WORDS = (bomWordCountsEs as CountPair[]).map(([word]) => word);
const GERMAN_WORDS = (bomWordCountsDe as CountPair[]).map(([word]) => word);
const FRENCH_WORDS = (bomWordCountsFr as CountPair[]).map(([word]) => word);

/** De woordpool komt uit de bestaande BOM-woordenlijsten plus de officiële namen uit de actieve uitgave. */
export async function getWordSearchCandidates(
  contentCollectionId: string,
  language: string
): Promise<WordSearchCandidate[]> {
  if (!["nl", "en", "de", "fr", "es"].includes(language)) return [];
  const safeLanguage: LanguageCode = language === "en" || language === "de" || language === "fr" || language === "es" ? language : "nl";
  const sourceWords = safeLanguage === "en" ? ENGLISH_WORDS : safeLanguage === "es" ? SPANISH_WORDS : safeLanguage === "de" ? GERMAN_WORDS : safeLanguage === "fr" ? FRENCH_WORDS : DUTCH_WORDS;
  const stopwords = stopwordsFor(safeLanguage);
  const [persons, places, books] = await Promise.all([
    prisma.person.findMany({ where: { contentCollectionId }, select: { name: true } }),
    // Place heeft nog geen taaledities. Alleen bewezen gekoppelde Nederlandse
    // namen gebruiken; geen NL-metadata of verborgen andere bron in vertaalde pools.
    safeLanguage === "nl" ? prisma.place.findMany({ where: { verses: { some: { verse: { chapter: { book: { contentCollectionId } } } } } }, select: { name: true }, take: 500, orderBy: { id: "asc" } }) : Promise.resolve([]),
    prisma.book.findMany({ where: { contentCollectionId }, select: { name: true } }),
  ]);

  const candidates = [...sourceWords, ...persons.map((item) => item.name), ...places.map((item) => item.name), ...books.map((item) => item.name)];
  const seen = new Set<string>();
  return candidates.flatMap((word) => {
    const normalized = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z]/g, "").toUpperCase();
    const lower = normalized.toLowerCase();
    if (normalized.length < 4 || normalized.length > 12 || stopwords.has(lower) || seen.has(normalized)) return [];
    seen.add(normalized);
    return [{ display: word, normalized }];
  });
}
