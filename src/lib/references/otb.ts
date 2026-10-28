import { OTB_BOOKS } from "../../../scripts/otb/bookMapping";

type Book = { key: string; names: readonly string[] };

// Nederlandse benamingen zijn alleen invoerhulpen. De bestaande OTB-importer
// blijft de bron van waarheid voor de canonieke `gen` t/m `mal`-identiteit.
const books: readonly Book[] = [
  { key: "gen", names: ["genesis", "gen"] },
  { key: "exo", names: ["exodus", "exo", "ex", "exod"] },
  { key: "lev", names: ["leviticus", "lev"] },
  { key: "num", names: ["numeri", "num", "numbers"] },
  { key: "deu", names: ["deuteronomium", "deut", "deu", "deuteronomy"] },
  { key: "jos", names: ["jozua", "jos", "joshua", "josh"] },
  { key: "jdg", names: ["richteren", "richter", "richt", "jdg", "judges", "judg"] },
  { key: "rut", names: ["ruth", "rut"] },
  { key: "1sa", names: ["1 samuel", "1 sam", "1sa"] },
  { key: "2sa", names: ["2 samuel", "2 sam", "2sa"] },
  { key: "1ki", names: ["1 koningen", "1 kon", "1ki", "1 kings"] },
  { key: "2ki", names: ["2 koningen", "2 kon", "2ki", "2 kings"] },
  { key: "1ch", names: ["1 kronieken", "1 kron", "1ch", "1 chronicles", "1 chron"] },
  { key: "2ch", names: ["2 kronieken", "2 kron", "2ch", "2 chronicles", "2 chron"] },
  { key: "ezr", names: ["ezra", "ezr"] },
  { key: "neh", names: ["nehemia", "neh", "nehemiah"] },
  { key: "est", names: ["esther", "est"] },
  { key: "job", names: ["job"] },
  { key: "psa", names: ["psalmen", "psalm", "ps", "psa", "psalms"] },
  { key: "pro", names: ["spreuken", "spr", "pro", "proverbs", "prov"] },
  { key: "ecc", names: ["prediker", "pred", "ecc", "ecclesiastes", "eccl"] },
  { key: "sng", names: ["hooglied", "hooglied", "hoogl", "sng", "song of solomon", "song of songs"] },
  { key: "isa", names: ["jesaja", "jes", "isa", "isaiah"] },
  { key: "jer", names: ["jeremia", "jer", "jeremiah"] },
  { key: "lam", names: ["klaagliederen", "klaagl", "lam", "lamentations"] },
  { key: "ezk", names: ["ezechiel", "ezech", "ezk", "ezekiel", "ezek"] },
  { key: "dan", names: ["daniel", "dan"] },
  { key: "hos", names: ["hosea", "hos"] },
  { key: "joe", names: ["joel", "joe"] },
  { key: "amo", names: ["amos", "amo"] },
  { key: "oba", names: ["obadja", "ob", "oba", "obadiah", "obad"] },
  { key: "jon", names: ["jona", "jon", "jonah"] },
  { key: "mic", names: ["micha", "mic", "micah"] },
  { key: "nah", names: ["nahum", "nah"] },
  { key: "hab", names: ["habakuk", "hab", "habakkuk"] },
  { key: "zep", names: ["zefanja", "zef", "zep", "zephaniah", "zeph"] },
  { key: "hag", names: ["haggai", "hag"] },
  { key: "zac", names: ["zacharia", "zach", "zac", "zechariah", "zech"] },
  { key: "mal", names: ["maleachi", "mal", "malachi"] },
  { key: "mat", names: ["mattheus", "matthew", "mat", "matt"] },
  { key: "mrk", names: ["markus", "marcus", "mark", "mrk"] },
  { key: "luk", names: ["lukas", "lucas", "luke", "luk"] },
  { key: "jhn", names: ["johannes", "john", "jhn"] },
  { key: "act", names: ["handelingen", "acts", "act"] },
  { key: "rom", names: ["romeinen", "romans", "rom"] },
  { key: "gal", names: ["galaten", "galatians", "gal"] },
  { key: "eph", names: ["efeze", "ephesians", "eph"] },
  { key: "php", names: ["filippenzen", "philippians", "php"] },
  { key: "col", names: ["kolossenzen", "colossians", "col"] },
  { key: "tit", names: ["titus", "tit"] },
  { key: "phm", names: ["filemon", "philemon", "phm"] },
  { key: "heb", names: ["hebreeen", "hebrews", "heb"] },
  { key: "jas", names: ["jakobus", "james", "jas"] },
  { key: "jud", names: ["judas", "jude", "jud"] },
  { key: "rev", names: ["openbaring", "revelation", "rev"] },
  { key: "1co", names: ["1 korinthe", "1 corinthians", "1co"] },
  { key: "2co", names: ["2 korinthe", "2 corinthians", "2co"] },
  { key: "1th", names: ["1 thessalonicenzen", "1 thessalonians", "1th"] },
  { key: "2th", names: ["2 thessalonicenzen", "2 thessalonians", "2th"] },
  { key: "1ti", names: ["1 timotheus", "1 timothy", "1ti"] },
  { key: "2ti", names: ["2 timotheus", "2 timothy", "2ti"] },
  { key: "1pe", names: ["1 petrus", "1 peter", "1pe"] },
  { key: "2pe", names: ["2 petrus", "2 peter", "2pe"] },
  { key: "1jo", names: ["1 johannes", "1 john", "1jo"] },
  { key: "2jo", names: ["2 johannes", "2 john", "2jo"] },
  { key: "3jo", names: ["3 johannes", "3 john", "3jo"] },
];

const canonical = new Set<string>(
  OTB_BOOKS.map(([, key]) => key),
);
if (
  canonical.size !== books.length ||
  books.some((book) => !canonical.has(book.key))
)
  throw new Error("OTB_CANONICAL_BOOK_COVERAGE");
const aliases = new Map<string, string>();
for (const book of books) {
  if (!canonical.has(book.key)) throw new Error(`OTB_UNKNOWN_BOOK:${book.key}`);
  for (const name of book.names) {
    const key = normalize(name);
    const previous = aliases.get(key);
    if (previous && previous !== book.key)
      throw new Error(`OTB_AMBIGUOUS_ALIAS:${key}`);
    aliases.set(key, book.key);
  }
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type OtbPassage = {
  bookKey: string;
  chapter: number;
  verses: number[] | null;
};

/** Expliciete bundel van maximaal 40 echte hoofdstuk-/verspassages. Geen
 * samengevoegd pseudohoofdstuk; iedere selectie behoudt eigen navigatie. */
export function parseOtbPassageSet(raw: string): OtbPassage[] | null {
  if (!raw.startsWith("otb-set:") || raw.length > 512) return null;
  const parts = raw.slice(8).split(";");
  if (
    !parts.length ||
    parts.length > 40 ||
    new Set(parts).size !== parts.length
  )
    return null;
  const parsed = parts.map((p) => parseOtbPassage(p));
  return parsed.every(
    (p): p is OtbPassage =>
      p !== null && (p.verses === null || p.verses.length <= 40),
  )
    ? parsed
    : null;
}

/**
 * Accepteert de machineleesbare `otb:gen:1:1-5`-vorm en gecontroleerde
 * Nederlandse labels zoals `Genesis 1:1-5`. Verwijzingen over hoofdstukken
 * heen zijn bewust geen deel van de één-hoofdstuk-previewarchitectuur.
 */
export function parseOtbPassage(raw: string): OtbPassage | null {
  if (raw.length > 512 || /[\u0000-\u001f]/.test(raw)) return null;
  const value = raw.trim().replace(/^otb:/i, "");
  const canonicalMatch = /^([1-3]?[a-z]{2,3}):(\d{1,3})(?::(.+))?$/i.exec(
    value,
  );
  let bookName: string, chapterText: string, versesText: string | undefined;
  if (canonicalMatch) [, bookName, chapterText, versesText] = canonicalMatch;
  else {
    const label = /^(.+?)\s+(\d{1,3})(?::(.+))?$/u.exec(value);
    if (!label) return null;
    [, bookName, chapterText, versesText] = label;
  }
  const bookKey = aliases.get(normalize(bookName));
  const chapter = Number(chapterText);
  if (!bookKey || !Number.isSafeInteger(chapter) || chapter < 1) return null;
  if (!versesText) return { bookKey, chapter, verses: null };
  const values = new Set<number>();
  for (const part of versesText.split(",")) {
    const range = /^\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*$/u.exec(part);
    if (!range) return null;
    const from = Number(range[1]),
      to = Number(range[2] ?? range[1]);
    if (from < 1 || from > to) return null;
    for (let verse = from; verse <= to; verse++) values.add(verse);
    if (values.size > 500) return null;
  }
  return { bookKey, chapter, verses: [...values].sort((a, b) => a - b) };
}
