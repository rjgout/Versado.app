// Pure weergavelogica van het woordenboek (zoeken, rangschikken, groeperen,
// verwante woorden en markeren). Geen database en geen browser: de woordenlijst
// zelf komt uit src/lib/dictionary.ts, dit bestand mag ook in de client draaien.

export interface WordEntry {
  word: string;
  count: number;
}

const COMBINING = new RegExp("[\\u0300-\\u036f]", "g");

/** Dezelfde vereenvoudiging als de woordenlijst zelf: kleine letters, zonder accenten. */
export function normalizeWord(text: string): string {
  return text.normalize("NFD").replace(COMBINING, "").toLowerCase().trim();
}

/**
 * Zoekresultaten: woorden die beginnen met de zoekterm staan vooraan, daarna de
 * woorden waar de term middenin voorkomt. Binnen elk deel blijft de volgorde van
 * de woordenlijst (alfabetisch). Een lege term geeft de hele lijst.
 */
export function searchWords(entries: WordEntry[], query: string): WordEntry[] {
  const q = normalizeWord(query);
  if (!q) return entries;
  const starts: WordEntry[] = [];
  const contains: WordEntry[] = [];
  for (const entry of entries) {
    if (entry.word.startsWith(q)) starts.push(entry);
    else if (entry.word.includes(q)) contains.push(entry);
  }
  return [...starts, ...contains];
}

/** Beginletters waarmee echt woorden beginnen, in de volgorde van de woordenlijst. */
export function startLetters(entries: WordEntry[], locale: string): string[] {
  return [...new Set(entries.map((entry) => entry.word[0]))].sort((a, b) => a.localeCompare(b, locale));
}

export function wordsStartingWith(entries: WordEntry[], letter: string): WordEntry[] {
  return entries.filter((entry) => entry.word.startsWith(letter));
}

/**
 * Woorden die op dit woord lijken: dezelfde stam (het begin van het woord),
 * bijvoorbeeld geloof, geloven en gelovigen. Alleen uit de bestaande woordenlijst
 * afgeleid; zonder woord van minimaal vijf letters (stam van vier) is er geen zinnige suggestie.
 */
export function similarWords(entries: WordEntry[], word: string, limit = 12): WordEntry[] {
  const target = normalizeWord(word);
  if (target.length < 5) return [];
  const stemLength = Math.max(4, target.length - 3);
  const stem = target.slice(0, Math.min(stemLength, target.length));
  return entries
    .filter((entry) => entry.word !== target && entry.word.startsWith(stem))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

export interface TextPart {
  text: string;
  match: boolean;
}

/** Knipt een vers in stukken en markeert elk heel woord dat gelijk is aan het gezochte woord. */
export function highlightWord(text: string, word: string): TextPart[] {
  const target = normalizeWord(word);
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(/[A-Za-zÀ-ÿ]+/g)) {
    const start = match.index ?? 0;
    if (normalizeWord(match[0]) !== target) continue;
    if (start > last) parts.push({ text: text.slice(last, start), match: false });
    parts.push({ text: match[0], match: true });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}

export interface BookGroup<T> {
  bookName: string;
  items: T[];
}

/** Groepeert verzen per boek met behoud van volgorde (de server levert ze al in boekvolgorde). */
export function groupByBook<T extends { bookName: string }>(items: T[]): BookGroup<T>[] {
  const groups: BookGroup<T>[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.bookName === item.bookName) last.items.push(item);
    else groups.push({ bookName: item.bookName, items: [item] });
  }
  return groups;
}

const RECENT_MAX = 8;

/** Onlangs bekeken woorden: nieuwste eerst, zonder dubbelen, begrensd. */
export function pushRecent(recent: string[], word: string): string[] {
  return [word, ...recent.filter((entry) => entry !== word)].slice(0, RECENT_MAX);
}

export function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
