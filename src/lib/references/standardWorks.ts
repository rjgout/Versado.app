import { scriptureEvidence } from "./evidence";

/**
 * Het label van een verwijzing naar het Boek van Mormon, de Leer en Verbonden of de Parel van Grote Waarde, uitsluitend om te
 * controleren of het label dezelfde passage noemt als de officiële bron-URL. Het label is nooit de bron van het doel: de URL
 * (en het bewijs per hoofdstuk) bepaalt boek, hoofdstuk en verzen. Bij het minste verschil blijft de verwijzing extern.
 */

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " en ")
    .replace(/[.]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Nederlandse naam (alias uit het bewijs) plus gangbare afkortingen en de Engelse namen.
const EXTRA_NAMES: Record<string, string[]> = {
  "bofm/1-ne": ["1 ne", "1 nephi"],
  "bofm/2-ne": ["2 ne", "2 nephi"],
  "bofm/jacob": ["jacob", "jak"],
  "bofm/w-of-m": ["words of mormon", "w of m", "wvm"],
  "bofm/hel": ["hel", "helaman"],
  "bofm/3-ne": ["3 ne", "3 nephi"],
  "bofm/4-ne": ["4 ne", "4 nephi"],
  "bofm/morm": ["morm", "mormon"],
  "bofm/moro": ["moro", "moroni"],
  "dc-testament/dc": ["lv", "l en v", "leer en verbonden", "dc", "d en c", "doctrine and covenants"],
  "pgp/moses": ["moses", "moz"],
  "pgp/abr": ["abr", "abraham"],
  "pgp/js-m": ["js m", "js mattheus", "joseph smith matthew", "joseph smith mattheus", "mattheus naar joseph smith", "matthew by joseph smith"],
  "pgp/js-h": ["js h", "js geschiedenis", "joseph smith history", "joseph smith geschiedenis", "geschiedenis van joseph smith", "history of joseph smith"],
  "pgp/a-of-f": ["gart", "geloofsartikelen", "articles of faith", "a of f"],
};
const aliases = new Map<string, string>();
for (const [bookKey, book] of Object.entries(scriptureEvidence)) {
  for (const name of [book.alias, ...(EXTRA_NAMES[bookKey] ?? [])]) {
    const key = normalize(name);
    const previous = aliases.get(key);
    if (previous && previous !== bookKey) throw new Error(`STANDARD_WORK_AMBIGUOUS_ALIAS:${key}`);
    aliases.set(key, bookKey);
  }
}

/** Het boek (`bofm/alma`) dat bij een naam of afkorting hoort, of null. */
export function standardWorkBookKey(name: string): string | null {
  return aliases.get(normalize(name)) ?? null;
}

/** "21–29, 38–42" of "10 en 13" als oplopende, niet-overlappende bereiken; null bij alles wat daar niet exact aan voldoet. */
export function parseVerseSpec(spec: string): Array<[number, number]> | null {
  const parts = spec.trim().split(/\s*(?:,|;|\ben\b|\band\b)\s*/i);
  if (parts.length > 40) return null;
  const ranges: Array<[number, number]> = [];
  for (const part of parts) {
    const match = /^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/.exec(part.trim());
    if (!match) return null;
    const from = Number(match[1]),
      to = Number(match[2] ?? match[1]);
    if (from < 1 || from > to || (ranges.length && from <= ranges[ranges.length - 1][1])) return null;
    ranges.push([from, to]);
  }
  return ranges.length ? ranges : null;
}

const ARTICLE_ORDINALS = ["eerste", "tweede", "derde", "vierde", "vijfde", "zesde", "zevende", "achtste", "negende", "tiende", "elfde", "twaalfde", "dertiende"];
const sameRanges = (a: ReadonlyArray<readonly [number, number]>, b: ReadonlyArray<readonly [number, number]>) =>
  a.length === b.length && a.every(([from, to], i) => from === b[i][0] && to === b[i][1]);

/**
 * Noemt het label exact de passage van de URL? Toegestane vormen: "Alma 32:17–19, 21", "LV 76:1–5", "vers 13, 15", of een heel
 * hoofdstuk ("Alma 32"). Een label met een ander boek, hoofdstuk of andere verzen (of een bereik over hoofdstukken, dat de URL
 * niet kan uitdrukken) hoort niet bij deze URL.
 */
export function labelMatchesPassage(
  label: string,
  passage: { bookKey: string; chapter: number; ranges: ReadonlyArray<readonly [number, number]>; wholeChapter: boolean },
): boolean {
  // Omringende leestekens ("Mosiah 7:19)") horen niet bij de passage.
  const text = label.trim().replace(/^[("‘']+|[)"’'.,;]+$/gu, "").trim();
  // "vierde geloofsartikel" is Geloofsartikelen 1:4.
  const article = /^(\p{L}+) geloofsartikel$/iu.exec(text);
  if (article) {
    const n = ARTICLE_ORDINALS.indexOf(article[1].toLowerCase()) + 1;
    return n > 0 && passage.bookKey === "pgp/a-of-f" && passage.chapter === 1 && sameRanges([[n, n]], passage.ranges);
  }
  // Alleen verzen ("53–57") of alleen een hoofdstuknummer ("122"): het boek volgt dan uit de URL.
  if (/^[\d,\s–-]+$/.test(text)) {
    if (!passage.wholeChapter) {
      const ranges = parseVerseSpec(text);
      return Boolean(ranges) && sameRanges(ranges!, passage.ranges);
    }
    return /^\d{1,3}$/.test(text) && Number(text) === passage.chapter;
  }
  const verse = /^ver(?:s|zen|ses)?\.?\s+(.+)$/i.exec(text);
  if (verse) {
    const ranges = parseVerseSpec(verse[1]);
    return Boolean(ranges) && sameRanges(ranges!, passage.ranges);
  }
  const withVerses = /^(.*?)\s*(\d{1,3})\s*:\s*(.+)$/u.exec(text);
  if (withVerses) {
    const [, name, chapter, spec] = withVerses;
    if (Number(chapter) !== passage.chapter) return false;
    if (name.trim() && standardWorkBookKey(name) !== passage.bookKey) return false;
    const ranges = parseVerseSpec(spec);
    return Boolean(ranges) && sameRanges(ranges!, passage.ranges);
  }
  const chapterOnly = /^(.+?)\s+(\d{1,3})$/u.exec(text);
  if (chapterOnly && passage.wholeChapter)
    return Number(chapterOnly[2]) === passage.chapter && standardWorkBookKey(chapterOnly[1]) === passage.bookKey;
  return false;
}

/** "21–29, 38–42" voor de titel van een preview. */
export function formatRanges(ranges: ReadonlyArray<readonly [number, number]>) {
  return ranges.map(([from, to]) => (from === to ? String(from) : `${from}–${to}`)).join(", ");
}
